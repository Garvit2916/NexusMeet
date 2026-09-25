from pathlib import Path
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import Settings
from app.db.init_db import initialize_database
from app.db.seed import seed_database
from app.main import create_app
from app.models.user import User
from app.tests.conftest import DEFAULT_USER_EMAIL, DEFAULT_USER_PASSWORD, login


def test_sqlite_foreign_keys_and_indexes_are_enabled(client: TestClient) -> None:
    application = cast(FastAPI, client.app)
    with application.state.database.engine.connect() as connection:
        foreign_keys = connection.execute(text("PRAGMA foreign_keys")).scalar_one()
        indexes = (
            connection.execute(text("SELECT name FROM sqlite_master WHERE type = 'index'"))
            .scalars()
            .all()
        )
        migration_revision = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        session_columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(sessions)")).all()
        }
        participant_columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(meeting_participants)")).all()
        }

    assert foreign_keys == 1
    assert migration_revision == "0003_auth_and_host_controls"
    assert "ix_meetings_host_created_at" in indexes
    assert "ix_meetings_status_scheduled_at" in indexes
    assert "ix_meeting_participants_user_meeting" in indexes
    assert {"id", "user_id", "created_at", "expires_at"} <= session_columns
    assert {"is_muted", "removed_at"} <= participant_columns
    user_columns = {
        row[1]
        for row in application.state.database.engine.connect()
        .execute(text("PRAGMA table_info(users)"))
        .all()
    }
    assert "password_hash" in user_columns


def test_sample_seed_is_idempotent(tmp_path: Path) -> None:
    settings = Settings(
        app_name="NexusMeet Seed Test",
        database_url=f"sqlite:///{(tmp_path / 'seed.db').as_posix()}",
        default_user_id="usr_default_000000000000000000000001",
        default_user_name="Demo User",
        default_user_email="demo@nexusmeet.dev",
        seed_sample_data=True,
    )
    application = create_app(settings)
    with TestClient(application) as sample_client:
        login(sample_client, DEFAULT_USER_EMAIL, DEFAULT_USER_PASSWORD)
        response = sample_client.get("/api/v1/meetings")
        assert response.status_code == 200
        assert response.json()["meta"]["total"] == 6
        assert all(
            item["display_status"] in {"upcoming", "ended"}
            for item in response.json()["data"]["meetings"]
        )
        assert seed_database(application.state.database, settings) is False


def test_legacy_seeded_accounts_are_backfilled(tmp_path: Path) -> None:
    database_path = (tmp_path / "legacy.db").as_posix()
    settings = Settings(
        app_name="NexusMeet Legacy Test",
        database_url=f"sqlite:///{database_path}",
        default_user_id="usr_default_000000000000000000000001",
        default_user_name="Demo User",
        default_user_email="demo@nexusmeet.app",
        default_user_password="demo12345",
        seed_sample_data=False,
    )
    application = create_app(settings)
    initialize_database(application.state.database.engine)
    with application.state.session_factory() as session:
        session.add(
            User(
                id=settings.default_user_id,
                name="Demo User",
                email="demo@nexusmeet.local",
            )
        )
        session.commit()

    with TestClient(application) as legacy_client:
        # The application lifespan backfills the password and email on first boot.
        assert seed_database(application.state.database, settings) is False

        login_response = legacy_client.post(
            "/api/v1/auth/login",
            json={"email": "demo@nexusmeet.app", "password": "demo12345"},
        )
        assert login_response.status_code == 200

        profile = legacy_client.get("/api/v1/users/me")
        assert profile.json()["data"]["email"] == "demo@nexusmeet.app"


def test_list_only_returns_accessible_meetings(
    client: TestClient,
    attendee_client: TestClient,
) -> None:
    first = attendee_client.post("/api/v1/meetings/instant", json={"title": "One"})
    second = attendee_client.post("/api/v1/meetings/instant", json={"title": "Two"})

    first_id = first.json()["data"]["id"]
    second_id = second.json()["data"]["id"]
    joined = client.post(f"/api/v1/meetings/{second_id}/join")
    assert joined.status_code == 200

    hosted = attendee_client.get("/api/v1/meetings", params={"scope": "hosted"})
    assert hosted.json()["meta"]["total"] == 2
    assert {item["id"] for item in hosted.json()["data"]["items"]} == {first_id, second_id}

    attendee_joined = attendee_client.get("/api/v1/meetings", params={"scope": "joined"})
    assert attendee_joined.json()["meta"]["total"] == 0

    host_joined_list = client.get("/api/v1/meetings", params={"scope": "joined"})
    host_joined_ids = {item["id"] for item in host_joined_list.json()["data"]["items"]}
    assert host_joined_ids == {second_id}
    assert first_id not in host_joined_ids

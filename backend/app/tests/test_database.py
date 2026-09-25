from collections.abc import Callable
from pathlib import Path
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import Settings
from app.db.seed import seed_database
from app.main import create_app


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

    assert foreign_keys == 1
    assert migration_revision == "0002_meeting_duration"
    assert "ix_meetings_host_created_at" in indexes
    assert "ix_meetings_status_scheduled_at" in indexes
    assert "ix_meeting_participants_user_meeting" in indexes


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
        response = sample_client.get("/api/v1/meetings")
        assert response.status_code == 200
        assert response.json()["meta"]["total"] == 6
        assert all(
            item["display_status"] in {"upcoming", "ended"}
            for item in response.json()["data"]["meetings"]
        )
        assert seed_database(application.state.database, settings) is False


def test_list_only_returns_accessible_meetings(
    client: TestClient,
    auth_headers: Callable[..., dict[str, str]],
    other_user_id: str,
) -> None:
    first = client.post(
        "/api/v1/meetings/instant",
        headers=auth_headers(other_user_id),
        json={"title": "One"},
    )
    second = client.post(
        "/api/v1/meetings/instant",
        headers=auth_headers(other_user_id),
        json={"title": "Two"},
    )

    first_id = first.json()["data"]["id"]
    second_id = second.json()["data"]["id"]
    joined = client.post(
        f"/api/v1/meetings/{second_id}/join",
        headers=auth_headers(),
    )
    assert joined.status_code == 200

    hosted = client.get("/api/v1/meetings", params={"scope": "hosted"})
    assert hosted.json()["meta"]["total"] == 0

    joined_list = client.get("/api/v1/meetings", params={"scope": "joined"})
    joined_ids = {item["id"] for item in joined_list.json()["data"]["items"]}
    assert joined_ids == {second_id}
    assert first_id not in joined_ids

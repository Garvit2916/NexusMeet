from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models.user import User

DEFAULT_USER_ID = "usr_default_000000000000000000000001"
OTHER_USER_ID = "usr_test_other_0000000000000000000000001"


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    database_path = (tmp_path / "nexusmeet-test.db").as_posix()
    settings = Settings(
        app_name="NexusMeet Test API",
        database_url=f"sqlite:///{database_path}",
        auto_create_tables=True,
        default_user_id=DEFAULT_USER_ID,
        default_user_name="Demo User",
        default_user_email="demo@nexusmeet.dev",
        seed_sample_data=False,
    )
    application = create_app(settings)
    with TestClient(application) as test_client:
        yield test_client


@pytest.fixture
def other_user_id(client: TestClient) -> str:
    application = cast(FastAPI, client.app)
    session_factory = application.state.session_factory
    with session_factory() as session:
        session.add(
            User(
                id=OTHER_USER_ID,
                name="Test Attendee",
                email="attendee@nexusmeet.dev",
            )
        )
        session.commit()
    return OTHER_USER_ID


@pytest.fixture
def auth_headers() -> Callable[..., dict[str, str]]:
    def build_headers(user_id: str | None = None) -> dict[str, str]:
        return {"X-User-ID": user_id or DEFAULT_USER_ID}

    return build_headers


@pytest.fixture
def future_time() -> datetime:
    return datetime.now(UTC) + timedelta(minutes=10)

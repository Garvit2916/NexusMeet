from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.main import create_app
from app.models.session import AuthSession

DEFAULT_USER_ID = "usr_default_000000000000000000000001"
DEFAULT_USER_EMAIL = "demo@nexusmeet.dev"
DEFAULT_USER_PASSWORD = "demo12345"
ATTENDEE_EMAIL = "attendee@nexusmeet.dev"
ATTENDEE_PASSWORD = "attendee1234"
HOST_ONLY_EMAIL = "host@nexusmeet.dev"
HOST_ONLY_PASSWORD = "host-only-pass"


def login(client: TestClient, email: str, password: str) -> None:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    assert client.cookies.get("nexusmeet_session")


@pytest.fixture
def app(tmp_path: Path) -> Iterator[FastAPI]:
    database_path = (tmp_path / "nexusmeet-test.db").as_posix()
    settings = Settings(
        app_name="NexusMeet Test API",
        database_url=f"sqlite:///{database_path}",
        auto_create_tables=True,
        default_user_id=DEFAULT_USER_ID,
        default_user_name="Demo User",
        default_user_email=DEFAULT_USER_EMAIL,
        default_user_password=DEFAULT_USER_PASSWORD,
        seed_sample_data=False,
    )
    application = create_app(settings)
    with TestClient(application):
        yield application


@pytest.fixture
def db_session(app: FastAPI) -> Iterator[Session]:
    session_factory = cast(sessionmaker[Session], app.state.session_factory)
    with session_factory() as session:
        yield session


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    test_client = TestClient(app)
    login(test_client, DEFAULT_USER_EMAIL, DEFAULT_USER_PASSWORD)
    return test_client


@pytest.fixture
def anonymous_client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def other_user_id(app: FastAPI) -> str:
    # Registration is performed on a throwaway client so that the shared
    # `anonymous_client` fixture stays without a session cookie.
    registration_client = TestClient(app)
    response = registration_client.post(
        "/api/v1/auth/register",
        json={"name": "Test Attendee", "email": ATTENDEE_EMAIL, "password": ATTENDEE_PASSWORD},
    )
    assert response.status_code == 201, response.text
    return cast(str, response.json()["data"]["id"])


@pytest.fixture
def attendee_client(app: FastAPI, other_user_id: str) -> TestClient:
    test_client = TestClient(app)
    login(test_client, ATTENDEE_EMAIL, ATTENDEE_PASSWORD)
    return test_client


@pytest.fixture
def host_only_user_id(app: FastAPI) -> str:
    registration_client = TestClient(app)
    response = registration_client.post(
        "/api/v1/auth/register",
        json={"name": "Host Only", "email": HOST_ONLY_EMAIL, "password": HOST_ONLY_PASSWORD},
    )
    assert response.status_code == 201, response.text
    return cast(str, response.json()["data"]["id"])


@pytest.fixture
def host_only_client(app: FastAPI, host_only_user_id: str) -> TestClient:
    test_client = TestClient(app)
    login(test_client, HOST_ONLY_EMAIL, HOST_ONLY_PASSWORD)
    return test_client


def expire_all_sessions(session: Session) -> int:
    auth_sessions = list(session.scalars(select(AuthSession)).all())
    for auth_session in auth_sessions:
        auth_session.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    session.commit()
    return len(auth_sessions)


@pytest.fixture
def future_time() -> datetime:
    return datetime.now(UTC) + timedelta(minutes=10)

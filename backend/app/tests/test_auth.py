from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_session_token
from app.models.session import AuthSession
from app.models.user import User
from app.tests.conftest import (
    ATTENDEE_EMAIL,
    ATTENDEE_PASSWORD,
    DEFAULT_USER_EMAIL,
    DEFAULT_USER_PASSWORD,
    expire_all_sessions,
)


def test_register_creates_account_and_session(anonymous_client: TestClient) -> None:
    response = anonymous_client.post(
        "/api/v1/auth/register",
        json={
            "name": "  Ada Lovelace  ",
            "email": "  ADA@NexusMeet.dev  ",
            "password": "s3cret-pass",
        },
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["name"] == "Ada Lovelace"
    assert data["email"] == "ada@nexusmeet.dev"
    assert data["hosted_meeting_count"] == 0
    assert "password" not in data
    assert "password_hash" not in data

    cookie = anonymous_client.cookies.get("nexusmeet_session")
    assert cookie is not None
    assert cookie.startswith("nxs_")
    assert response.headers["set-cookie"].lower().find("httponly") != -1

    session = anonymous_client.get("/api/v1/auth/me")
    assert session.status_code == 200
    assert session.json()["data"]["id"] == data["id"]


def test_password_is_hashed_and_never_returned(
    anonymous_client: TestClient,
    db_session: Session,
) -> None:
    anonymous_client.post(
        "/api/v1/auth/register",
        json={"name": "Grace", "email": "grace@nexusmeet.dev", "password": "another-s3cret"},
    )

    user = db_session.scalar(select(User).where(User.email == "grace@nexusmeet.dev"))

    assert user is not None
    assert user.password_hash is not None
    assert user.password_hash.startswith("$argon2id$")
    assert "another-s3cret" not in user.password_hash


def test_register_rejects_duplicate_email(anonymous_client: TestClient) -> None:
    payload = {"name": "First", "email": "dup@nexusmeet.dev", "password": "first-pass"}
    assert anonymous_client.post("/api/v1/auth/register", json=payload).status_code == 201

    duplicate = anonymous_client.post(
        "/api/v1/auth/register",
        json={"name": "Second", "email": "DUP@nexusmeet.dev", "password": "second-pass"},
    )

    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "EMAIL_ALREADY_REGISTERED"


def test_register_validates_password_and_email(anonymous_client: TestClient) -> None:
    short_password = anonymous_client.post(
        "/api/v1/auth/register",
        json={"name": "Short", "email": "short@nexusmeet.dev", "password": "abc"},
    )
    assert short_password.status_code == 422
    assert short_password.json()["error"]["code"] == "VALIDATION_ERROR"

    bad_email = anonymous_client.post(
        "/api/v1/auth/register",
        json={"name": "Bad", "email": "not-an-email", "password": "valid-pass"},
    )
    assert bad_email.status_code == 422
    assert bad_email.json()["error"]["code"] == "VALIDATION_ERROR"


def test_login_succeeds_and_logout_revokes_the_session(client: TestClient) -> None:
    assert client.get("/api/v1/auth/me").status_code == 200

    logged_out = client.post("/api/v1/auth/logout")
    assert logged_out.status_code == 200
    assert logged_out.json()["data"] == {"message": "Signed out"}
    assert "nexusmeet_session" not in client.cookies

    after_logout = client.get("/api/v1/auth/me")
    assert after_logout.status_code == 401
    assert after_logout.json()["error"]["code"] == "UNAUTHENTICATED"


def test_logout_without_a_session_is_not_an_error(anonymous_client: TestClient) -> None:
    response = anonymous_client.post("/api/v1/auth/logout")

    assert response.status_code == 200
    assert response.json()["success"] is True


def test_login_rejects_wrong_password_and_unknown_email(anonymous_client: TestClient) -> None:
    wrong_password = anonymous_client.post(
        "/api/v1/auth/login",
        json={"email": DEFAULT_USER_EMAIL, "password": "not-the-password"},
    )
    assert wrong_password.status_code == 401
    assert wrong_password.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert "nexusmeet_session" not in anonymous_client.cookies

    unknown_email = anonymous_client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@nexusmeet.dev", "password": DEFAULT_USER_PASSWORD},
    )
    assert unknown_email.status_code == 401
    assert unknown_email.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert "nexusmeet_session" not in anonymous_client.cookies


def test_login_error_does_not_reveal_account_existence(anonymous_client: TestClient) -> None:
    wrong_password = anonymous_client.post(
        "/api/v1/auth/login",
        json={"email": DEFAULT_USER_EMAIL, "password": "not-the-password"},
    )
    unknown_email = anonymous_client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@nexusmeet.dev", "password": "not-the-password"},
    )

    assert wrong_password.json()["error"]["code"] == unknown_email.json()["error"]["code"]
    assert wrong_password.json()["error"]["message"] == unknown_email.json()["error"]["message"]
    assert unknown_email.json()["error"]["details"] in ({}, None)


def test_attendee_session_only_exposes_own_account(
    attendee_client: TestClient,
    other_user_id: str,
) -> None:
    response = attendee_client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json()["data"]["id"] == other_user_id
    assert response.json()["data"]["email"] == ATTENDEE_EMAIL


def test_expired_sessions_are_rejected(client: TestClient, db_session: Session) -> None:
    assert client.get("/api/v1/auth/me").status_code == 200

    token = client.cookies.get("nexusmeet_session")
    assert token is not None
    auth_session = db_session.scalar(
        select(AuthSession).where(AuthSession.id == hash_session_token(token))
    )
    assert auth_session is not None
    auth_session.expires_at = auth_session.created_at - timedelta(seconds=1)
    db_session.commit()

    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_expire_all_sessions_helper_clears_sessions(
    client: TestClient,
    db_session: Session,
) -> None:
    assert expire_all_sessions(db_session) == 1
    assert client.get("/api/v1/auth/me").status_code == 401


def test_tampered_cookie_is_rejected(anonymous_client: TestClient) -> None:
    anonymous_client.post(
        "/api/v1/auth/register",
        json={"name": "Tamper", "email": "tamper@nexusmeet.dev", "password": ATTENDEE_PASSWORD},
    )
    anonymous_client.cookies.set("nexusmeet_session", "nxs_forged-token-value")

    response = anonymous_client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_sessions_are_revocable_without_deleting_the_account(
    attendee_client: TestClient,
    db_session: Session,
) -> None:
    attendee_client.post("/api/v1/auth/logout")

    users = list(db_session.scalars(select(User).where(User.email == ATTENDEE_EMAIL)).all())
    sessions = list(db_session.scalars(select(AuthSession)).all())

    assert len(users) == 1
    assert len(sessions) == 1

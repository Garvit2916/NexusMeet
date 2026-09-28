from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.core.rate_limit import LoginRateLimiter
from app.main import _purge_expired_sessions
from app.models.session import AuthSession
from app.tests.conftest import DEFAULT_USER_EMAIL, DEFAULT_USER_PASSWORD, login


class TestLoginRateLimiting:
    def test_repeated_failures_eventually_lock_the_pair(
        self, anonymous_client: TestClient
    ) -> None:
        for _ in range(5):
            response = anonymous_client.post(
                "/api/v1/auth/login",
                json={"email": DEFAULT_USER_EMAIL, "password": "wrong-password"},
            )
            assert response.status_code == 401

        locked = anonymous_client.post(
            "/api/v1/auth/login",
            json={"email": DEFAULT_USER_EMAIL, "password": DEFAULT_USER_PASSWORD},
        )
        assert locked.status_code == 401
        assert locked.json()["error"]["code"] == "INVALID_CREDENTIALS"

    def test_a_locked_attempt_returns_retry_after(
        self, anonymous_client: TestClient
    ) -> None:
        for _ in range(6):
            response = anonymous_client.post(
                "/api/v1/auth/login",
                json={"email": DEFAULT_USER_EMAIL, "password": "wrong-password"},
            )
        assert response.status_code == 401
        assert int(response.headers["Retry-After"]) > 0

    def test_a_lockout_does_not_reveal_that_the_account_exists(
        self, anonymous_client: TestClient
    ) -> None:
        for _ in range(5):
            anonymous_client.post(
                "/api/v1/auth/login",
                json={"email": DEFAULT_USER_EMAIL, "password": "wrong-password"},
            )
        known = anonymous_client.post(
            "/api/v1/auth/login",
            json={"email": DEFAULT_USER_EMAIL, "password": DEFAULT_USER_PASSWORD},
        )
        unknown = anonymous_client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@nexusmeet.dev", "password": DEFAULT_USER_PASSWORD},
        )
        assert known.status_code == unknown.status_code
        assert known.json()["error"]["code"] == unknown.json()["error"]["code"]
        assert known.json()["error"]["message"] == unknown.json()["error"]["message"]

    def test_a_successful_login_clears_the_failure_count(
        self, anonymous_client: TestClient
    ) -> None:
        for _ in range(4):
            anonymous_client.post(
                "/api/v1/auth/login",
                json={"email": DEFAULT_USER_EMAIL, "password": "wrong-password"},
            )
        login(anonymous_client, DEFAULT_USER_EMAIL, DEFAULT_USER_PASSWORD)
        anonymous_client.post("/api/v1/auth/logout")

        # Five fresh failures are still tolerated, which is only true if the
        # earlier success reset the counter.
        for _ in range(5):
            response = anonymous_client.post(
                "/api/v1/auth/login",
                json={"email": DEFAULT_USER_EMAIL, "password": "wrong-password"},
            )
            assert response.status_code == 401

    def test_one_address_cannot_lock_out_a_different_account(
        self, anonymous_client: TestClient
    ) -> None:
        for _ in range(6):
            anonymous_client.post(
                "/api/v1/auth/login",
                json={"email": "victim@nexusmeet.dev", "password": "wrong-password"},
            )
        # A different email from the same address is tracked separately.
        login(anonymous_client, DEFAULT_USER_EMAIL, DEFAULT_USER_PASSWORD)


class TestLoginRateLimiterUnit:
    def test_lockout_expires_once_the_window_passes(self) -> None:
        now = [1000.0]
        limiter = LoginRateLimiter(max_failures=2, window_seconds=60, lockout_seconds=30)
        limiter.set_clock(lambda: now[0])

        limiter.record_failure("a")
        assert limiter.is_allowed("a")
        limiter.record_failure("a")
        assert not limiter.is_allowed("a")
        assert limiter.seconds_until_allowed("a") > 0

        now[0] += 31
        assert limiter.is_allowed("a")
        assert limiter.seconds_until_allowed("a") == 0

    def test_reset_clears_a_lockout_immediately(self) -> None:
        limiter = LoginRateLimiter(max_failures=1, window_seconds=60, lockout_seconds=300)
        limiter.set_clock(lambda: 0.0)
        limiter.record_failure("a")
        assert not limiter.is_allowed("a")
        limiter.reset("a")
        assert limiter.is_allowed("a")

    def test_buckets_are_independent_per_key(self) -> None:
        limiter = LoginRateLimiter(max_failures=1, lockout_seconds=300)
        limiter.set_clock(lambda: 0.0)
        limiter.record_failure("a")
        assert not limiter.is_allowed("a")
        assert limiter.is_allowed("b")

    def test_clear_wipes_every_bucket(self) -> None:
        limiter = LoginRateLimiter(max_failures=1, lockout_seconds=300)
        limiter.set_clock(lambda: 0.0)
        limiter.record_failure("a")
        limiter.record_failure("b")
        limiter.clear()
        assert limiter.is_allowed("a")
        assert limiter.is_allowed("b")


class TestPasswordChange:
    def test_change_password_requires_a_session(self, anonymous_client: TestClient) -> None:
        response = anonymous_client.post(
            "/api/v1/auth/change-password",
            json={"current_password": DEFAULT_USER_PASSWORD, "new_password": "brand-new-pass"},
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"

    def test_change_password_rejects_a_wrong_current_password(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "not-my-password", "new_password": "brand-new-pass"},
        )
        assert response.status_code == 401
        assert "current password" in response.json()["error"]["message"].lower()

    def test_change_password_rejects_reusing_the_same_password(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/v1/auth/change-password",
            json={
                "current_password": DEFAULT_USER_PASSWORD,
                "new_password": DEFAULT_USER_PASSWORD,
            },
        )
        assert response.status_code == 422

    def test_change_password_enforces_a_minimum_length(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/auth/change-password",
            json={"current_password": DEFAULT_USER_PASSWORD, "new_password": "short"},
        )
        assert response.status_code == 422

    def test_the_new_password_works_and_the_old_one_stops(
        self, client: TestClient, app: object
    ) -> None:
        assert (
            client.post(
                "/api/v1/auth/change-password",
                json={
                    "current_password": DEFAULT_USER_PASSWORD,
                    "new_password": "a-brand-new-password",
                },
            ).status_code
            == 200
        )

        client.post("/api/v1/auth/logout")
        stale = client.post(
            "/api/v1/auth/login",
            json={"email": DEFAULT_USER_EMAIL, "password": DEFAULT_USER_PASSWORD},
        )
        assert stale.status_code == 401

        login(client, DEFAULT_USER_EMAIL, "a-brand-new-password")
        assert client.get("/api/v1/auth/me").status_code == 200


class TestSessionHygiene:
    def test_expired_sessions_are_purged_on_startup(
        self, app: FastAPI, db_session: Session
    ) -> None:
        from datetime import UTC, datetime, timedelta

        user_id = cast(str, db_session.execute(text("SELECT id FROM users LIMIT 1")).scalar_one())
        db_session.add(
            AuthSession(
                id="stale-session-row",
                user_id=user_id,
                expires_at=datetime.now(UTC) - timedelta(days=1),
            )
        )
        db_session.commit()
        assert db_session.get(AuthSession, "stale-session-row") is not None

        _purge_expired_sessions(app)

        db_session.expire_all()
        assert db_session.get(AuthSession, "stale-session-row") is None

    def test_purge_keeps_sessions_that_are_still_valid(
        self, app: FastAPI, db_session: Session
    ) -> None:
        from datetime import UTC, datetime, timedelta

        user_id = cast(str, db_session.execute(text("SELECT id FROM users LIMIT 1")).scalar_one())
        db_session.add(
            AuthSession(
                id="live-session-row",
                user_id=user_id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        db_session.commit()

        _purge_expired_sessions(app)

        db_session.expire_all()
        assert db_session.get(AuthSession, "live-session-row") is not None


class TestPasswordRehash:
    def test_login_upgrades_a_hash_written_with_older_parameters(self, tmp_path: Path) -> None:
        from argon2 import PasswordHasher

        from app.core.config import Settings
        from app.main import create_app
        from app.schemas.auth import RegisterRequest
        from app.services.auth_service import AuthService

        # Argon2 with deliberately weak settings, standing in for a legacy hash.
        weak_hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        legacy_hash = weak_hasher.hash("legacy-password")

        application = create_app(
            Settings(
                _env_file=None,
                app_name="Rehash Test",
                database_url=f"sqlite:///{(tmp_path / 'rehash.db').as_posix()}",
                auto_create_tables=True,
                seed_sample_data=False,
            )
        )
        with TestClient(application):
            session_factory = cast(sessionmaker[Session], application.state.session_factory)
            with session_factory() as session:
                service = AuthService(session, session_ttl=timedelta(hours=1))
                user = service.register(
                    RegisterRequest(
                        name="Legacy User",
                        email="legacy@example.com",
                        password="legacy-password",
                    )
                )
                user.password_hash = legacy_hash
                session.commit()
                user_id = user.id

            with session_factory() as session:
                service = AuthService(session, session_ttl=timedelta(hours=1))
                authenticated = service.authenticate("legacy@example.com", "legacy-password")
                assert authenticated.id == user_id
                upgraded = authenticated.password_hash
                assert upgraded is not None
                assert upgraded != legacy_hash
                # The stored hash must now be strong enough that the weak
                # hasher would still want to rehash it.
                assert weak_hasher.check_needs_rehash(upgraded)

    def test_rehash_still_rejects_a_wrong_password(self, tmp_path: Path) -> None:
        from argon2 import PasswordHasher

        from app.core.config import Settings
        from app.core.errors import AppError
        from app.main import create_app
        from app.schemas.auth import RegisterRequest
        from app.services.auth_service import AuthService

        weak_hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        application = create_app(
            Settings(
                _env_file=None,
                app_name="Rehash Reject Test",
                database_url=f"sqlite:///{(tmp_path / 'rehash-reject.db').as_posix()}",
                auto_create_tables=True,
                seed_sample_data=False,
            )
        )
        with TestClient(application):
            session_factory = cast(sessionmaker[Session], application.state.session_factory)
            with session_factory() as session:
                service = AuthService(session, session_ttl=timedelta(hours=1))
                user = service.register(
                    RegisterRequest(
                        name="Legacy User",
                        email="legacy-reject@example.com",
                        password="legacy-password",
                    )
                )
                user.password_hash = weak_hasher.hash("legacy-password")
                session.commit()

            with session_factory() as session:
                service = AuthService(session, session_ttl=timedelta(hours=1))
                with pytest.raises(AppError) as raised:
                    service.authenticate("legacy-reject@example.com", "not-the-password")
                assert raised.value.status_code == 401

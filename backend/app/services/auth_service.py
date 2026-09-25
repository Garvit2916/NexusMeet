from __future__ import annotations

from datetime import timedelta
from secrets import token_hex
from typing import NamedTuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)
from app.models.session import AuthSession
from app.models.user import User
from app.repositories.session_repository import SessionRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import RegisterRequest, normalize_email
from app.schemas.user import CurrentUserResponse
from app.utils.time import utc_now


class IssuedSession(NamedTuple):
    auth_session: AuthSession
    token: str


class AuthService:
    def __init__(self, session: Session, *, session_ttl: timedelta) -> None:
        self.session = session
        self.session_ttl = session_ttl
        self.users = UserRepository(session)
        self.sessions = SessionRepository(session)

    def register(self, payload: RegisterRequest) -> User:
        email = normalize_email(payload.email)
        if self.users.get_by_email(email) is not None:
            raise AppError(
                409,
                "EMAIL_ALREADY_REGISTERED",
                "An account with this email already exists",
                {"email": email},
            )
        user = User(
            id=f"usr_{token_hex(12)}",
            name=payload.name,
            email=email,
            password_hash=hash_password(payload.password),
        )
        self.users.add(user)
        try:
            self._commit()
        except IntegrityError as exc:
            raise AppError(
                409,
                "EMAIL_ALREADY_REGISTERED",
                "An account with this email already exists",
                {"email": email},
            ) from exc
        return user

    def authenticate(self, email: str, password: str) -> User:
        normalized_email = normalize_email(email)
        user = self.users.get_by_email(normalized_email)
        if user is None or not verify_password(user.password_hash, password):
            # One generic message so the API never reveals which emails exist.
            raise AppError(
                401,
                "INVALID_CREDENTIALS",
                "Email or password is incorrect",
            )
        return user

    def create_session(self, user: User) -> IssuedSession:
        token = generate_session_token()
        now = utc_now()
        auth_session = self.sessions.add(
            AuthSession(
                id=hash_session_token(token),
                user_id=user.id,
                created_at=now,
                expires_at=now + self.session_ttl,
            )
        )
        self._commit()
        return IssuedSession(auth_session=auth_session, token=token)

    def resolve_session_token(self, token: str | None) -> User | None:
        if not token:
            return None
        auth_session = self.sessions.get_active(hash_session_token(token))
        if auth_session is None:
            return None
        return auth_session.user

    def revoke_session_token(self, token: str | None) -> bool:
        if not token:
            return False
        auth_session = self.sessions.get(hash_session_token(token))
        if auth_session is None:
            return False
        self.sessions.delete(auth_session)
        self._commit()
        return True

    def purge_expired_sessions(self) -> int:
        removed = self.sessions.purge_expired()
        self._commit()
        return removed

    def current_user_response(self, user: User) -> CurrentUserResponse:
        return CurrentUserResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            avatar_url=user.avatar_url,
            created_at=user.created_at,
            updated_at=user.updated_at,
            hosted_meeting_count=self.users.count_hosted_meetings(user.id),
            joined_meeting_count=self.users.count_joined_meetings(user.id),
        )

    def _commit(self) -> None:
        try:
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

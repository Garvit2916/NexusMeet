from __future__ import annotations

from datetime import timedelta
from typing import cast

from fastapi import Depends, Path, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.db.session import get_db
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService
from app.services.meeting_service import MeetingService
from app.services.user_service import UserService
from app.utils.ids import (
    MEETING_ID_MAX_LENGTH,
    MEETING_IDENTIFIER_MIN_LENGTH,
    MEETING_IDENTIFIER_PATTERN,
)


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_session_ttl(settings: Settings = Depends(get_settings)) -> timedelta:
    return timedelta(seconds=settings.session_ttl_seconds)


def get_auth_service(
    db: Session = Depends(get_db),
    session_ttl: timedelta = Depends(get_session_ttl),
) -> AuthService:
    return AuthService(db, session_ttl=session_ttl)


def read_session_token(request: Request) -> str | None:
    settings: Settings = request.app.state.settings
    token = request.cookies.get(settings.session_cookie_name)
    return token.strip() if token else None


def _resolve_optional_user(request: Request, db: Session) -> User | None:
    settings: Settings = request.app.state.settings
    service = AuthService(db, session_ttl=timedelta(seconds=settings.session_ttl_seconds))
    return service.resolve_session_token(read_session_token(request))


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    user = _resolve_optional_user(request, db)
    if user is None:
        raise AppError(
            401,
            "UNAUTHENTICATED",
            "Sign in to continue",
        )
    return user


def get_optional_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User | None:
    return _resolve_optional_user(request, db)


def get_meeting_service(db: Session = Depends(get_db)) -> MeetingService:
    return MeetingService(db)


def get_user_service(db: Session = Depends(get_db)) -> UserService:
    return UserService(UserRepository(db))


def require_meeting_host(
    meeting_id: str = Path(
        min_length=MEETING_IDENTIFIER_MIN_LENGTH,
        max_length=MEETING_ID_MAX_LENGTH,
        pattern=MEETING_IDENTIFIER_PATTERN,
    ),
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> User:
    service.require_host(meeting_id, current_user)
    return current_user


__all__ = [
    "get_auth_service",
    "get_current_user",
    "get_meeting_service",
    "get_optional_current_user",
    "get_session_ttl",
    "get_settings",
    "get_user_service",
    "read_session_token",
    "require_meeting_host",
]

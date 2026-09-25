from typing import Protocol

from fastapi import Request

from app.core.config import Settings
from app.core.errors import AppError


class UserIdentityProvider(Protocol):
    def get_user_id(self, request: Request) -> str: ...

    def get_optional_user_id(self, request: Request) -> str | None: ...


class DefaultUserIdentityProvider:
    def __init__(self, settings: Settings) -> None:
        self._default_user_id = settings.default_user_id
        self._header_name = settings.current_user_header

    def get_optional_user_id(self, request: Request) -> str | None:
        raw_user_id = request.headers.get(self._header_name)
        if raw_user_id is None:
            return None
        user_id = raw_user_id.strip()
        if len(user_id) > 64:
            raise AppError(
                400,
                "INVALID_CURRENT_USER",
                "Current user identifier is too long",
            )
        return user_id or None

    def get_user_id(self, request: Request) -> str:
        user_id = self.get_optional_user_id(request)
        if user_id is None:
            return self._default_user_id
        return user_id

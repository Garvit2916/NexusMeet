from __future__ import annotations

import hashlib
import secrets
from typing import Literal

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from starlette.responses import Response

SESSION_TOKEN_BYTES = 32
SESSION_TOKEN_PREFIX = "nxs_"

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return bool(_password_hasher.verify(password_hash, password))
    except (VerificationError, InvalidHashError, ValueError):
        return False


def needs_rehash(password_hash: str | None) -> bool:
    if not password_hash:
        return True
    try:
        return _password_hasher.check_needs_rehash(password_hash)
    except (VerificationError, InvalidHashError, ValueError):
        return True


def generate_session_token() -> str:
    return f"{SESSION_TOKEN_PREFIX}{secrets.token_urlsafe(SESSION_TOKEN_BYTES)}"


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def set_session_cookie(
    response: Response,
    *,
    name: str,
    token: str,
    max_age_seconds: int,
    secure: bool,
    samesite: Literal["lax", "strict", "none"],
) -> None:
    response.set_cookie(
        key=name,
        value=token,
        max_age=max_age_seconds,
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/",
    )


def clear_session_cookie(
    response: Response,
    *,
    name: str,
    secure: bool,
    samesite: Literal["lax", "strict", "none"],
) -> None:
    response.delete_cookie(
        key=name,
        path="/",
        httponly=True,
        secure=secure,
        samesite=samesite,
    )

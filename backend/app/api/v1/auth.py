from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.dependencies import (
    get_auth_service,
    get_current_user,
    get_settings,
    read_session_token,
)
from app.core.config import Settings
from app.core.errors import AppError
from app.core.rate_limit import login_rate_limiter
from app.core.security import clear_session_cookie, set_session_cookie
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, RegisterRequest
from app.schemas.common import MessageData, SuccessEnvelope
from app.schemas.user import CurrentUserResponse
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_address(request: Request) -> str:
    """Best-effort client identity for rate limiting.

    ``X-Forwarded-For`` is only honoured in production, where the app runs
    behind a proxy that sets it. In development it is ignored so a client
    cannot trivially rotate the header and evade the limiter.
    """
    settings: Settings = request.app.state.settings
    if settings.is_production:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _throttle_key(request: Request, email: str) -> str:
    """Key on both address and email so neither axis alone can be exhausted.

    Keying on the email alone would let an attacker lock a known account out of
    its own login; keying on the address alone would let one bad network block
    everyone behind it.
    """
    return f"{_client_address(request)}|{email.lower()}"


def _issue_session(
    response: Response,
    settings: Settings,
    token: str,
) -> None:
    set_session_cookie(
        response,
        name=settings.session_cookie_name,
        token=token,
        max_age_seconds=settings.session_ttl_seconds,
        secure=settings.use_secure_session_cookie,
        samesite=settings.session_cookie_samesite_value,
    )


def _clear_session(response: Response, settings: Settings) -> None:
    clear_session_cookie(
        response,
        name=settings.session_cookie_name,
        secure=settings.use_secure_session_cookie,
        samesite=settings.session_cookie_samesite_value,
    )


@router.post(
    "/register",
    response_model=SuccessEnvelope[CurrentUserResponse],
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: RegisterRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessEnvelope[CurrentUserResponse]:
    user = auth_service.register(payload)
    issued = auth_service.create_session(user)
    _issue_session(response, settings, issued.token)
    return SuccessEnvelope(data=auth_service.current_user_response(user))


@router.post("/login", response_model=SuccessEnvelope[CurrentUserResponse])
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessEnvelope[CurrentUserResponse]:
    throttle_key = _throttle_key(request, payload.email)
    wait_seconds = login_rate_limiter.seconds_until_allowed(throttle_key)
    if wait_seconds:
        # Deliberately the same code and message as a wrong password: a caller
        # must not be able to tell "locked out" from "no such account".
        raise AppError(
            401,
            "INVALID_CREDENTIALS",
            "Email or password is incorrect",
            headers={
                "Retry-After": str(wait_seconds),
                "X-RateLimit-Remaining": "0",
            },
        )

    try:
        user = auth_service.authenticate(payload.email, payload.password)
    except AppError:
        login_rate_limiter.record_failure(throttle_key)
        raise

    login_rate_limiter.reset(throttle_key)
    issued = auth_service.create_session(user)
    _issue_session(response, settings, issued.token)
    return SuccessEnvelope(data=auth_service.current_user_response(user))


@router.get("/me", response_model=SuccessEnvelope[CurrentUserResponse])
def read_current_session(
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessEnvelope[CurrentUserResponse]:
    return SuccessEnvelope(data=auth_service.current_user_response(current_user))


@router.post("/change-password", response_model=SuccessEnvelope[MessageData])
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessEnvelope[MessageData]:
    auth_service.change_password(
        current_user,
        payload.current_password,
        payload.new_password,
    )
    return SuccessEnvelope(data=MessageData(message="Password updated"))


@router.post("/logout", response_model=SuccessEnvelope[MessageData])
def logout(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessEnvelope[MessageData]:
    auth_service.revoke_session_token(read_session_token(request))
    _clear_session(response, settings)
    return SuccessEnvelope(data=MessageData(message="Signed out"))

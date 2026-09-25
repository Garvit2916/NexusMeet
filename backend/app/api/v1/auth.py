from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.dependencies import (
    get_auth_service,
    get_current_user,
    get_settings,
    read_session_token,
)
from app.core.config import Settings
from app.core.security import clear_session_cookie, set_session_cookie
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.common import MessageData, SuccessEnvelope
from app.schemas.user import CurrentUserResponse
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


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
    response: Response,
    settings: Settings = Depends(get_settings),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessEnvelope[CurrentUserResponse]:
    user = auth_service.authenticate(payload.email, payload.password)
    issued = auth_service.create_session(user)
    _issue_session(response, settings, issued.token)
    return SuccessEnvelope(data=auth_service.current_user_response(user))


@router.get("/me", response_model=SuccessEnvelope[CurrentUserResponse])
def read_current_session(
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> SuccessEnvelope[CurrentUserResponse]:
    return SuccessEnvelope(data=auth_service.current_user_response(current_user))


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

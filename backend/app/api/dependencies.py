from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.users import UserIdentityProvider
from app.db.session import get_db
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.services.meeting_service import MeetingService
from app.services.user_service import UserService


def get_current_user_provider(request: Request) -> UserIdentityProvider:
    return request.app.state.user_identity_provider


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    provider: UserIdentityProvider = Depends(get_current_user_provider),
) -> User:
    return UserService(UserRepository(db)).get_required(provider.get_user_id(request))


def get_optional_current_user(
    request: Request,
    db: Session = Depends(get_db),
    provider: UserIdentityProvider = Depends(get_current_user_provider),
) -> User | None:
    user_id = provider.get_optional_user_id(request)
    if user_id is None:
        return None
    return UserService(UserRepository(db)).get_optional(user_id)


def get_meeting_service(db: Session = Depends(get_db)) -> MeetingService:
    return MeetingService(db)


def get_user_service(db: Session = Depends(get_db)) -> UserService:
    return UserService(UserRepository(db))

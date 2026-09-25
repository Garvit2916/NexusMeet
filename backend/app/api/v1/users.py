from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, get_user_service
from app.models.user import User
from app.schemas.common import SuccessEnvelope
from app.schemas.user import CurrentUserResponse
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=SuccessEnvelope[CurrentUserResponse])
def get_me(
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
) -> SuccessEnvelope[CurrentUserResponse]:
    return SuccessEnvelope(data=user_service.get_current(current_user.id))

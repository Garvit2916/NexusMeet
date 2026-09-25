from app.core.errors import AppError
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.user import CurrentUserResponse


class UserService:
    def __init__(self, repository: UserRepository) -> None:
        self.repository = repository

    def get_required(self, user_id: str) -> User:
        user = self.repository.get_by_id(user_id)
        if user is None:
            raise AppError(
                404,
                "CURRENT_USER_NOT_FOUND",
                "The current user does not exist",
                {"user_id": user_id},
            )
        return user

    def get_optional(self, user_id: str) -> User | None:
        return self.repository.get_by_id(user_id)

    def get_current(self, user_id: str) -> CurrentUserResponse:
        user = self.get_required(user_id)
        return CurrentUserResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            avatar_url=user.avatar_url,
            created_at=user.created_at,
            updated_at=user.updated_at,
            hosted_meeting_count=self.repository.count_hosted_meetings(user.id),
            joined_meeting_count=self.repository.count_joined_meetings(user.id),
        )

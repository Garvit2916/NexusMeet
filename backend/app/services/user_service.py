from secrets import token_hex

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

    def create_guest(self, display_name: str) -> User:
        normalized_name = display_name.strip()
        if not normalized_name or len(normalized_name) > 100:
            raise AppError(
                422,
                "INVALID_DISPLAY_NAME",
                "Guest display name must contain between 1 and 100 characters",
            )
        user_id = f"usr_guest_{token_hex(12)}"
        return self.repository.add(
            User(
                id=user_id,
                name=normalized_name,
                email=f"{user_id}@guest.nexusmeet.local",
            )
        )

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

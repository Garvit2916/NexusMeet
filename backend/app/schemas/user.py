from pydantic import AwareDatetime

from app.schemas.common import APIModel


class UserResponse(APIModel):
    id: str
    name: str
    email: str
    avatar_url: str | None
    created_at: AwareDatetime
    updated_at: AwareDatetime


class CurrentUserResponse(UserResponse):
    hosted_meeting_count: int = 0
    joined_meeting_count: int = 0

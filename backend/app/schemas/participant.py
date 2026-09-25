from __future__ import annotations

from datetime import datetime

from pydantic import AliasChoices, Field, model_validator

from app.models.enums import ParticipantRole
from app.schemas.common import APIModel
from app.schemas.user import UserResponse

DisplayName = str


class JoinMeetingRequest(APIModel):
    display_name: DisplayName | None = Field(
        default=None,
        min_length=1,
        max_length=100,
        validation_alias=AliasChoices(
            "display_name",
            "displayName",
            "name",
            "guest_name",
            "user_name",
        ),
    )

    @model_validator(mode="after")
    def normalize_display_name(self) -> JoinMeetingRequest:
        if self.display_name is not None:
            self.display_name = self.display_name.strip()
            if not self.display_name:
                raise ValueError("display_name cannot be blank")
        return self


class MediaStateUpdate(APIModel):
    audio_enabled: bool | None = None
    video_enabled: bool | None = None
    screen_sharing: bool | None = None

    @model_validator(mode="after")
    def validate_state_fields(self) -> MediaStateUpdate:
        if not self.model_fields_set:
            raise ValueError("at least one media state field is required")
        null_fields = [field for field in self.model_fields_set if getattr(self, field) is None]
        if null_fields:
            fields = ", ".join(sorted(null_fields))
            raise ValueError(f"media state fields cannot be null: {fields}")
        return self


class HostMuteUpdate(APIModel):
    muted: bool = True


class ParticipantResponse(APIModel):
    id: int
    user: UserResponse
    user_id: str = ""
    name: str = ""
    display_name: str = ""
    email: str = ""
    avatar_url: str | None = None
    initials: str = ""
    role: ParticipantRole
    is_host: bool = False
    is_online: bool = False
    is_active: bool = False
    is_muted: bool = False
    muted_by_host: bool = False
    is_removed: bool = False
    joined_at: datetime | None
    left_at: datetime | None
    removed_at: datetime | None = None
    audio_enabled: bool
    video_enabled: bool
    screen_sharing: bool
    updated_at: datetime
    joinedAt: datetime | None = None
    avatarUrl: str | None = None
    userId: str = ""
    displayName: str = ""
    isOnline: bool = False
    isHost: bool = False
    isMuted: bool = False
    isRemoved: bool = False
    mutedByHost: bool = False
    audioEnabled: bool = False
    videoEnabled: bool = False

    @model_validator(mode="after")
    def populate_participant_fields(self) -> ParticipantResponse:
        self.user_id = self.user_id or self.user.id
        self.display_name = self.display_name.strip() or self.user.name
        self.name = self.display_name
        self.email = self.email or self.user.email
        self.avatar_url = self.avatar_url or self.user.avatar_url
        self.initials = self.initials or self._build_initials(self.display_name)
        self.is_host = self.role is ParticipantRole.HOST
        self.is_removed = self.is_removed or self.removed_at is not None
        self.is_online = self.is_online and not self.is_removed
        self.is_active = self.is_online and self.joined_at is not None
        self.muted_by_host = self.is_muted and not self.audio_enabled
        self.joinedAt = self.joinedAt or self.joined_at
        self.avatarUrl = self.avatarUrl or self.avatar_url
        self.userId = self.userId or self.user_id
        self.displayName = self.displayName or self.display_name
        self.isOnline = self.is_online
        self.isHost = self.is_host
        self.isMuted = self.is_muted
        self.isRemoved = self.is_removed
        self.mutedByHost = self.muted_by_host
        self.audioEnabled = self.audio_enabled
        self.videoEnabled = self.video_enabled
        return self

    @staticmethod
    def _build_initials(name: str) -> str:
        pieces = [piece for piece in name.split() if piece]
        if not pieces:
            return "?"
        if len(pieces) == 1:
            return pieces[0][:2].upper()
        return f"{pieces[0][0]}{pieces[-1][0]}".upper()

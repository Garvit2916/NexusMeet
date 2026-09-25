from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    AliasChoices,
    AwareDatetime,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

from app.models.enums import MeetingStatus, ParticipantRole
from app.models.meeting import (
    DEFAULT_MEETING_DURATION_MINUTES,
    MAX_MEETING_DURATION_MINUTES,
)
from app.schemas.common import APIModel
from app.schemas.participant import ParticipantResponse
from app.schemas.user import UserResponse

MeetingTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
]
MeetingDescription = Annotated[str, StringConstraints(max_length=2000)]
DisplayName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]
Timezone = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


def normalize_datetime(value: datetime) -> datetime:
    return value.astimezone(UTC)


def _duration_from_end(started_at: datetime, ended_at: datetime) -> int:
    duration_seconds = (ended_at - started_at).total_seconds()
    if duration_seconds <= 0:
        raise ValueError("end time must be after the start time")
    if duration_seconds % 60 != 0:
        raise ValueError("meeting duration must be a whole number of minutes")
    duration_minutes = int(duration_seconds // 60)
    if duration_minutes > MAX_MEETING_DURATION_MINUTES:
        raise ValueError("meeting duration cannot exceed 1440 minutes")
    return duration_minutes


class ScheduleMeetingRequest(APIModel):
    title: MeetingTitle
    scheduled_at: AwareDatetime = Field(
        validation_alias=AliasChoices("scheduled_at", "start_time", "startTime")
    )
    description: MeetingDescription = ""
    duration_minutes: int = Field(
        default=DEFAULT_MEETING_DURATION_MINUTES,
        ge=1,
        le=1440,
        validation_alias=AliasChoices("duration_minutes", "duration", "durationMinutes"),
    )
    end_time: AwareDatetime | None = Field(
        default=None,
        validation_alias=AliasChoices("end_time", "endTime"),
    )
    timezone: Timezone = "UTC"
    invite_emails: list[EmailStr] = Field(
        default_factory=list,
        max_length=100,
        validation_alias=AliasChoices("invite_emails", "inviteEmails"),
    )

    @model_validator(mode="after")
    def normalize_schedule(self) -> ScheduleMeetingRequest:
        self.scheduled_at = normalize_datetime(self.scheduled_at)
        if self.end_time is not None:
            self.end_time = normalize_datetime(self.end_time)
            end_duration = _duration_from_end(self.scheduled_at, self.end_time)
            if (
                "duration_minutes" in self.model_fields_set
                and self.duration_minutes != end_duration
            ):
                raise ValueError("duration_minutes must match end_time")
            self.duration_minutes = end_duration
        self.invite_emails = list(dict.fromkeys(email.lower() for email in self.invite_emails))
        return self


class CreateInstantMeetingRequest(APIModel):
    title: MeetingTitle | None = "Instant meeting"
    description: MeetingDescription = ""
    duration_minutes: int = Field(
        default=DEFAULT_MEETING_DURATION_MINUTES,
        ge=1,
        le=1440,
        validation_alias=AliasChoices("duration_minutes", "duration", "durationMinutes"),
    )
    timezone: Timezone = "UTC"
    invite_emails: list[EmailStr] = Field(
        default_factory=list,
        max_length=100,
        validation_alias=AliasChoices("invite_emails", "inviteEmails"),
    )

    @model_validator(mode="after")
    def normalize_invitees(self) -> CreateInstantMeetingRequest:
        self.invite_emails = list(dict.fromkeys(email.lower() for email in self.invite_emails))
        return self


class UpdateMeetingRequest(APIModel):
    title: MeetingTitle | None = None
    description: MeetingDescription | None = None
    scheduled_at: AwareDatetime | None = Field(
        default=None,
        validation_alias=AliasChoices("scheduled_at", "start_time", "startTime"),
    )
    duration_minutes: int | None = Field(
        default=None,
        ge=1,
        le=1440,
        validation_alias=AliasChoices("duration_minutes", "duration", "durationMinutes"),
    )
    end_time: AwareDatetime | None = Field(
        default=None,
        validation_alias=AliasChoices("end_time", "endTime"),
    )
    timezone: Timezone | None = None

    @model_validator(mode="after")
    def validate_update(self) -> UpdateMeetingRequest:
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        null_fields = [field for field in self.model_fields_set if getattr(self, field) is None]
        if null_fields:
            fields = ", ".join(sorted(null_fields))
            raise ValueError(f"fields cannot be null: {fields}")
        if self.scheduled_at is not None:
            self.scheduled_at = normalize_datetime(self.scheduled_at)
        if self.end_time is not None:
            self.end_time = normalize_datetime(self.end_time)
        if self.scheduled_at is not None and self.end_time is not None:
            end_duration = _duration_from_end(self.scheduled_at, self.end_time)
            if self.duration_minutes is not None and self.duration_minutes != end_duration:
                raise ValueError("duration_minutes must match end_time")
            self.duration_minutes = end_duration
        return self


class MeetingHostResponse(UserResponse):
    initials: str = ""
    role: Literal["host"] = "host"
    avatarUrl: str | None = None

    @model_validator(mode="after")
    def populate_host_fields(self) -> MeetingHostResponse:
        self.initials = self._build_initials(self.name)
        self.avatarUrl = self.avatar_url
        return self

    @staticmethod
    def _build_initials(name: str) -> str:
        pieces = [piece for piece in name.split() if piece]
        if not pieces:
            return "?"
        if len(pieces) == 1:
            return pieces[0][:2].upper()
        return f"{pieces[0][0]}{pieces[-1][0]}".upper()


class MeetingBase(APIModel):
    id: str
    meeting_id: str
    public_id: str
    public_meeting_id: str
    meeting_code: str
    host_id: str
    host: MeetingHostResponse
    title: str
    description: str
    duration_minutes: int
    duration: int
    timezone: str
    scheduled_at: AwareDatetime | None
    start_time: AwareDatetime | None
    end_time: AwareDatetime | None
    status: MeetingStatus
    display_status: str
    is_instant: bool
    started_at: AwareDatetime | None
    ended_at: AwareDatetime | None
    cancelled_at: AwareDatetime | None
    created_at: AwareDatetime
    updated_at: AwareDatetime
    createdAt: AwareDatetime = Field(validation_alias=AliasChoices("createdAt", "created_at"))
    frontend_status: str
    invite_link: str
    invite_url: str
    join_url: str
    meeting_link: str
    code_link: str
    room_id: str
    startTime: AwareDatetime | None
    endTime: AwareDatetime | None
    meetingCode: str
    joinUrl: str
    inviteLink: str
    publicId: str
    roomId: str


class MeetingListItem(MeetingBase):
    participants: list[ParticipantResponse] = Field(default_factory=list)
    participant_count: int = 0
    current_user_role: ParticipantRole | None = None


class MeetingDetails(MeetingListItem):
    is_current_user_participant: bool = False


class MeetingList(APIModel):
    items: list[MeetingListItem]
    meetings: list[MeetingListItem] = Field(default_factory=list)
    total: int = 0

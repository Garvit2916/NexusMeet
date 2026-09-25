from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.session import UTCDateTime
from app.models.enums import MeetingStatus
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.participant import MeetingParticipant
    from app.models.user import User


meeting_status_enum = Enum(
    MeetingStatus,
    values_callable=lambda enum_type: [member.value for member in enum_type],
    native_enum=False,
    create_constraint=True,
    validate_strings=True,
    length=16,
    name="meeting_status",
)

DEFAULT_MEETING_DURATION_MINUTES = 30
MAX_MEETING_DURATION_MINUTES = 1440


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    host_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(
        Integer,
        default=DEFAULT_MEETING_DURATION_MINUTES,
        nullable=False,
    )
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    status: Mapped[MeetingStatus] = mapped_column(
        meeting_status_enum,
        default=MeetingStatus.SCHEDULED,
        nullable=False,
    )
    is_instant: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at = mapped_column(UTCDateTime, default=utc_now, nullable=False)
    updated_at = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now, nullable=False)

    host: Mapped[User] = relationship(back_populates="hosted_meetings", foreign_keys=[host_id])
    participants: Mapped[list[MeetingParticipant]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="raise",
    )

    __table_args__ = (
        CheckConstraint(
            "is_instant = 0 OR scheduled_at IS NULL",
            name="ck_meetings_instant_without_schedule",
        ),
        CheckConstraint(
            "duration_minutes > 0",
            name="ck_meetings_positive_duration",
        ),
        Index("ix_meetings_host_created_at", "host_id", "created_at"),
        Index("ix_meetings_status_scheduled_at", "status", "scheduled_at"),
        Index("ix_meetings_created_at", "created_at"),
    )

    @property
    def meeting_id(self) -> str:
        return self.id

    @property
    def public_id(self) -> str:
        return self.id

    @property
    def public_meeting_id(self) -> str:
        return self.id

    @property
    def meeting_code(self) -> str:
        from app.utils.ids import meeting_code_from_id

        return meeting_code_from_id(self.id)

    @property
    def invite_link(self) -> str:
        return f"/meeting/{self.public_id}"

    @property
    def join_url(self) -> str:
        return self.invite_link

    @property
    def invite_url(self) -> str:
        return self.invite_link

    @property
    def meeting_link(self) -> str:
        return self.invite_link

    @property
    def code_link(self) -> str:
        return f"/meeting/{self.meeting_code}"

    @property
    def room_id(self) -> str:
        return f"room-{self.public_id}"

    @property
    def duration(self) -> int:
        return self.duration_minutes

    @property
    def start_time(self) -> datetime | None:
        return self.started_at or self.scheduled_at

    @property
    def end_time(self) -> datetime | None:
        start_time = self.start_time
        if start_time is None:
            return None
        return start_time + timedelta(minutes=self.duration_minutes)

    @property
    def startTime(self) -> datetime | None:
        return self.start_time

    @property
    def endTime(self) -> datetime | None:
        return self.end_time

    @property
    def meetingCode(self) -> str:
        return self.meeting_code

    @property
    def joinUrl(self) -> str:
        return self.join_url

    @property
    def inviteLink(self) -> str:
        return self.invite_link

    @property
    def publicId(self) -> str:
        return self.public_id

    @property
    def roomId(self) -> str:
        return self.room_id

    @property
    def display_status(self) -> str:
        if self.status is MeetingStatus.SCHEDULED:
            return "upcoming"
        return self.status.value

    @property
    def frontend_status(self) -> str:
        return self.display_status

    @property
    def createdAt(self) -> datetime:
        return self.created_at

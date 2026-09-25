from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.session import UTCDateTime
from app.models.enums import ParticipantRole
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.user import User


participant_role_enum = Enum(
    ParticipantRole,
    values_callable=lambda enum_type: [member.value for member in enum_type],
    native_enum=False,
    create_constraint=True,
    validate_strings=True,
    length=16,
    name="participant_role",
)


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[ParticipantRole] = mapped_column(
        participant_role_enum,
        default=ParticipantRole.ATTENDEE,
        nullable=False,
    )
    joined_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    display_name: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    audio_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    video_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    screen_sharing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_muted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at = mapped_column(UTCDateTime, default=utc_now, nullable=False)
    updated_at = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now, nullable=False)

    meeting: Mapped[Meeting] = relationship(back_populates="participants")
    user: Mapped[User] = relationship(back_populates="participations")

    __table_args__ = (
        UniqueConstraint(
            "meeting_id",
            "user_id",
            name="uq_meeting_participants_meeting_user",
        ),
        CheckConstraint(
            "left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at",
            name="ck_meeting_participants_valid_interval",
        ),
        Index("ix_meeting_participants_meeting_joined_at", "meeting_id", "joined_at"),
        Index("ix_meeting_participants_user_meeting", "user_id", "meeting_id"),
    )

    @property
    def is_online(self) -> bool:
        return self.joined_at is not None and self.left_at is None

    @property
    def is_removed(self) -> bool:
        return self.removed_at is not None

    @property
    def is_active(self) -> bool:
        return self.is_online and not self.is_removed

    @property
    def is_muted_by_host(self) -> bool:
        return self.is_muted and not self.audio_enabled

    @property
    def is_host(self) -> bool:
        return self.role.value == "host" if hasattr(self.role, "value") else self.role == "host"

    @property
    def name(self) -> str:
        return self.display_name or self.user.name

    @property
    def email(self) -> str:
        return self.user.email

    @property
    def avatar_url(self) -> str | None:
        return self.user.avatar_url

    @property
    def initials(self) -> str:
        pieces = [piece for piece in self.name.split() if piece]
        if not pieces:
            return "?"
        if len(pieces) == 1:
            return pieces[0][:2].upper()
        return f"{pieces[0][0]}{pieces[-1][0]}".upper()

    @property
    def userId(self) -> str:
        return self.user_id

    @property
    def displayName(self) -> str:
        return self.name

    @property
    def isOnline(self) -> bool:
        return self.is_online

    @property
    def isHost(self) -> bool:
        return self.is_host

    @property
    def audioEnabled(self) -> bool:
        return self.audio_enabled

    @property
    def videoEnabled(self) -> bool:
        return self.video_enabled

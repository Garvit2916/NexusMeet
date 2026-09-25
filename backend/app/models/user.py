from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.session import UTCDateTime
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.participant import MeetingParticipant


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at = mapped_column(UTCDateTime, default=utc_now, nullable=False)
    updated_at = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now, nullable=False)

    hosted_meetings: Mapped[list[Meeting]] = relationship(
        back_populates="host",
        foreign_keys="Meeting.host_id",
    )
    participations: Mapped[list[MeetingParticipant]] = relationship(
        back_populates="user",
        foreign_keys="MeetingParticipant.user_id",
    )

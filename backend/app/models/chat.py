from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.session import UTCDateTime
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.participant import MeetingParticipant
    from app.models.user import User

# Chat is deliberately small: a meeting transcript is not a document store, and
# the signaling frame limit already caps a single message.
MAX_CHAT_BODY_LENGTH = 1000


class MeetingChatMessage(Base):
    """One in-meeting chat message.

    `participant_id` is captured at send time rather than resolved on read, so a
    message keeps the name it was sent under even if the participant later
    renames themselves or leaves.
    """

    __tablename__ = "meeting_chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
    )
    participant_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("meeting_participants.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_name: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    body: Mapped[str] = mapped_column(String(MAX_CHAT_BODY_LENGTH), nullable=False)
    created_at = mapped_column(UTCDateTime, default=utc_now, nullable=False)

    meeting: Mapped[Meeting] = relationship()
    participant: Mapped[MeetingParticipant] = relationship()
    user: Mapped[User] = relationship()

    __table_args__ = (
        # History is always read newest-last for one meeting, so the read path is
        # a single range scan on this index.
        Index("ix_meeting_chat_messages_meeting_id_id", "meeting_id", "id"),
    )

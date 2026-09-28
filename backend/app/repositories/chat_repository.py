from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from app.models.chat import MeetingChatMessage

# A meeting transcript is a convenience, not an archive. Older rows are pruned
# rather than retained forever so the table cannot grow without bound on a
# long-lived deployment.
CHAT_RETENTION_PER_MEETING = 500


class ChatRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(
        self,
        *,
        meeting_id: str,
        participant_id: int,
        user_id: str,
        sender_name: str,
        body: str,
    ) -> MeetingChatMessage:
        message = MeetingChatMessage(
            meeting_id=meeting_id,
            participant_id=participant_id,
            user_id=user_id,
            sender_name=sender_name,
            body=body,
        )
        self.session.add(message)
        self.session.flush()
        return message

    def list_recent(self, meeting_id: str, *, limit: int) -> list[MeetingChatMessage]:
        """Return up to `limit` messages in chronological order.

        The newest rows are selected first so the limit truncates the *oldest*
        part of the history, then the result is reversed back into reading
        order. Selecting on `id` rather than `created_at` keeps the ordering
        total even when two messages land in the same clock tick.
        """
        statement = (
            select(MeetingChatMessage)
            .where(MeetingChatMessage.meeting_id == meeting_id)
            .order_by(MeetingChatMessage.id.desc())
            .limit(limit)
        )
        return list(reversed(self.session.scalars(statement).all()))

    def prune(self, meeting_id: str, *, keep: int = CHAT_RETENTION_PER_MEETING) -> int:
        """Delete everything beyond the newest `keep` messages for one meeting."""
        total = self.session.scalar(
            select(func.count())
            .select_from(MeetingChatMessage)
            .where(MeetingChatMessage.meeting_id == meeting_id)
        )
        if not total or total <= keep:
            return 0
        cutoff = self.session.scalar(
            select(MeetingChatMessage.id)
            .where(MeetingChatMessage.meeting_id == meeting_id)
            .order_by(MeetingChatMessage.id.desc())
            .offset(keep)
            .limit(1)
        )
        if cutoff is None:
            return 0
        # Typed as CursorResult because a bulk DELETE reports its rowcount, which
        # the generic Result type does not expose.
        result: CursorResult[Any] = self.session.execute(  # type: ignore[assignment]
            delete(MeetingChatMessage).where(
                MeetingChatMessage.meeting_id == meeting_id,
                MeetingChatMessage.id <= cutoff,
            )
        )
        self.session.commit()
        return int(result.rowcount or 0)

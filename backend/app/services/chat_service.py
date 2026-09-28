from __future__ import annotations

import unicodedata

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.chat import MAX_CHAT_BODY_LENGTH, MeetingChatMessage
from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.participant import MeetingParticipant
from app.repositories.chat_repository import ChatRepository
from app.repositories.meeting_repository import MeetingRepository
from app.repositories.participant_repository import ParticipantRepository

# How many messages the live socket replays to someone joining mid-meeting.
CHAT_HISTORY_LIMIT = 50
# Upper bound accepted on the REST history endpoint.
CHAT_HISTORY_MAX_LIMIT = 200

# Control characters are stripped because they carry no meaning in a chat line
# but can corrupt rendering and smuggle terminal escapes into logs.
_CONTROL_CHARACTERS = dict.fromkeys(code for code in range(0x20) if code not in (0x09, 0x0A, 0x0D))
# Zero-width and bidirectional-override codepoints can disguise the real
# content of a line, so they are removed rather than rendered.
_INVISIBLE = dict.fromkeys(
    (
        0x200B,
        0x200C,
        0x200D,
        0x200E,
        0x200F,
        0x202A,
        0x202B,
        0x202C,
        0x202D,
        0x202E,
        0x2066,
        0x2067,
        0x2068,
        0x2069,
        0xFEFF,
    )
)
_STRIP_TABLE = {**_CONTROL_CHARACTERS, **_INVISIBLE}


def normalize_chat_body(raw: str) -> str:
    """Reduce a message to the text a person meant to send.

    Unicode is normalised to NFC first so visually identical strings compare
    equal, and the result is length-checked afterwards: a message that only
    looked empty because it was made of invisible characters must be rejected,
    not silently accepted as blank.
    """
    cleaned = unicodedata.normalize("NFC", raw).translate(_STRIP_TABLE)
    return " ".join(cleaned.split())


class ChatService:
    """Reads and writes meeting chat.

    Every entry point re-derives the caller's participant row instead of
    trusting an id from the request, so a removed participant or a non-participant
    cannot read or post into a meeting.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self.messages = ChatRepository(db)
        self.meetings = MeetingRepository(db)
        self.participants = ParticipantRepository(db)

    def post_message(
        self,
        meeting_id: str,
        *,
        user_id: str,
        raw_body: str,
    ) -> MeetingChatMessage:
        meeting, participant = self._require_participant(meeting_id, user_id)
        if meeting.status is not MeetingStatus.LIVE:
            raise AppError(
                409,
                "MEETING_NOT_LIVE",
                "This meeting is not live",
            )

        body = normalize_chat_body(raw_body)
        if not body:
            raise AppError(
                400,
                "MESSAGE_EMPTY",
                "A chat message cannot be empty",
            )
        if len(body) > MAX_CHAT_BODY_LENGTH:
            raise AppError(
                400,
                "MESSAGE_TOO_LONG",
                f"Chat messages are limited to {MAX_CHAT_BODY_LENGTH} characters",
            )

        message = self.messages.add(
            meeting_id=meeting.id,
            participant_id=participant.id,
            user_id=user_id,
            sender_name=participant.name,
            body=body,
        )
        self.messages.prune(meeting.id)
        self.db.commit()
        self.db.refresh(message)
        return message

    def list_messages(
        self,
        meeting_id: str,
        *,
        user_id: str,
        limit: int = CHAT_HISTORY_LIMIT,
    ) -> list[MeetingChatMessage]:
        meeting, _ = self._require_participant(meeting_id, user_id)
        return self.messages.list_recent(meeting.id, limit=limit)

    def _require_participant(
        self, meeting_id: str, user_id: str
    ) -> tuple[Meeting, MeetingParticipant]:
        meeting = self.meetings.get_by_identifier(meeting_id)
        if meeting is None:
            raise AppError(
                404,
                "MEETING_NOT_FOUND",
                "Meeting not found",
                {"meeting_id": meeting_id},
            )
        participant = self.participants.get_for_user(meeting.id, user_id)
        if participant is None or not participant.is_active:
            raise AppError(
                403,
                "CHAT_ACCESS_DENIED",
                "Only active participants can use meeting chat",
            )
        return meeting, participant

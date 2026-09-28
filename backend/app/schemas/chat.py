from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.models.chat import MAX_CHAT_BODY_LENGTH
from app.schemas.common import APIModel


class ChatMessageResponse(APIModel):
    """One stored chat message, exactly as the signaling frames carry it.

    Field names are snake_case to match the rest of the signaling protocol, so
    the same shape works over REST history and over the live socket without a
    second translation on the client.
    """

    id: int
    user_id: str
    participant_id: int
    sender_name: str
    body: str = Field(max_length=MAX_CHAT_BODY_LENGTH)
    created_at: datetime

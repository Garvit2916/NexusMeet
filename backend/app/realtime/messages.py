from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field, TypeAdapter

from app.schemas.common import APIModel

MAX_SDP_PAYLOAD_BYTES = 64 * 1024
ConnectionId = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class JoinMessage(APIModel):
    type: Literal["join"]


class SessionDescription(APIModel):
    sdp: dict[str, Any]


class TargetedDescription(APIModel):
    type: Literal["offer", "answer"]
    target: ConnectionId
    sdp: dict[str, Any]


class IceCandidateMessage(APIModel):
    type: Literal["ice-candidate"]
    target: ConnectionId
    candidate: dict[str, Any]


class MediaStateMessage(APIModel):
    type: Literal["media-state"]
    audio_enabled: bool
    video_enabled: bool
    screen_sharing: bool = False


class LeaveMessage(APIModel):
    type: Literal["leave"]


class PingMessage(APIModel):
    type: Literal["ping"]


ClientMessage = Annotated[
    JoinMessage
    | TargetedDescription
    | IceCandidateMessage
    | MediaStateMessage
    | LeaveMessage
    | PingMessage,
    Field(discriminator="type"),
]

_client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


class SignalingProtocolError(Exception):
    """Raised for a message the server refuses to act on."""


def parse_client_message(raw: str) -> ClientMessage:
    """Parse and size-check one inbound signaling frame.

    Every accepted type is enumerated, so an unknown `type` is rejected instead
    of reaching the hub, and an oversized SDP blob is refused before it can be
    fanned out to every peer in the room.
    """
    if len(raw.encode("utf-8")) > MAX_SDP_PAYLOAD_BYTES:
        raise SignalingProtocolError("message exceeds the maximum signaling frame size")
    try:
        return _client_message_adapter.validate_json(raw)
    except ValueError as error:
        raise SignalingProtocolError("message is not a valid signaling frame") from error

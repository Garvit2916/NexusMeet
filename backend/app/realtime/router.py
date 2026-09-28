from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
from typing import Any, cast

from fastapi import APIRouter, Path, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.errors import AppError
from app.models.chat import MeetingChatMessage
from app.models.enums import MeetingStatus
from app.realtime.hub import SignalingConnection, hub
from app.realtime.messages import (
    ChatMessage,
    IceCandidateMessage,
    JoinMessage,
    LeaveMessage,
    MediaStateMessage,
    PingMessage,
    SignalingProtocolError,
    TargetedDescription,
    parse_client_message,
)
from app.realtime.tickets import InvalidTicketError, ice_servers, verify_ticket
from app.repositories.meeting_repository import MeetingRepository
from app.repositories.participant_repository import ParticipantRepository
from app.services.chat_service import CHAT_HISTORY_LIMIT, ChatService
from app.utils.ids import (
    MEETING_ID_MAX_LENGTH,
    MEETING_IDENTIFIER_MIN_LENGTH,
    MEETING_IDENTIFIER_PATTERN,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["signaling"])

# Close codes for the signaling layer, from the private 4000+ range.
CLOSE_UNAUTHORIZED = 4001
CLOSE_ROOM_FULL = 4005
HEARTBEAT_INTERVAL_SECONDS = 25


def _origin_allowed(settings: Settings, origin: str | None) -> bool:
    """Reject handshakes from pages this service does not serve.

    The session cookie is not sent on this cross-origin socket, so the ticket is
    the credential. Checking the origin as well keeps a ticket that leaks out of
    band from being replayed by an unrelated page.
    """
    if not origin:
        return False
    return origin in settings.cors_origin_list


def _authorize(
    session: Session,
    settings: Settings,
    *,
    meeting_id: str,
    ticket: str,
) -> SignalingConnection | None:
    """Validate a handshake and build the connection, or return None to refuse.

    Identity comes from the signed ticket and is then re-checked against the
    database, so a client cannot claim another `userId`, act as host, or reach a
    meeting it is not an active participant of.
    """
    try:
        identity = verify_ticket(settings, ticket, meeting_id=meeting_id)
    except InvalidTicketError as error:
        logger.info("Rejected signaling ticket: %s", error)
        return None

    meeting = MeetingRepository(session).get_by_identifier(meeting_id)
    if meeting is None or meeting.status is not MeetingStatus.LIVE:
        return None

    participant = ParticipantRepository(session).get_for_user(meeting.id, identity.user_id)
    if participant is None or participant.removed_at is not None:
        return None
    if participant.joined_at is None or participant.left_at is not None:
        return None

    return SignalingConnection(
        connection_id=secrets.token_urlsafe(12),
        meeting_id=meeting.id,
        user_id=identity.user_id,
        participant_id=participant.id,
        display_name=participant.name,
        is_host=meeting.host_id == identity.user_id,
        # Replaced with the real socket by the endpoint right after accept().
        websocket=cast(Any, None),
        audio_enabled=participant.audio_enabled,
        video_enabled=participant.video_enabled,
        screen_sharing=participant.screen_sharing,
    )


@router.websocket("/ws/meetings/{meeting_id}")
async def meeting_signaling_socket(
    websocket: WebSocket,
    meeting_id: str = Path(
        min_length=MEETING_IDENTIFIER_MIN_LENGTH,
        max_length=MEETING_ID_MAX_LENGTH,
        pattern=MEETING_IDENTIFIER_PATTERN,
    ),
    ticket: str = Query(min_length=16, max_length=1024),
) -> None:
    settings: Settings = websocket.app.state.settings
    session_factory = cast(sessionmaker[Session], websocket.app.state.session_factory)

    if not _origin_allowed(settings, websocket.headers.get("origin")):
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    with session_factory() as session:
        connection = _authorize(session, settings, meeting_id=meeting_id, ticket=ticket)
    if connection is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    # A returning user is always allowed back in; a genuinely new peer only fits
    # while the mesh is below the configured ceiling.
    if (
        not hub.is_connected(connection.meeting_id, connection.user_id)
        and hub.room_size(connection.meeting_id) >= settings.max_webrtc_participants
    ):
        await websocket.close(code=CLOSE_ROOM_FULL)
        return

    await websocket.accept()
    connection.websocket = websocket
    peers = await hub.register(connection)

    await hub.send(
        connection,
        {
            "type": "welcome",
            "self": connection.describe(),
            "peers": [peer.describe() for peer in peers],
            "ice_servers": ice_servers(settings),
            # Replay the tail of the transcript so someone who joins late, or
            # reconnects after a drop, does not land in a blank panel.
            "messages": _chat_history(session_factory, connection.meeting_id, connection.user_id),
        },
    )
    await hub.broadcast(
        connection.meeting_id,
        {"type": "peer-joined", "peer": connection.describe()},
        exclude_connection_id=connection.connection_id,
    )
    await _broadcast_media_state(connection)

    heartbeat = asyncio.create_task(_heartbeat(websocket))
    try:
        while True:
            await _handle_message(connection, await websocket.receive_text(), session_factory)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception(
            "Signaling socket failed",
            extra={"meeting_id": connection.meeting_id, "user_id": connection.user_id},
        )
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat
        await hub.unregister(connection)
        await hub.broadcast(
            connection.meeting_id,
            {
                "type": "peer-left",
                "connection_id": connection.connection_id,
                "user_id": connection.user_id,
            },
            exclude_connection_id=connection.connection_id,
        )


async def _heartbeat(websocket: WebSocket) -> None:
    """Keep intermediaries from dropping an otherwise idle socket."""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
        with contextlib.suppress(Exception):
            await websocket.send_text('{"type":"ping"}')


async def _broadcast_media_state(connection: SignalingConnection) -> None:
    await hub.broadcast(
        connection.meeting_id,
        {
            "type": "media-state",
            "user_id": connection.user_id,
            "connection_id": connection.connection_id,
            "audio_enabled": connection.audio_enabled,
            "video_enabled": connection.video_enabled,
            "screen_sharing": connection.screen_sharing,
        },
        exclude_connection_id=connection.connection_id,
    )


async def _handle_message(
    connection: SignalingConnection,
    raw: str,
    session_factory: sessionmaker[Session],
) -> None:
    try:
        message = parse_client_message(raw)
    except SignalingProtocolError as error:
        await hub.send(
            connection,
            {"type": "error", "code": "INVALID_MESSAGE", "message": str(error)},
        )
        return

    if isinstance(message, LeaveMessage):
        raise WebSocketDisconnect(code=1000)

    if isinstance(message, JoinMessage):
        # Membership was already proven during the handshake. Re-sending the
        # roster lets a client resync after a reconnect without refetching.
        peers = [
            peer.describe()
            for peer in hub.room_connections(connection.meeting_id)
            if peer.connection_id != connection.connection_id
        ]
        await hub.send(
            connection,
            {
                "type": "welcome",
                "self": connection.describe(),
                "peers": peers,
                "messages": _chat_history(
                    session_factory, connection.meeting_id, connection.user_id
                ),
            },
        )
        return

    if isinstance(message, (TargetedDescription, IceCandidateMessage)):
        await _relay(connection, message)
        return

    if isinstance(message, MediaStateMessage):
        connection.audio_enabled = message.audio_enabled
        connection.video_enabled = message.video_enabled
        connection.screen_sharing = message.screen_sharing
        await _broadcast_media_state(connection)
        return

    if isinstance(message, ChatMessage):
        await _handle_chat(connection, message, session_factory)
        return

    if isinstance(message, PingMessage):
        await hub.send(connection, {"type": "pong"})


def _chat_history(
    session_factory: sessionmaker[Session],
    meeting_id: str,
    user_id: str,
    *,
    limit: int = CHAT_HISTORY_LIMIT,
) -> list[dict[str, Any]]:
    """Read the replay buffer, degrading to an empty transcript on failure.

    A database hiccup must not cost the peer its media session, so history is
    treated as best-effort context rather than a condition for joining.
    """
    try:
        with session_factory() as session:
            messages = ChatService(session).list_messages(meeting_id, user_id=user_id, limit=limit)
    except AppError as error:
        logger.info("Chat history unavailable: %s", error.code)
        return []
    except Exception:
        logger.exception("Chat history read failed", extra={"meeting_id": meeting_id})
        return []
    return [_describe_chat(message) for message in messages]


def _describe_chat(message: MeetingChatMessage) -> dict[str, Any]:
    """Render a stored message for the wire.

    The body is passed through as plain text. It is never marked safe, never
    re-encoded, and never interpreted here, so a client that renders it as text
    cannot be made to execute it.
    """
    return {
        "id": message.id,
        "user_id": message.user_id,
        "participant_id": message.participant_id,
        "sender_name": message.sender_name,
        "body": message.body,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }


async def _handle_chat(
    connection: SignalingConnection,
    message: ChatMessage,
    session_factory: sessionmaker[Session],
) -> None:
    """Persist one chat message and fan it out to the whole room.

    The sender is re-authorised against the database on every send rather than
    trusted from the handshake, so a participant removed mid-meeting stops being
    able to post. Persistence runs in a worker thread: it is blocking I/O and
    must not stall the event loop that is relaying this participant's media.
    """
    try:
        stored = await asyncio.to_thread(
            _persist_chat, session_factory, connection.meeting_id, connection.user_id, message.body
        )
    except AppError as error:
        await hub.send(
            connection,
            {"type": "error", "code": error.code, "message": error.message},
        )
        return
    except Exception:
        # The message text is deliberately absent from this log.
        logger.exception("Chat send failed", extra={"meeting_id": connection.meeting_id})
        await hub.send(
            connection,
            {
                "type": "error",
                "code": "CHAT_UNAVAILABLE",
                "message": "Your message could not be sent",
            },
        )
        return

    await hub.broadcast(
        connection.meeting_id,
        {"type": "chat", "message": _describe_chat(stored)},
    )


def _persist_chat(
    session_factory: sessionmaker[Session],
    meeting_id: str,
    user_id: str,
    body: str,
) -> MeetingChatMessage:
    with session_factory() as session:
        return ChatService(session).post_message(meeting_id, user_id=user_id, raw_body=body)


async def _relay(
    connection: SignalingConnection,
    message: TargetedDescription | IceCandidateMessage,
) -> None:
    """Forward SDP/ICE to a single peer in the same room, stamping the sender.

    `target` is resolved inside this meeting only, so a valid ticket for one
    room still cannot be used to address a socket in another.
    """
    payload: dict[str, Any] = {
        "type": message.type,
        "from": connection.connection_id,
        "from_user_id": connection.user_id,
    }
    if isinstance(message, TargetedDescription):
        payload["sdp"] = message.sdp
    else:
        payload["candidate"] = message.candidate
    if not await hub.send_to_connection(connection.meeting_id, message.target, payload):
        await hub.send(
            connection,
            {
                "type": "error",
                "code": "UNKNOWN_TARGET",
                "message": "That participant is no longer in this meeting",
            },
        )

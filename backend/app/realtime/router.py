from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
from typing import Any, cast

from fastapi import APIRouter, Path, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.models.enums import MeetingStatus
from app.realtime.hub import SignalingConnection, hub
from app.realtime.messages import (
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
            await _handle_message(connection, await websocket.receive_text())
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


async def _handle_message(connection: SignalingConnection, raw: str) -> None:
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
            {"type": "welcome", "self": connection.describe(), "peers": peers},
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

    if isinstance(message, PingMessage):
        await hub.send(connection, {"type": "pong"})


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

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class SignalingConnection:
    """One authenticated browser socket inside a meeting room.

    `connection_id` is ephemeral per tab and is the address used by `target` in
    offer/answer/ice messages. A user id is not unique in a room because the same
    account can be open in more than one tab.
    """

    connection_id: str
    meeting_id: str
    user_id: str
    participant_id: int
    display_name: str
    is_host: bool
    websocket: WebSocket
    audio_enabled: bool = True
    video_enabled: bool = True
    screen_sharing: bool = False
    _write_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    def describe(self) -> dict[str, Any]:
        return {
            "connection_id": self.connection_id,
            "user_id": self.user_id,
            "participant_id": self.participant_id,
            "name": self.display_name,
            "is_host": self.is_host,
            "audio_enabled": self.audio_enabled,
            "video_enabled": self.video_enabled,
            "screen_sharing": self.screen_sharing,
        }


class SignalingHub:
    """In-memory registry of live signaling sockets, grouped by meeting.

    Media never passes through here; this only brokers SDP and ICE between
    browsers. State is intentionally process-local, so a horizontally scaled
    deployment would need a shared broker (Redis pub/sub) plus sticky routing.
    """

    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, SignalingConnection]] = {}
        self._lock = asyncio.Lock()

    def room_size(self, meeting_id: str) -> int:
        return len(self._rooms.get(meeting_id, {}))

    def room_connections(self, meeting_id: str) -> list[SignalingConnection]:
        return list(self._rooms.get(meeting_id, {}).values())

    def total_connections(self) -> int:
        return sum(len(room) for room in self._rooms.values())

    def is_connected(self, meeting_id: str, user_id: str) -> bool:
        return any(
            connection.user_id == user_id
            for connection in self._rooms.get(meeting_id, {}).values()
        )

    async def register(self, connection: SignalingConnection) -> list[SignalingConnection]:
        """Add a socket and return the peers already present in the room.

        A second socket for the same user replaces the older one so a reconnect
        or a duplicated tab cannot leave a ghost peer behind.
        """
        async with self._lock:
            room = self._rooms.setdefault(connection.meeting_id, {})
            replaced = [
                existing
                for existing in room.values()
                if existing.user_id == connection.user_id
                and existing.connection_id != connection.connection_id
            ]
            for existing in replaced:
                room.pop(existing.connection_id, None)
            room[connection.connection_id] = connection
            peers = [
                peer for peer in room.values() if peer.connection_id != connection.connection_id
            ]
        for stale in replaced:
            with contextlib.suppress(Exception):
                await stale.websocket.close(code=4000)
        return peers

    async def unregister(self, connection: SignalingConnection) -> None:
        async with self._lock:
            room = self._rooms.get(connection.meeting_id)
            if room is None:
                return
            if room.get(connection.connection_id) is connection:
                room.pop(connection.connection_id, None)
            if not room:
                self._rooms.pop(connection.meeting_id, None)

    async def send(self, connection: SignalingConnection, payload: dict[str, Any]) -> bool:
        """Write one message, serialized per socket so frames cannot interleave."""
        try:
            async with connection._write_lock:
                await connection.websocket.send_text(
                    json.dumps(payload, separators=(",", ":"), default=str)
                )
            return True
        except Exception:
            logger.debug(
                "Signaling send failed",
                extra={"meeting_id": connection.meeting_id, "type": payload.get("type")},
            )
            return False

    async def send_to_connection(
        self,
        meeting_id: str,
        connection_id: str,
        payload: dict[str, Any],
    ) -> bool:
        """Deliver to one socket, but only when it belongs to the same meeting.

        This is the guard that stops a client from addressing a peer in another
        room by guessing a connection id.
        """
        connection = self._rooms.get(meeting_id, {}).get(connection_id)
        if connection is None:
            return False
        return await self.send(connection, payload)

    async def send_to_user(self, meeting_id: str, user_id: str, payload: dict[str, Any]) -> int:
        delivered = 0
        for connection in list(self._rooms.get(meeting_id, {}).values()):
            if connection.user_id == user_id and await self.send(connection, payload):
                delivered += 1
        return delivered

    async def broadcast(
        self,
        meeting_id: str,
        payload: dict[str, Any],
        *,
        exclude_connection_id: str | None = None,
    ) -> int:
        delivered = 0
        for connection in list(self._rooms.get(meeting_id, {}).values()):
            if connection.connection_id == exclude_connection_id:
                continue
            if await self.send(connection, payload):
                delivered += 1
        return delivered

    async def notify_and_close(
        self,
        meeting_id: str,
        payload: dict[str, Any],
        *,
        code: int = 4004,
    ) -> int:
        """Send one final message to a room, then close every socket in it.

        Used when the host ends a meeting: each client has to receive the reason
        before the socket disappears so it can stop its tracks and redirect.
        """
        delivered = 0
        for connection in list(self._rooms.get(meeting_id, {}).values()):
            if await self.send(connection, payload):
                delivered += 1
        for connection in list(self._rooms.get(meeting_id, {}).values()):
            with contextlib.suppress(Exception):
                await connection.websocket.close(code=code)
            await self.unregister(connection)
        return delivered

    async def disconnect_user(self, meeting_id: str, user_id: str, *, code: int = 4003) -> int:
        """Close every socket a user holds in a room, used for host removal."""
        targets = [
            connection
            for connection in list(self._rooms.get(meeting_id, {}).values())
            if connection.user_id == user_id
        ]
        for connection in targets:
            with contextlib.suppress(Exception):
                await connection.websocket.close(code=code)
            await self.unregister(connection)
        return len(targets)

    async def close_meeting(self, meeting_id: str, *, code: int = 4004) -> int:
        targets = list(self._rooms.get(meeting_id, {}).values())
        for connection in targets:
            with contextlib.suppress(Exception):
                await connection.websocket.close(code=code)
            await self.unregister(connection)
        return len(targets)


hub = SignalingHub()

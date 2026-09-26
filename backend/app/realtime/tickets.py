from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from app.core.config import Settings
from app.utils.time import utc_now

if TYPE_CHECKING:
    from fastapi import Request

TICKET_VERSION = 1
WS_PATH_TEMPLATE = "/ws/meetings/{meeting_id}"


class InvalidTicketError(Exception):
    """Raised when a signaling ticket is missing, malformed, forged, or expired."""


@dataclass(frozen=True)
class SignalingTicket:
    user_id: str
    meeting_id: str
    expires_at_epoch: int


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, TypeError) as error:
        raise InvalidTicketError("malformed ticket encoding") from error


def _sign(secret: str, payload: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return _b64encode(digest)


def issue_ticket(settings: Settings, *, user_id: str, meeting_id: str) -> tuple[str, int]:
    """Mint a short-lived, signed credential for one meeting socket.

    The browser cannot present its first-party session cookie to a cross-origin
    WebSocket, so it trades its authenticated REST session for this ticket
    first. The signature binds the user and meeting together, which means a
    client cannot reuse a ticket to reach a different room.
    """
    expires_at = int(utc_now().timestamp()) + max(settings.ws_ticket_ttl_seconds, 30)
    claims: dict[str, Any] = {
        "v": TICKET_VERSION,
        "sub": user_id,
        "mid": meeting_id,
        "exp": expires_at,
        "jti": secrets.token_hex(8),
    }
    payload = _b64encode(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    return f"{payload}.{_sign(settings.ws_ticket_secret, payload)}", expires_at


def verify_ticket(settings: Settings, ticket: str, *, meeting_id: str) -> SignalingTicket:
    """Validate a ticket and return the identity it asserts.

    The caller still has to confirm that the meeting exists, is live, and that
    this user is an active participant: a valid signature only proves the ticket
    was issued by this service, not that the room is still joinable.
    """
    if not ticket or "." not in ticket:
        raise InvalidTicketError("missing ticket")
    payload, _, signature = ticket.partition(".")
    if not payload or not signature:
        raise InvalidTicketError("missing ticket")
    if not hmac.compare_digest(_sign(settings.ws_ticket_secret, payload), signature):
        raise InvalidTicketError("invalid ticket signature")

    try:
        claims = json.loads(_b64decode(payload).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise InvalidTicketError("malformed ticket payload") from error
    if not isinstance(claims, dict):
        raise InvalidTicketError("malformed ticket payload")
    if claims.get("v") != TICKET_VERSION:
        raise InvalidTicketError("unsupported ticket version")

    user_id = claims.get("sub")
    ticket_meeting_id = claims.get("mid")
    expires_at = claims.get("exp")
    if not isinstance(user_id, str) or not user_id:
        raise InvalidTicketError("ticket is missing a subject")
    if not isinstance(ticket_meeting_id, str) or ticket_meeting_id != meeting_id:
        raise InvalidTicketError("ticket was issued for a different meeting")
    if not isinstance(expires_at, int) or expires_at <= int(utc_now().timestamp()):
        raise InvalidTicketError("ticket has expired")

    return SignalingTicket(user_id=user_id, meeting_id=meeting_id, expires_at_epoch=expires_at)


def resolve_ws_url(settings: Settings, request: Request, *, meeting_id: str) -> str:
    """Work out the absolute wss:// URL the browser should connect to.

    `PUBLIC_WS_URL` is the source of truth in production because REST calls
    arrive through the frontend's same-origin proxy and therefore report the
    proxy's host. Falling back to the request origin keeps local development and
    direct API access working without any configuration.
    """
    path = WS_PATH_TEMPLATE.format(meeting_id=quote(meeting_id, safe=""))
    if settings.public_ws_url:
        return f"{settings.public_ws_url.rstrip('/')}{path}"
    scheme = "wss" if request.url.scheme in {"https", "wss"} else "ws"
    return f"{scheme}://{request.url.netloc}{path}"


def ice_servers(settings: Settings) -> list[dict[str, Any]]:
    """Build the ICE server list handed to the browser with the ticket.

    TURN credentials are resolved here on the server so a permanent credential
    never has to live in the frontend bundle. STUN needs no secret and is
    configured by URL alone.
    """
    servers: list[dict[str, Any]] = []
    if settings.has_turn_credentials:
        servers.append(
            {
                "urls": settings.turn_url_list,
                "username": settings.turn_username,
                "credential": settings.effective_turn_credential,
            }
        )
    servers.extend({"urls": [url]} for url in settings.stun_url_list)
    return servers

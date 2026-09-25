from __future__ import annotations

from typing import Any

from pydantic import Field

from app.schemas.common import APIModel


class SignalingTicketResponse(APIModel):
    """Everything the browser needs to open one authenticated signaling socket.

    `ice_servers` is resolved on the server so a permanent TURN credential is
    never shipped in the frontend bundle, and `ws_url` is absolute because the
    deployed frontend calls the API through a same-origin proxy and cannot infer
    the API host from a relative base URL.
    """

    ticket: str
    ws_url: str
    expires_in: int
    ice_servers: list[dict[str, Any]] = Field(default_factory=list)
    max_participants: int

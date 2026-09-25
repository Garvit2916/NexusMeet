from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

from fastapi import Request

logger = logging.getLogger(__name__)

# Signaling events are a courtesy on top of the REST response: the database is
# already the source of truth, so a failed delivery degrades to the client
# learning the change on its next poll rather than failing the request.
DISPATCH_TIMEOUT_SECONDS = 5.0


def dispatch_to_signaling(request: Request, coro: Coroutine[Any, Any, Any]) -> Any:
    """Run a hub coroutine from a synchronous REST endpoint.

    The endpoints are `def`, so FastAPI runs them in a worker thread with no
    event loop of its own. The loop that served the request is recorded by the
    request-id middleware and is the same loop that owns the room's sockets, so
    the coroutine is handed back to it and waited on briefly. A failed
    notification never breaks the API call.
    """
    loop: asyncio.AbstractEventLoop | None = getattr(request.state, "event_loop", None)
    if loop is None or loop.is_closed():
        coro.close()
        return None
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    try:
        return future.result(timeout=DISPATCH_TIMEOUT_SECONDS)
    except Exception:
        logger.warning("Signaling dispatch failed", exc_info=True)
        return None

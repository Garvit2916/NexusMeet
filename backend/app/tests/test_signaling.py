from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.config import Settings
from app.realtime.hub import SignalingHub
from app.realtime.hub import hub as global_hub
from app.realtime.messages import SignalingProtocolError, parse_client_message
from app.realtime.tickets import (
    InvalidTicketError,
    ice_servers,
    issue_ticket,
    verify_ticket,
)

ALLOWED_ORIGIN = "http://localhost:3000"
FOREIGN_ORIGIN = "https://evil.example.com"


@pytest.fixture(autouse=True)
def reset_hub() -> Iterator[None]:
    """Keep the process-wide hub from leaking sockets between tests."""
    global_hub._rooms.clear()
    yield
    global_hub._rooms.clear()


def create_live_meeting(client: TestClient) -> str:
    response = client.post("/api/v1/meetings/instant", json={})
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


def mint_ticket(client: TestClient, meeting_id: str) -> dict[str, Any]:
    response = client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert isinstance(data, dict)
    return data


@contextlib.contextmanager
def open_socket(
    client: TestClient,
    meeting_id: str,
    ticket: str,
    *,
    token: str,
    origin: str = ALLOWED_ORIGIN,
) -> Iterator[Any]:
    """Open one signaling socket on `client`'s event loop.

    Every socket in a test has to share a single event loop: the hub is a
    process-wide singleton, so broadcasting between sockets bound to different
    loops is not something production ever does and cannot be tested reliably.
    Per-connection cookies let one client hold two identities at once.
    """
    url = f"/ws/meetings/{meeting_id}?ticket={ticket}"
    with client.websocket_connect(
        url,
        cookies={"nexusmeet_session": token},
        headers={"origin": origin},
    ) as socket:
        yield socket


def read(socket: Any) -> dict[str, Any]:
    return socket.receive_json()


def attendee_token(attendee_client: TestClient) -> str:
    token = attendee_client.cookies.get("nexusmeet_session")
    assert token
    return str(token)


# --- ticket issuance -------------------------------------------------------


def test_ticket_requires_authentication(anonymous_client: TestClient) -> None:
    owner = TestClient(anonymous_client.app)
    registration = owner.post(
        "/api/v1/auth/register",
        json={"name": "Owner", "email": "owner@nexusmeet.dev", "password": "owner-pass-1"},
    )
    assert registration.status_code == 201, registration.text
    login = owner.post(
        "/api/v1/auth/login",
        json={"email": "owner@nexusmeet.dev", "password": "owner-pass-1"},
    )
    assert login.status_code == 200
    meeting_id = create_live_meeting(owner)
    owner.cookies.clear()

    response = anonymous_client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_ticket_returns_absolute_ws_url_and_ice_servers(client: TestClient) -> None:
    meeting_id = create_live_meeting(client)
    data = mint_ticket(client, meeting_id)

    assert data["ws_url"] == f"ws://testserver/ws/meetings/{meeting_id}"
    assert data["expires_in"] > 0
    assert data["max_participants"] > 0
    assert data["ice_servers"], "at least a STUN server must be advertised"
    assert data["ice_servers"][0]["urls"] == ["stun:stun.l.google.com:19302"]
    assert "credential" not in data["ice_servers"][0], "STUN needs no credential"


def test_ticket_uses_configured_public_ws_url(client: TestClient, app: Any) -> None:
    app.state.settings.public_ws_url = "wss://nexusmeet-api.onrender.com"
    meeting_id = create_live_meeting(client)
    data = mint_ticket(client, meeting_id)

    assert data["ws_url"] == f"wss://nexusmeet-api.onrender.com/ws/meetings/{meeting_id}"


def test_ticket_rejects_user_who_has_not_joined(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)

    response = attendee_client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "MEETING_ACCESS_DENIED"


def test_ticket_rejected_after_participant_left(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/leave").status_code == 200

    response = attendee_client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "NOT_ACTIVE_PARTICIPANT"


def test_ticket_rejected_for_removed_participant(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    joined = attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participant_id = next(
        item["id"]
        for item in joined.json()["data"]["participants"]
        if item["user"]["email"] == "attendee@nexusmeet.dev"
    )
    assert (
        client.delete(
            f"/api/v1/meetings/{meeting_id}/participants/{participant_id}"
        ).status_code
        == 200
    )

    response = attendee_client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PARTICIPANT_REMOVED"


# --- ticket cryptography ---------------------------------------------------


def test_ticket_round_trip_binds_user_and_meeting() -> None:
    settings = Settings(ws_ticket_secret="unit-test-secret")
    ticket, expires_at = issue_ticket(settings, user_id="usr_a", meeting_id="mtg_b")

    identity = verify_ticket(settings, ticket, meeting_id="mtg_b")
    assert identity.user_id == "usr_a"
    assert identity.meeting_id == "mtg_b"
    assert identity.expires_at_epoch == expires_at


def test_ticket_rejects_tampered_signature() -> None:
    settings = Settings(ws_ticket_secret="unit-test-secret")
    ticket, _ = issue_ticket(settings, user_id="usr_a", meeting_id="mtg_b")
    payload, _, signature = ticket.partition(".")
    forged = f"{payload}.{signature[:-2]}xy"

    with pytest.raises(InvalidTicketError):
        verify_ticket(settings, forged, meeting_id="mtg_b")


def test_ticket_signed_with_another_secret_is_rejected() -> None:
    issued = Settings(ws_ticket_secret="secret-one")
    verifying = Settings(ws_ticket_secret="secret-two")
    ticket, _ = issue_ticket(issued, user_id="usr_a", meeting_id="mtg_b")

    with pytest.raises(InvalidTicketError):
        verify_ticket(verifying, ticket, meeting_id="mtg_b")


def test_ticket_cannot_be_reused_for_another_meeting() -> None:
    settings = Settings(ws_ticket_secret="unit-test-secret")
    ticket, _ = issue_ticket(settings, user_id="usr_a", meeting_id="mtg_b")

    with pytest.raises(InvalidTicketError):
        verify_ticket(settings, ticket, meeting_id="mtg_c")


def test_expired_ticket_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(ws_ticket_secret="unit-test-secret", ws_ticket_ttl_seconds=60)
    ticket, _ = issue_ticket(settings, user_id="usr_a", meeting_id="mtg_b")
    assert verify_ticket(settings, ticket, meeting_id="mtg_b").user_id == "usr_a"

    # Move the service clock past the ticket's expiry instead of sleeping.
    later = datetime.now(UTC) + timedelta(seconds=120)
    monkeypatch.setattr("app.realtime.tickets.utc_now", lambda: later)

    with pytest.raises(InvalidTicketError):
        verify_ticket(settings, ticket, meeting_id="mtg_b")


def test_blank_ws_secret_falls_back_to_development_default() -> None:
    assert Settings(ws_ticket_secret="  ").uses_development_ws_secret


def test_ws_ticket_endpoint_returns_the_configured_turn_server(
    app: FastAPI, client: TestClient
) -> None:
    """The browser learns its TURN credential from this endpoint and nowhere else.

    The helper is unit-tested above, but what actually reaches the browser is the
    HTTP response. Every cross-network failure traced back to this response
    handing out STUN only, so assert the full round trip.
    """
    app.state.settings = app.state.settings.model_copy(
        update={
            "turn_url": "turn:turn.example.com:3478",
            "turn_username": "ephemeral-user",
            "turn_credential": "ephemeral-secret",
        }
    )
    meeting_id = create_live_meeting(client)

    response = client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")
    assert response.status_code == 200, response.text
    servers = response.json()["data"]["ice_servers"]

    # TURN is offered first so the browser spends its candidate budget on the
    # path that actually works behind symmetric NAT.
    assert servers[0] == {
        "urls": ["turn:turn.example.com:3478"],
        "username": "ephemeral-user",
        "credential": "ephemeral-secret",
    }
    # The existing STUN configuration must survive alongside it.
    assert any(str(url).startswith("stun:") for server in servers for url in server["urls"])


def test_ws_ticket_endpoint_never_exposes_turn_outside_ice_servers(
    app: FastAPI, client: TestClient
) -> None:
    """A permanent TURN secret must not reach any other part of the response."""
    app.state.settings = app.state.settings.model_copy(
        update={
            "turn_url": "turn:turn.example.com:3478",
            "turn_username": "ephemeral-user",
            "turn_credential": "ephemeral-secret",
        }
    )
    meeting_id = create_live_meeting(client)

    body = client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket").json()
    rendered = json.dumps(body)

    # The secret is present exactly once: inside ice_servers.
    assert rendered.count("ephemeral-secret") == 1
    assert body["data"]["ice_servers"][0]["credential"] == "ephemeral-secret"
    for field in ("turn", "turn_credential", "turn_username", "config", "settings", "env"):
        assert field not in body["data"]


def test_ws_ticket_endpoint_is_stun_only_until_turn_is_fully_configured(
    app: FastAPI, client: TestClient
) -> None:
    """A partial TURN config must fall back to STUN rather than emit a broken server.

    Emitting a TURN entry with a missing credential yields a gather failure that
    never recovers, so an incomplete config has to look exactly like no TURN.
    """
    # `model_copy(update=...)` merges, so each case must start from a pristine
    # baseline or an earlier case's `turn_url` would satisfy a later one.
    baseline = app.state.settings
    for partial in (
        {"turn_url": "turn:turn.example.com:3478"},
        {"turn_url": "turn:turn.example.com:3478", "turn_username": "ephemeral-user"},
        {"turn_username": "ephemeral-user", "turn_credential": "ephemeral-secret"},
    ):
        app.state.settings = baseline.model_copy(update=partial)
        meeting_id = create_live_meeting(client)

        response = client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")
        servers = response.json()["data"]["ice_servers"]
        assert all("credential" not in server for server in servers), partial
        assert all("username" not in server for server in servers), partial


def test_no_real_turn_credential_is_committed_to_the_repository() -> None:
    """Guard the env templates so a provider credential is never pasted into Git."""
    root = Path(__file__).resolve().parents[3]
    for relative in ("backend/.env.example", "render.yaml"):
        path = root / relative
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            keys = ("TURN_URL", "TURN_URLS", "TURN_USERNAME", "TURN_CREDENTIAL", "TURN_PASSWORD")
            for key in keys:
                if stripped.startswith(f"{key}="):
                    value = stripped.split("=", 1)[1].strip().strip("\"'")
                    # Only documentation placeholders may be committed here.
                    assert value == "", f"{relative} commits a value for {key}"


def test_turn_credentials_are_only_exposed_when_configured() -> None:
    stun_only = ice_servers(Settings(ws_ticket_secret="s"))
    assert all("credential" not in server for server in stun_only)

    with_turn = ice_servers(
        Settings(
            ws_ticket_secret="s",
            turn_url="turn:turn.example.com:3478",
            turn_username="ephemeral-user",
            turn_credential="ephemeral-secret",
        )
    )
    assert with_turn[0]["urls"] == ["turn:turn.example.com:3478"]
    assert with_turn[0]["username"] == "ephemeral-user"
    assert with_turn[0]["credential"] == "ephemeral-secret"


def test_turn_aliases_and_multiple_urls_are_honoured() -> None:
    # Providers document `TURN_URLS`/`TURN_PASSWORD`, so both spellings must
    # work. A typo would otherwise silently leave every call STUN-only.
    plural = ice_servers(
        Settings(
            ws_ticket_secret="s",
            turn_urls="turn:one.example.com:3478,turns:two.example.com:5349",
            turn_username="u",
            turn_password="p",
        )
    )
    assert plural[0]["urls"] == ["turn:one.example.com:3478", "turns:two.example.com:5349"]
    assert plural[0]["username"] == "u"
    assert plural[0]["credential"] == "p"

    # STUN is still advertised after TURN so a direct path is preferred.
    assert plural[-1]["urls"] == ["stun:stun.l.google.com:19302"]


def test_turn_is_not_advertised_without_every_credential() -> None:
    # A partial configuration would hand the browser a relay it cannot use.
    for partial in (
        Settings(ws_ticket_secret="s", turn_url="turn:t.example.com:3478"),
        Settings(ws_ticket_secret="s", turn_url="turn:t.example.com:3478", turn_username="u"),
        Settings(ws_ticket_secret="s", turn_username="u", turn_credential="p"),
    ):
        assert all("credential" not in server for server in ice_servers(partial))


# --- inbound message validation --------------------------------------------


def test_unknown_message_type_is_rejected() -> None:
    with pytest.raises(SignalingProtocolError):
        parse_client_message('{"type":"broadcast-everything"}')


def test_message_with_extra_fields_is_rejected() -> None:
    with pytest.raises(SignalingProtocolError):
        parse_client_message('{"type":"leave","isHost":true}')


def test_oversized_frame_is_rejected() -> None:
    payload = '{"type":"offer","target":"abcdefgh","sdp":{"sdp":"' + "a" * 70_000 + '"}}'
    with pytest.raises(SignalingProtocolError):
        parse_client_message(payload)


def test_valid_messages_parse() -> None:
    join = parse_client_message('{"type":"join"}')
    assert join.type == "join"
    offer = parse_client_message(
        '{"type":"offer","target":"peer_abcdefgh","sdp":{"type":"offer","sdp":"v=0"}}'
    )
    assert offer.type == "offer"
    assert offer.target == "peer_abcdefgh"
    candidate = parse_client_message(
        '{"type":"ice-candidate","target":"peer_abcdefgh",'
        '"candidate":{"candidate":"candidate:1 1 udp 1 10.0.0.1 1 typ host","sdpMid":"0"}}'
    )
    assert candidate.type == "ice-candidate"


# --- websocket handshake ---------------------------------------------------


def test_socket_rejects_missing_ticket(client: TestClient) -> None:
    meeting_id = create_live_meeting(client)
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(
        f"/ws/meetings/{meeting_id}",
        cookies={"nexusmeet_session": client.cookies.get("nexusmeet_session") or ""},
        headers={"origin": ALLOWED_ORIGIN},
    ):
        pass


def test_socket_rejects_forged_ticket(client: TestClient) -> None:
    meeting_id = create_live_meeting(client)
    forged = mint_ticket(client, meeting_id)["ticket"]
    payload, _, signature = forged.partition(".")
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(
        f"/ws/meetings/{meeting_id}?ticket={payload}.{signature[:-2]}xy",
        cookies={"nexusmeet_session": client.cookies.get("nexusmeet_session") or ""},
        headers={"origin": ALLOWED_ORIGIN},
    ):
        pass


def test_socket_rejects_foreign_origin(client: TestClient) -> None:
    meeting_id = create_live_meeting(client)
    ticket = mint_ticket(client, meeting_id)["ticket"]
    with pytest.raises(WebSocketDisconnect), open_socket(
        client,
        meeting_id,
        ticket,
        token=str(client.cookies.get("nexusmeet_session")),
        origin=FOREIGN_ORIGIN,
    ):
        pass


def test_socket_rejects_a_valid_ticket_for_a_non_participant(
    app: Any, client: TestClient, other_user_id: str
) -> None:
    """A correctly signed ticket is still refused when the user never joined.

    The signature only proves the ticket came from this service. Membership is
    re-checked against the database on every handshake, so a leaked ticket
    cannot be used to sit in on a room.
    """
    meeting_id = create_live_meeting(client)
    ticket, _ = issue_ticket(
        app.state.settings, user_id=other_user_id, meeting_id=meeting_id
    )

    with pytest.raises(WebSocketDisconnect), open_socket(
        client,
        meeting_id,
        ticket,
        token=str(client.cookies.get("nexusmeet_session")),
    ):
        pass


def test_socket_rejects_ended_meeting(client: TestClient) -> None:
    meeting_id = create_live_meeting(client)
    ticket = mint_ticket(client, meeting_id)["ticket"]
    assert client.post(f"/api/v1/meetings/{meeting_id}/end").status_code == 200

    with pytest.raises(WebSocketDisconnect), open_socket(
        client, meeting_id, ticket, token=str(client.cookies.get("nexusmeet_session"))
    ):
        pass


def test_socket_rejects_unknown_meeting(client: TestClient) -> None:
    missing = "mtg_" + "0" * 32
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(
        f"/ws/meetings/{missing}?ticket={'t' * 32}",
        cookies={"nexusmeet_session": client.cookies.get("nexusmeet_session") or ""},
        headers={"origin": ALLOWED_ORIGIN},
    ):
        pass


# --- websocket protocol ----------------------------------------------------


def test_welcome_lists_existing_peers_and_broadcasts_arrival(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200
    host_token = str(client.cookies.get("nexusmeet_session"))
    guest_token = attendee_token(attendee_client)

    with open_socket(
        client, meeting_id, mint_ticket(client, meeting_id)["ticket"], token=host_token
    ) as host:
        welcome = read(host)
        assert welcome["type"] == "welcome"
        assert welcome["peers"] == []
        assert welcome["self"]["is_host"] is True
        assert welcome["ice_servers"]

        with open_socket(
            client,
            meeting_id,
            mint_ticket(attendee_client, meeting_id)["ticket"],
            token=guest_token,
        ) as guest:
            guest_welcome = read(guest)
            assert [peer["user_id"] for peer in guest_welcome["peers"]] == [
                welcome["self"]["user_id"]
            ]

            joined = read(host)
            assert joined["type"] == "peer-joined"
            assert joined["peer"]["user_id"] == guest_welcome["self"]["user_id"]
            assert joined["peer"]["is_host"] is False


def test_offer_answer_and_ice_are_relayed_to_the_target(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200

    with open_socket(
        client,
        meeting_id,
        mint_ticket(client, meeting_id)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host:
        host_self = read(host)["self"]
        with open_socket(
            client,
            meeting_id,
            mint_ticket(attendee_client, meeting_id)["ticket"],
            token=attendee_token(attendee_client),
        ) as guest:
            # The guest learns the host from its welcome roster, the host learns
            # the guest from peer-joined, so both can address each other.
            guest_welcome = read(guest)
            guest_self = guest_welcome["self"]
            host_id = guest_welcome["peers"][0]["connection_id"]
            joined = read(host)
            guest_id = joined["peer"]["connection_id"]
            assert host_id == host_self["connection_id"]
            # Registering a peer also publishes its media state to the room.
            assert read(host)["type"] == "media-state"

            host.send_json(
                {
                    "type": "offer",
                    "target": guest_id,
                    "sdp": {"type": "offer", "sdp": "v=0"},
                }
            )
            offer = read(guest)
            assert offer["type"] == "offer"
            assert offer["sdp"]["sdp"] == "v=0"
            assert offer["from"] == host_self["connection_id"]
            assert offer["from_user_id"] == host_self["user_id"]

            guest.send_json(
                {
                    "type": "answer",
                    "target": host_id,
                    "sdp": {"type": "answer", "sdp": "v=0-answer"},
                }
            )
            answer = read(host)
            assert answer["type"] == "answer"
            assert answer["sdp"]["sdp"] == "v=0-answer"
            assert answer["from"] == guest_self["connection_id"]

            host.send_json(
                {
                    "type": "ice-candidate",
                    "target": guest_id,
                    "candidate": {"candidate": "candidate:1 1 udp 1 10.0.0.1 1 typ host"},
                }
            )
            relayed = read(guest)
            assert relayed["type"] == "ice-candidate"
            assert relayed["candidate"]["candidate"].startswith("candidate:")


def test_signaling_to_another_meeting_is_refused(
    client: TestClient, attendee_client: TestClient
) -> None:
    first = create_live_meeting(client)
    second = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{first}/join").status_code == 200
    assert attendee_client.post(f"/api/v1/meetings/{second}/join").status_code == 200

    with open_socket(
        client,
        second,
        mint_ticket(client, second)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host_in_second:
        read(host_in_second)
        with open_socket(
            client,
            first,
            mint_ticket(attendee_client, first)["ticket"],
            token=attendee_token(attendee_client),
        ) as guest_in_first:
            guest_self = read(guest_in_first)["self"]
            read(host_in_second)

            # A connection id from another room must not resolve.
            host_in_second.send_json(
                {
                    "type": "offer",
                    "target": guest_self["connection_id"],
                    "sdp": {"type": "offer", "sdp": "v=0"},
                }
            )
            error = read(host_in_second)
            assert error["type"] == "error"
            assert error["code"] == "UNKNOWN_TARGET"


def test_media_state_is_broadcast_to_peers(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200

    with open_socket(
        client,
        meeting_id,
        mint_ticket(client, meeting_id)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host:
        read(host)
        with open_socket(
            client,
            meeting_id,
            mint_ticket(attendee_client, meeting_id)["ticket"],
            token=attendee_token(attendee_client),
        ) as guest:
            read(guest)
            joined = read(host)
            # Drain the media-state broadcast that follows peer-joined.
            read(host)

            guest.send_json(
                {
                    "type": "media-state",
                    "audio_enabled": False,
                    "video_enabled": False,
                    "screen_sharing": False,
                }
            )
            state = read(host)
            assert state["type"] == "media-state"
            assert state["audio_enabled"] is False
            assert state["video_enabled"] is False
            assert state["user_id"] == joined["peer"]["user_id"]


def test_disconnect_broadcasts_participant_left(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200

    with open_socket(
        client,
        meeting_id,
        mint_ticket(client, meeting_id)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host:
        read(host)
        with open_socket(
            client,
            meeting_id,
            mint_ticket(attendee_client, meeting_id)["ticket"],
            token=attendee_token(attendee_client),
        ) as guest:
            guest_self = read(guest)["self"]
            read(host)
            read(host)

        left = read(host)
        assert left["type"] == "peer-left"
        assert left["connection_id"] == guest_self["connection_id"]


def test_explicit_leave_message_closes_the_socket(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200

    with open_socket(
        client,
        meeting_id,
        mint_ticket(client, meeting_id)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host:
        read(host)
        with open_socket(
            client,
            meeting_id,
            mint_ticket(attendee_client, meeting_id)["ticket"],
            token=attendee_token(attendee_client),
        ) as guest:
            read(guest)
            read(host)
            read(host)
            guest.send_json({"type": "leave"})

        assert read(host)["type"] == "peer-left"


# --- host controls over signaling -----------------------------------------


def test_host_mute_reaches_the_target_socket(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    joined = attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participant_id = next(
        item["id"]
        for item in joined.json()["data"]["participants"]
        if item["user"]["email"] == "attendee@nexusmeet.dev"
    )

    with open_socket(
        client,
        meeting_id,
        mint_ticket(client, meeting_id)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host:
        read(host)
        with open_socket(
            client,
            meeting_id,
            mint_ticket(attendee_client, meeting_id)["ticket"],
            token=attendee_token(attendee_client),
        ) as guest:
            read(guest)
            read(host)
            read(host)

            response = client.post(
                f"/api/v1/meetings/{meeting_id}/participants/{participant_id}/mute",
                json={"muted": True},
            )
            assert response.status_code == 200, response.text

            event = read(guest)
            assert event["type"] == "host-mute"
            assert event["muted"] is True


def test_host_remove_closes_the_target_socket(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    joined = attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participant_id = next(
        item["id"]
        for item in joined.json()["data"]["participants"]
        if item["user"]["email"] == "attendee@nexusmeet.dev"
    )

    with open_socket(
        client,
        meeting_id,
        mint_ticket(client, meeting_id)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host:
        read(host)
        with open_socket(
            client,
            meeting_id,
            mint_ticket(attendee_client, meeting_id)["ticket"],
            token=attendee_token(attendee_client),
        ) as guest:
            read(guest)
            read(host)
            read(host)

            response = client.delete(
                f"/api/v1/meetings/{meeting_id}/participants/{participant_id}"
            )
            assert response.status_code == 200, response.text

            event = read(guest)
            assert event["type"] == "participant-removed"
            with pytest.raises(WebSocketDisconnect):
                guest.receive_json()

        # The hub forgets the removed socket so it cannot be re-addressed.
        assert global_hub.room_size(meeting_id) == 1


def test_end_meeting_broadcasts_and_closes_every_socket(
    client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200

    with open_socket(
        client,
        meeting_id,
        mint_ticket(client, meeting_id)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host:
        read(host)
        with open_socket(
            client,
            meeting_id,
            mint_ticket(attendee_client, meeting_id)["ticket"],
            token=attendee_token(attendee_client),
        ) as guest:
            read(guest)
            read(host)
            read(host)

            assert client.post(f"/api/v1/meetings/{meeting_id}/end").status_code == 200

            assert read(host)["type"] == "meeting-ended"
            assert read(guest)["type"] == "meeting-ended"

    assert global_hub.room_size(meeting_id) == 0


def test_room_limit_refuses_a_new_peer(
    app: Any, client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200
    guest_ticket = mint_ticket(attendee_client, meeting_id)["ticket"]

    app.state.settings.max_webrtc_participants = 1
    with open_socket(
        client,
        meeting_id,
        mint_ticket(client, meeting_id)["ticket"],
        token=str(client.cookies.get("nexusmeet_session")),
    ) as host:
        read(host)
        # The guest holds a valid ticket but the mesh is already full.
        with pytest.raises(WebSocketDisconnect), open_socket(
            client, meeting_id, guest_ticket, token=attendee_token(attendee_client)
        ):
            pass
        assert global_hub.room_size(meeting_id) == 1


def test_returning_user_reconnects_despite_a_full_room(
    app: Any, client: TestClient, attendee_client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    assert attendee_client.post(f"/api/v1/meetings/{meeting_id}/join").status_code == 200
    app.state.settings.max_webrtc_participants = 1
    ticket = mint_ticket(attendee_client, meeting_id)["ticket"]
    guest_token = attendee_token(attendee_client)

    with open_socket(client, meeting_id, ticket, token=guest_token) as guest:
        read(guest)
        # A reconnect for a user already in the room must be allowed back in.
        with open_socket(client, meeting_id, ticket, token=guest_token) as reconnected:
            welcome = read(reconnected)
            assert welcome["type"] == "welcome"


# --- hub unit behaviour ----------------------------------------------------


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed: int | None = None

    async def send_text(self, text: str) -> None:
        self.sent.append(text)

    async def close(self, code: int = 1000) -> None:
        self.closed = code


def build_connection(local_hub: SignalingHub, connection_id: str, user_id: str) -> Any:
    from app.realtime.hub import SignalingConnection

    return SignalingConnection(
        connection_id=connection_id,
        meeting_id="mtg_" + "1" * 32,
        user_id=user_id,
        participant_id=1,
        display_name=user_id,
        is_host=False,
        websocket=FakeSocket(),
    )


def test_reconnect_replaces_the_previous_socket() -> None:
    """A second socket for the same user must evict the older one.

    Otherwise a reconnecting tab would leave a ghost peer that can never answer,
    and the room would slowly fill with dead connections.
    """
    local_hub = SignalingHub()
    first = build_connection(local_hub, "conn_first", "usr_a")
    second = build_connection(local_hub, "conn_second", "usr_a")

    async def scenario() -> list[Any]:
        await local_hub.register(first)
        peers = await local_hub.register(second)
        await local_hub.unregister(second)
        return peers

    peers = asyncio.run(scenario())
    assert peers == []
    assert local_hub.room_size(first.meeting_id) == 0
    assert first.websocket.closed == 4000


def test_broadcast_can_exclude_one_connection() -> None:
    local_hub = SignalingHub()
    host = build_connection(local_hub, "conn_host", "usr_host")
    guest = build_connection(local_hub, "conn_guest", "usr_guest")

    async def scenario() -> int:
        await local_hub.register(host)
        await local_hub.register(guest)
        return await local_hub.broadcast(
            host.meeting_id, {"type": "media-state"}, exclude_connection_id=guest.connection_id
        )

    assert asyncio.run(scenario()) == 1
    assert len(host.websocket.sent) == 1
    assert guest.websocket.sent == []


def test_send_to_user_reaches_every_socket_that_user_holds() -> None:
    local_hub = SignalingHub()
    first = build_connection(local_hub, "conn_tab_one", "usr_a")
    second = build_connection(local_hub, "conn_tab_two", "usr_a")
    other = build_connection(local_hub, "conn_other", "usr_b")

    async def scenario() -> int:
        for connection in (first, other):
            await local_hub.register(connection)
        # The hub keeps one socket per user, so re-registering replaces the first.
        await local_hub.register(second)
        return await local_hub.send_to_user(first.meeting_id, "usr_b", {"type": "host-mute"})

    assert asyncio.run(scenario()) == 1
    assert other.websocket.sent

# --- production secret hygiene ------------------------------------------------


@contextlib.contextmanager
def production_settings(app: Any, **overrides: Any) -> Iterator[None]:
    """Run a block as if deployed to production.

    `get_settings` reads `app.state.settings`, so swapping it exercises the real
    dependency path instead of a test-only override.
    """
    original = app.state.settings
    app.state.settings = original.model_copy(
        update={"environment": "production", **overrides}
    )
    try:
        yield
    finally:
        app.state.settings = original


def test_production_refuses_to_sign_with_the_development_secret(
    app: Any, client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    with production_settings(app):
        response = client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SIGNALING_NOT_CONFIGURED"


def test_missing_secret_keeps_the_rest_of_the_api_working(
    app: Any, client: TestClient
) -> None:
    """Failing closed on signaling must not take down auth or meetings."""
    with production_settings(app):
        assert client.get("/api/v1/auth/me").status_code == 200
        assert client.get("/api/v1/meetings").status_code == 200


def test_production_issues_a_ticket_once_a_real_secret_is_set(
    app: Any, client: TestClient
) -> None:
    meeting_id = create_live_meeting(client)
    with production_settings(app, ws_ticket_secret="a-real-production-secret"):
        response = client.post(f"/api/v1/meetings/{meeting_id}/ws-ticket")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["ticket"]
    assert data["ticket"] != "a-real-production-secret"


def test_blank_secret_is_treated_as_unset_not_as_a_usable_key() -> None:
    """An empty HMAC key would make every ticket forgeable."""
    assert Settings(ws_ticket_secret="   ").uses_development_ws_secret

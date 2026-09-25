from __future__ import annotations

from fastapi.testclient import TestClient


def _participant_id(participants_payload: dict[str, object], user_id: str) -> int:
    items = participants_payload["data"]
    assert isinstance(items, list)
    for item in items:
        assert isinstance(item, dict)
        if item.get("user_id") == user_id:
            return int(item["id"])
    raise AssertionError(f"participant {user_id} not found in active list")


def _live_meeting(client: TestClient) -> str:
    created = client.post("/api/v1/meetings/instant", json={"title": "Host controls"})
    assert created.status_code == 201
    meeting_id = str(created.json()["data"]["id"])
    assert created.json()["data"]["status"] == "live"
    return meeting_id


def test_host_can_mute_and_unmute_a_participant(
    client: TestClient,
    attendee_client: TestClient,
    other_user_id: str,
) -> None:
    meeting_id = _live_meeting(client)
    attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    participant_id = _participant_id(participants.json(), other_user_id)

    muted = client.post(
        f"/api/v1/meetings/{meeting_id}/participants/{participant_id}/mute",
        json={"muted": True},
    )

    assert muted.status_code == 200
    data = muted.json()["data"]
    assert data["is_muted"] is True
    assert data["isMuted"] is True
    assert data["muted_by_host"] is True
    assert data["audio_enabled"] is False

    persisted = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    persisted_item = next(
        item for item in persisted.json()["data"] if item["user_id"] == other_user_id
    )
    assert persisted_item["is_muted"] is True

    unmuted = client.post(
        f"/api/v1/meetings/{meeting_id}/participants/{participant_id}/mute",
        json={"muted": False},
    )
    assert unmuted.status_code == 200
    assert unmuted.json()["data"]["is_muted"] is False
    assert unmuted.json()["data"]["muted_by_host"] is False


def test_host_mute_defaults_to_muted_without_a_body(
    client: TestClient,
    attendee_client: TestClient,
    other_user_id: str,
) -> None:
    meeting_id = _live_meeting(client)
    attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    participant_id = _participant_id(participants.json(), other_user_id)

    response = client.post(f"/api/v1/meetings/{meeting_id}/participants/{participant_id}/mute")

    assert response.status_code == 200
    assert response.json()["data"]["is_muted"] is True


def test_participant_cannot_mute_or_remove_other_participants(
    attendee_client: TestClient,
    client: TestClient,
    other_user_id: str,
) -> None:
    meeting_id = _live_meeting(client)
    attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    participant_id = _participant_id(participants.json(), other_user_id)

    mute_attempt = attendee_client.post(
        f"/api/v1/meetings/{meeting_id}/participants/{participant_id}/mute",
        json={"muted": True},
    )
    assert mute_attempt.status_code == 403
    assert mute_attempt.json()["error"]["code"] == "MEETING_HOST_REQUIRED"

    remove_attempt = attendee_client.delete(
        f"/api/v1/meetings/{meeting_id}/participants/{participant_id}"
    )
    assert remove_attempt.status_code == 403
    assert remove_attempt.json()["error"]["code"] == "MEETING_HOST_REQUIRED"


def test_unauthenticated_user_cannot_use_host_controls(
    client: TestClient,
    attendee_client: TestClient,
    anonymous_client: TestClient,
    other_user_id: str,
) -> None:
    meeting_id = _live_meeting(client)
    attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    participant_id = _participant_id(participants.json(), other_user_id)

    mute_attempt = anonymous_client.post(
        f"/api/v1/meetings/{meeting_id}/participants/{participant_id}/mute"
    )
    remove_attempt = anonymous_client.delete(
        f"/api/v1/meetings/{meeting_id}/participants/{participant_id}"
    )
    end_attempt = anonymous_client.post(f"/api/v1/meetings/{meeting_id}/end")

    assert mute_attempt.status_code == 401
    assert remove_attempt.status_code == 401
    assert end_attempt.status_code == 401
    assert mute_attempt.json()["error"]["code"] == "UNAUTHENTICATED"
    assert remove_attempt.json()["error"]["code"] == "UNAUTHENTICATED"
    assert end_attempt.json()["error"]["code"] == "UNAUTHENTICATED"


def test_host_cannot_mute_or_remove_itself(
    client: TestClient,
) -> None:
    meeting_id = _live_meeting(client)
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    host_id = _participant_id(participants.json(), "usr_default_000000000000000000000001")

    mute_attempt = client.post(
        f"/api/v1/meetings/{meeting_id}/participants/{host_id}/mute",
        json={"muted": True},
    )
    remove_attempt = client.delete(f"/api/v1/meetings/{meeting_id}/participants/{host_id}")

    assert mute_attempt.status_code == 409
    assert mute_attempt.json()["error"]["code"] == "HOST_PARTICIPANT_PROTECTED"
    assert remove_attempt.status_code == 409
    assert remove_attempt.json()["error"]["code"] == "HOST_PARTICIPANT_PROTECTED"


def test_host_controls_are_scoped_to_the_owning_meeting(
    client: TestClient,
    host_only_client: TestClient,
) -> None:
    other_meeting = host_only_client.post(
        "/api/v1/meetings/instant",
        json={"title": "Another host room"},
    ).json()["data"]
    other_meeting_id = str(other_meeting["id"])
    other_participants = host_only_client.get(
        f"/api/v1/meetings/{other_meeting_id}/participants"
    ).json()["data"]
    participant_id = int(other_participants[0]["id"])

    mute_attempt = client.post(
        f"/api/v1/meetings/{other_meeting_id}/participants/{participant_id}/mute",
        json={"muted": True},
    )
    remove_attempt = client.delete(
        f"/api/v1/meetings/{other_meeting_id}/participants/{participant_id}"
    )

    assert mute_attempt.status_code == 403
    assert mute_attempt.json()["error"]["code"] == "MEETING_HOST_REQUIRED"
    assert remove_attempt.status_code == 403
    assert remove_attempt.json()["error"]["code"] == "MEETING_HOST_REQUIRED"


def test_remove_participant_deactivates_them(
    client: TestClient,
    attendee_client: TestClient,
    other_user_id: str,
) -> None:
    meeting_id = _live_meeting(client)
    attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    participant_id = _participant_id(participants.json(), other_user_id)

    removed = client.delete(f"/api/v1/meetings/{meeting_id}/participants/{participant_id}")

    assert removed.status_code == 200
    data = removed.json()["data"]
    assert data["is_removed"] is True
    assert data["isRemoved"] is True
    assert data["is_online"] is False
    assert data["is_active"] is False
    assert data["removed_at"] is not None

    active = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    assert [item["user_id"] for item in active.json()["data"]] == [
        "usr_default_000000000000000000000001"
    ]

    media_attempt = attendee_client.patch(
        f"/api/v1/meetings/{meeting_id}/participants/me/media",
        json={"audio_enabled": True},
    )
    assert media_attempt.status_code == 403
    assert media_attempt.json()["error"]["code"] == "PARTICIPANT_REMOVED"

    rejoin_attempt = attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    assert rejoin_attempt.status_code == 403
    assert rejoin_attempt.json()["error"]["code"] == "PARTICIPANT_REMOVED"


def test_removed_user_is_hidden_from_other_meeting_scopes(
    client: TestClient,
    attendee_client: TestClient,
    other_user_id: str,
) -> None:
    meeting_id = _live_meeting(client)
    attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    participant_id = _participant_id(participants.json(), other_user_id)
    client.delete(f"/api/v1/meetings/{meeting_id}/participants/{participant_id}")

    joined_scope = attendee_client.get("/api/v1/meetings", params={"scope": "joined"})
    all_scope = attendee_client.get("/api/v1/meetings", params={"scope": "all"})

    assert joined_scope.json()["meta"]["total"] == 0
    assert all(item["id"] != meeting_id for item in all_scope.json()["data"]["items"])


def test_double_removal_and_unknown_participant_are_rejected(
    client: TestClient,
    attendee_client: TestClient,
    other_user_id: str,
) -> None:
    meeting_id = _live_meeting(client)
    attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    participant_id = _participant_id(participants.json(), other_user_id)

    first = client.delete(f"/api/v1/meetings/{meeting_id}/participants/{participant_id}")
    assert first.status_code == 200

    second = client.delete(f"/api/v1/meetings/{meeting_id}/participants/{participant_id}")
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "PARTICIPANT_ALREADY_REMOVED"

    unknown = client.delete(f"/api/v1/meetings/{meeting_id}/participants/999999")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "PARTICIPANT_NOT_FOUND"


def test_muting_is_rejected_for_ended_meetings(client: TestClient) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={"title": "Ending soon"}).json()["data"]
    meeting_id = str(meeting["id"])
    client.post(f"/api/v1/meetings/{meeting_id}/end")
    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants").json()["data"]
    assert participants == []

    unknown_id = 1
    response = client.post(
        f"/api/v1/meetings/{meeting_id}/participants/{unknown_id}/mute",
        json={"muted": True},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"


def test_host_controls_require_an_existing_meeting(
    client: TestClient,
) -> None:
    missing = f"mtg_{'0' * 32}"

    response = client.post(f"/api/v1/meetings/{missing}/participants/1/mute")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MEETING_NOT_FOUND"

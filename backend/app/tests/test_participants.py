from __future__ import annotations

from fastapi.testclient import TestClient


def test_participant_lifecycle_and_media_state(
    client: TestClient,
    attendee_client: TestClient,
    other_user_id: str,
) -> None:
    created = client.post("/api/v1/meetings/instant", json={"title": "Team sync"})
    assert created.status_code == 201
    meeting_id = created.json()["data"]["id"]

    joined = attendee_client.post(f"/api/v1/meetings/{meeting_id}/join")
    assert joined.status_code == 200
    assert joined.json()["data"]["participant_count"] == 2
    assert joined.json()["data"]["is_current_user_participant"] is True

    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    assert participants.status_code == 200
    assert len(participants.json()["data"]) == 2

    media = attendee_client.patch(
        f"/api/v1/meetings/{meeting_id}/participants/me/media",
        json={"audio_enabled": False, "video_enabled": True, "screen_sharing": True},
    )
    assert media.status_code == 200
    assert media.json()["data"]["audio_enabled"] is False
    assert media.json()["data"]["screen_sharing"] is True

    conflict = client.patch(
        f"/api/v1/meetings/{meeting_id}/participants/me/media",
        json={"screen_sharing": True},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "SCREEN_SHARING_CONFLICT"

    stopped_sharing = attendee_client.patch(
        f"/api/v1/meetings/{meeting_id}/participants/me/media",
        json={"screen_sharing": False},
    )
    assert stopped_sharing.status_code == 200

    left = attendee_client.post(f"/api/v1/meetings/{meeting_id}/leave")
    assert left.status_code == 200
    assert left.json()["data"]["participant_count"] == 1
    assert left.json()["data"]["is_current_user_participant"] is False

    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    assert [item["user"]["id"] for item in participants.json()["data"]] == [
        "usr_default_000000000000000000000001"
    ]


def test_leave_is_rejected_when_not_active(
    client: TestClient,
    attendee_client: TestClient,
) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={}).json()["data"]
    joined = attendee_client.post(f"/api/v1/meetings/{meeting['id']}/join")
    assert joined.status_code == 200
    left = attendee_client.post(f"/api/v1/meetings/{meeting['id']}/leave")
    assert left.status_code == 200

    response = attendee_client.post(f"/api/v1/meetings/{meeting['id']}/leave")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "NOT_ACTIVE_PARTICIPANT"


def test_join_accepts_frontend_display_name(
    client: TestClient,
    attendee_client: TestClient,
    other_user_id: str,
) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={"title": "Display name room"}).json()[
        "data"
    ]

    joined = attendee_client.post(
        f"/api/v1/meetings/{meeting['id']}/join",
        json={"displayName": "Renamed Attendee"},
    )

    assert joined.status_code == 200
    guest = next(
        item for item in joined.json()["data"]["participants"] if item["user_id"] == other_user_id
    )
    assert guest["display_name"] == "Renamed Attendee"
    assert guest["displayName"] == "Renamed Attendee"
    assert guest["isOnline"] is True
    assert guest["userId"] == guest["user_id"]


def test_join_requires_authentication(client: TestClient, anonymous_client: TestClient) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={"title": "Locked room"}).json()["data"]

    response = anonymous_client.post(
        f"/api/v1/meetings/{meeting['id']}/join",
        json={"displayName": "Anonymous"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"
    participants = client.get(f"/api/v1/meetings/{meeting['id']}/participants")
    assert [item["user_id"] for item in participants.json()["data"]] == [
        "usr_default_000000000000000000000001"
    ]


def test_media_state_requires_at_least_one_field(
    client: TestClient,
    attendee_client: TestClient,
) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={}).json()["data"]
    attendee_client.post(f"/api/v1/meetings/{meeting['id']}/join")

    response = attendee_client.patch(
        f"/api/v1/meetings/{meeting['id']}/participants/me/media",
        json={},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_joined_at_is_utc_serialized(
    client: TestClient,
    attendee_client: TestClient,
) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={}).json()["data"]
    joined = attendee_client.post(f"/api/v1/meetings/{meeting['id']}/join")

    joined_at = joined.json()["data"]["participants"][-1]["joined_at"]

    assert joined_at is not None
    assert joined_at.endswith("Z")

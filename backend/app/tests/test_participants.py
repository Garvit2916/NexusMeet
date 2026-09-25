from collections.abc import Callable

from fastapi.testclient import TestClient


def test_participant_lifecycle_and_media_state(
    client: TestClient,
    auth_headers: Callable[[str | None], dict[str, str]],
    other_user_id: str,
) -> None:
    created = client.post("/api/v1/meetings/instant", json={"title": "Team sync"})
    assert created.status_code == 201
    meeting_id = created.json()["data"]["id"]

    joined = client.post(
        f"/api/v1/meetings/{meeting_id}/join",
        headers=auth_headers(other_user_id),
    )
    assert joined.status_code == 200
    assert joined.json()["data"]["participant_count"] == 2
    assert joined.json()["data"]["is_current_user_participant"] is True

    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    assert participants.status_code == 200
    assert len(participants.json()["data"]) == 2

    media = client.patch(
        f"/api/v1/meetings/{meeting_id}/participants/me/media",
        headers=auth_headers(other_user_id),
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

    stopped_sharing = client.patch(
        f"/api/v1/meetings/{meeting_id}/participants/me/media",
        headers=auth_headers(other_user_id),
        json={"screen_sharing": False},
    )
    assert stopped_sharing.status_code == 200

    left = client.post(
        f"/api/v1/meetings/{meeting_id}/leave",
        headers=auth_headers(other_user_id),
    )
    assert left.status_code == 200
    assert left.json()["data"]["participant_count"] == 1
    assert left.json()["data"]["is_current_user_participant"] is False

    participants = client.get(f"/api/v1/meetings/{meeting_id}/participants")
    assert [item["user"]["id"] for item in participants.json()["data"]] == [
        "usr_default_000000000000000000000001"
    ]


def test_leave_is_rejected_when_not_active(
    client: TestClient,
    auth_headers: Callable[[str | None], dict[str, str]],
    other_user_id: str,
) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={}).json()["data"]
    joined = client.post(
        f"/api/v1/meetings/{meeting['id']}/join",
        headers=auth_headers(other_user_id),
    )
    assert joined.status_code == 200
    left = client.post(
        f"/api/v1/meetings/{meeting['id']}/leave",
        headers=auth_headers(other_user_id),
    )
    assert left.status_code == 200

    response = client.post(
        f"/api/v1/meetings/{meeting['id']}/leave",
        headers=auth_headers(other_user_id),
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "NOT_ACTIVE_PARTICIPANT"


def test_guest_join_accepts_frontend_display_name(
    client: TestClient,
) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={"title": "Guest room"}).json()["data"]

    joined = client.post(
        f"/api/v1/meetings/{meeting['id']}/join",
        headers={"X-User-ID": "usr_unknown_guest"},
        json={"displayName": "Frontend Guest"},
    )

    assert joined.status_code == 200
    guest = next(
        item
        for item in joined.json()["data"]["participants"]
        if item["user_id"] != "usr_default_000000000000000000000001"
    )
    assert guest["display_name"] == "Frontend Guest"
    assert guest["displayName"] == "Frontend Guest"
    assert guest["isOnline"] is True
    assert guest["userId"] == guest["user_id"]


def test_media_state_requires_at_least_one_field(
    client: TestClient,
    auth_headers: Callable[[str | None], dict[str, str]],
    other_user_id: str,
) -> None:
    meeting = client.post("/api/v1/meetings/instant", json={}).json()["data"]
    client.post(
        f"/api/v1/meetings/{meeting['id']}/join",
        headers=auth_headers(other_user_id),
    )

    response = client.patch(
        f"/api/v1/meetings/{meeting['id']}/participants/me/media",
        headers=auth_headers(other_user_id),
        json={},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"

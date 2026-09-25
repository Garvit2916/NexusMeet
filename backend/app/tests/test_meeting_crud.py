import re
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

MEETING_ID_PATTERN = re.compile(r"^mtg_[0-9a-f]{32}$")


def create_instant(client: TestClient, title: str) -> dict[str, Any]:
    response = client.post("/api/v1/meetings/instant", json={"title": title})
    assert response.status_code == 201
    return response.json()["data"]


def test_instant_meeting_ids_are_random_and_non_sequential(client: TestClient) -> None:
    first = create_instant(client, "First")
    second = create_instant(client, "Second")

    assert MEETING_ID_PATTERN.fullmatch(str(first["id"]))
    assert MEETING_ID_PATTERN.fullmatch(str(second["id"]))
    assert first["id"] != second["id"]
    assert first["status"] == "live"
    assert first["is_instant"] is True
    assert first["scheduled_at"] is None
    assert first["started_at"].endswith("Z")


def test_schedule_get_list_and_update(
    client: TestClient,
    auth_headers: Callable[..., dict[str, str]],
    future_time: datetime,
) -> None:
    response = client.post(
        "/api/v1/meetings/schedule",
        headers=auth_headers(),
        json={
            "title": "Architecture review",
            "description": "Quarterly planning",
            "scheduled_at": future_time.isoformat(),
        },
    )

    assert response.status_code == 201
    meeting = response.json()["data"]
    assert MEETING_ID_PATTERN.fullmatch(meeting["id"])
    assert meeting["status"] == "scheduled"
    assert meeting["is_instant"] is False
    assert meeting["scheduled_at"].endswith("Z")
    assert meeting["participant_count"] == 0
    assert meeting["current_user_role"] == "host"
    assert meeting["is_current_user_participant"] is False

    fetched = client.get(f"/api/v1/meetings/{meeting['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["id"] == meeting["id"]
    assert fetched.json()["data"]["is_current_user_participant"] is False

    meeting_list = client.get(
        "/api/v1/meetings",
        params={"scope": "hosted", "status": "scheduled", "limit": 10, "offset": 0},
    )
    assert meeting_list.status_code == 200
    assert meeting_list.json()["meta"] == {"total": 1, "limit": 10, "offset": 0}
    assert [item["id"] for item in meeting_list.json()["data"]["items"]] == [meeting["id"]]

    updated = client.patch(
        f"/api/v1/meetings/{meeting['id']}",
        json={"title": "Architecture review updated", "description": ""},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["title"] == "Architecture review updated"
    assert updated.json()["data"]["description"] == ""


def test_schedule_rejects_past_and_naive_datetimes(
    client: TestClient,
    future_time: datetime,
) -> None:
    past = client.post(
        "/api/v1/meetings/schedule",
        json={"title": "Past", "scheduled_at": "2000-01-01T00:00:00Z"},
    )
    assert past.status_code == 422
    assert past.json()["error"]["code"] == "SCHEDULE_IN_PAST"

    naive = client.post(
        "/api/v1/meetings/schedule",
        json={"title": "Naive", "scheduled_at": future_time.replace(tzinfo=None).isoformat()},
    )
    assert naive.status_code == 422
    assert naive.json()["error"]["code"] == "VALIDATION_ERROR"


def test_schedule_accepts_frontend_aliases_and_public_code(
    client: TestClient,
    future_time: datetime,
) -> None:
    end_time = future_time + timedelta(minutes=45)
    response = client.post(
        "/api/v1/meetings",
        json={
            "title": "Frontend contract",
            "description": "Alias coverage",
            "startTime": future_time.isoformat(),
            "endTime": end_time.isoformat(),
            "timezone": "America/Los_Angeles",
            "inviteEmails": ["invitee@example.com"],
        },
    )

    assert response.status_code == 201
    meeting = response.json()["data"]
    assert meeting["duration_minutes"] == 45
    assert meeting["display_status"] == "upcoming"
    assert meeting["frontend_status"] == "upcoming"
    assert meeting["meetingCode"].startswith("NM-")
    assert meeting["joinUrl"] == f"/meeting/{meeting['id']}"
    assert meeting["roomId"] == f"room-{meeting['id']}"
    assert meeting["host"]["initials"] == "DU"
    assert meeting["host"]["role"] == "host"
    assert meeting["createdAt"].endswith("Z")

    by_code = client.get(f"/api/v1/meetings/{meeting['meetingCode']}")
    assert by_code.status_code == 200
    assert by_code.json()["data"]["id"] == meeting["id"]


def test_schedule_rejects_duration_beyond_one_day(
    client: TestClient,
    future_time: datetime,
) -> None:
    response = client.post(
        "/api/v1/meetings/schedule",
        json={
            "title": "Too long",
            "scheduled_at": future_time.isoformat(),
            "end_time": (future_time + timedelta(days=2)).isoformat(),
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_invalid_payloads_use_validation_envelope(
    client: TestClient,
    future_time: datetime,
) -> None:
    response = client.post(
        "/api/v1/meetings/schedule",
        json={"title": "   ", "scheduled_at": future_time.isoformat()},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["details"]["errors"]
    assert "meta" in body

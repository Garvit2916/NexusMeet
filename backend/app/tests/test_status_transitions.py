from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.models.meeting import Meeting


def test_scheduled_meeting_transitions_and_access_control(
    client: TestClient,
    auth_headers: Callable[[str | None], dict[str, str]],
    other_user_id: str,
    future_time: datetime,
) -> None:
    created = client.post(
        "/api/v1/meetings/schedule",
        json={"title": "Planning", "scheduled_at": future_time.isoformat()},
    )
    meeting_id = created.json()["data"]["id"]

    public = client.get(
        f"/api/v1/meetings/{meeting_id}",
        headers=auth_headers(other_user_id),
    )
    assert public.status_code == 200
    assert public.json()["data"]["id"] == meeting_id

    early_join = client.post(
        f"/api/v1/meetings/{meeting_id}/join",
        headers=auth_headers(other_user_id),
    )
    assert early_join.status_code == 409
    assert early_join.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"

    started = client.post(f"/api/v1/meetings/{meeting_id}/start")
    assert started.status_code == 200
    assert started.json()["data"]["status"] == "live"
    assert started.json()["data"]["participant_count"] == 1

    attendee_join = client.post(
        f"/api/v1/meetings/{meeting_id}/join",
        headers=auth_headers(other_user_id),
    )
    assert attendee_join.status_code == 200

    attendee_end = client.post(
        f"/api/v1/meetings/{meeting_id}/end",
        headers=auth_headers(other_user_id),
    )
    assert attendee_end.status_code == 403
    assert attendee_end.json()["error"]["code"] == "MEETING_HOST_REQUIRED"

    ended = client.post(f"/api/v1/meetings/{meeting_id}/end")
    assert ended.status_code == 200
    assert ended.json()["data"]["status"] == "ended"
    assert ended.json()["data"]["participant_count"] == 0
    assert ended.json()["data"]["ended_at"].endswith("Z")

    update = client.patch(
        f"/api/v1/meetings/{meeting_id}",
        json={"title": "Too late"},
    )
    assert update.status_code == 409
    assert update.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"

    cancel = client.post(f"/api/v1/meetings/{meeting_id}/cancel")
    assert cancel.status_code == 409
    assert cancel.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"


def test_scheduled_meeting_becomes_live_when_scheduled_time_arrives(
    client: TestClient,
    auth_headers: Callable[[str | None], dict[str, str]],
    future_time: datetime,
) -> None:
    meeting_id = client.post(
        "/api/v1/meetings/schedule",
        json={"title": "Timed launch", "scheduled_at": future_time.isoformat()},
    ).json()["data"]["id"]
    application = cast(FastAPI, client.app)
    with application.state.session_factory() as session:
        session.execute(
            update(Meeting)
            .where(Meeting.id == meeting_id)
            .values(scheduled_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        session.commit()

    joined = client.post(
        f"/api/v1/meetings/{meeting_id}/join",
        headers=auth_headers(None),
    )

    assert joined.status_code == 200
    assert joined.json()["data"]["status"] == "live"
    assert joined.json()["data"]["participant_count"] == 1


def test_scheduled_meeting_can_be_cancelled_once(
    client: TestClient,
    future_time: datetime,
) -> None:
    created = client.post(
        "/api/v1/meetings/schedule",
        json={"title": "Cancelled", "scheduled_at": future_time.isoformat()},
    )
    meeting_id = created.json()["data"]["id"]

    cancelled = client.post(f"/api/v1/meetings/{meeting_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["data"]["status"] == "cancelled"
    assert cancelled.json()["data"]["cancelled_at"].endswith("Z")

    repeated = client.post(f"/api/v1/meetings/{meeting_id}/cancel")
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"


def test_unknown_and_malformed_meeting_ids(
    client: TestClient,
) -> None:
    unknown = client.get(f"/api/v1/meetings/mtg_{'0' * 32}")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "MEETING_NOT_FOUND"

    malformed = client.get("/api/v1/meetings/not-an-id")
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "VALIDATION_ERROR"

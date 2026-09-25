from fastapi.testclient import TestClient


def test_health_and_default_current_user(client: TestClient) -> None:
    health = client.get("/health", headers={"X-Request-ID": "health-check"})
    assert health.status_code == 200
    assert health.headers["X-Request-ID"] == "health-check"
    assert health.json() == {
        "success": True,
        "data": {
            "status": "healthy",
            "service": "NexusMeet Test API",
            "version": "1.0.0",
            "database": "ok",
            "timestamp": health.json()["data"]["timestamp"],
        },
        "meta": None,
    }
    assert health.json()["data"]["timestamp"].endswith("Z")

    current_user = client.get("/api/v1/users/me")
    assert current_user.status_code == 200
    assert current_user.json()["success"] is True
    assert current_user.json()["data"] == {
        "id": "usr_default_000000000000000000000001",
        "name": "Demo User",
        "email": "demo@nexusmeet.dev",
        "avatar_url": None,
        "created_at": current_user.json()["data"]["created_at"],
        "updated_at": current_user.json()["data"]["updated_at"],
        "hosted_meeting_count": 0,
        "joined_meeting_count": 0,
    }


def test_unknown_current_user_uses_error_envelope(client: TestClient) -> None:
    response = client.get(
        "/api/v1/users/me",
        headers={"X-User-ID": "usr_missing"},
    )

    assert response.status_code == 404
    assert response.json()["success"] is False
    assert response.json()["error"]["code"] == "CURRENT_USER_NOT_FOUND"
    assert response.json()["error"]["details"] == {"user_id": "usr_missing"}
    assert response.json()["meta"]["request_id"]

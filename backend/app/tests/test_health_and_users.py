from fastapi.testclient import TestClient


def test_health_and_authenticated_current_user(client: TestClient) -> None:
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

    auth_session = client.get("/api/v1/auth/me")
    assert auth_session.status_code == 200
    assert auth_session.json()["data"] == current_user.json()["data"]


def test_protected_endpoints_require_authentication(anonymous_client: TestClient) -> None:
    for path in ("/api/v1/auth/me", "/api/v1/users/me", "/api/v1/meetings"):
        response = anonymous_client.get(path)
        assert response.status_code == 401, path
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"
        assert response.json()["error"]["details"] is None
        assert response.json()["error"]["message"] == "Sign in to continue"

    created = anonymous_client.post("/api/v1/meetings/instant", json={})
    assert created.status_code == 401
    assert created.json()["error"]["code"] == "UNAUTHENTICATED"


def test_forged_identity_header_is_ignored(anonymous_client: TestClient) -> None:
    response = anonymous_client.get(
        "/api/v1/users/me",
        headers={"X-User-ID": "usr_missing"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_forged_identity_header_cannot_reach_another_account(
    client: TestClient,
    other_user_id: str,
) -> None:
    response = client.get("/api/v1/users/me", headers={"X-User-ID": other_user_id})

    assert response.status_code == 200
    assert response.json()["data"]["id"] == "usr_default_000000000000000000000001"

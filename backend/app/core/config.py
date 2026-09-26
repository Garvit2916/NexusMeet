from functools import lru_cache
from typing import Any, Literal, cast

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "NexusMeet API"
    app_version: str = "1.0.0"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./data/nexusmeet.db"
    database_echo: bool = False
    auto_create_tables: bool = True
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    default_user_id: str = "usr_default_000000000000000000000001"
    default_user_name: str = "Demo User"
    default_user_email: str = "demo@nexusmeet.app"
    default_user_avatar_url: str | None = None
    default_user_password: str = "demo12345"
    seed_sample_data: bool = True
    session_cookie_name: str = "nexusmeet_session"
    session_ttl_hours: int = 168
    session_cookie_secure: bool | None = None
    session_cookie_samesite: str = "lax"
    request_id_header: str = "X-Request-ID"
    # WebRTC signaling. The ticket secret signs the short-lived credential the
    # browser presents on the WebSocket handshake, so a session cookie never has
    # to be sent cross-origin. Generate a real value for any shared deployment.
    ws_ticket_secret: str = "nexusmeet-development-ws-secret"
    ws_ticket_ttl_seconds: int = 120
    max_webrtc_participants: int = 6
    # Public origin the browser should use for wss://. Requests that arrive
    # through the frontend proxy carry the proxy host, so the deployed value is
    # configured explicitly instead of being derived from the request.
    public_ws_url: str | None = None
    stun_urls: str = "stun:stun.l.google.com:19302"
    # TURN is optional in code but effectively required in production: with
    # STUN alone, two browsers behind symmetric NAT or a strict corporate
    # firewall can never find a working candidate pair, and no amount of client
    # side retrying will fix it. The values stay on the server and are handed to
    # the browser only inside the signed ticket response, so a permanent TURN
    # credential is never committed to the frontend bundle.
    #
    # `TURN_URLS` and `TURN_PASSWORD` are accepted as aliases because those are
    # the names most TURN providers document, and a typo here silently degrades
    # every call to STUN-only rather than failing loudly.
    turn_url: str | None = None
    turn_username: str | None = None
    turn_credential: str | None = None
    turn_urls: str | None = None
    turn_password: str | None = None

    @field_validator("ws_ticket_secret", mode="before")
    @classmethod
    def blank_ws_secret_uses_development_default(cls, value: Any) -> Any:
        """Treat a blank environment value as unset.

        Deployment dashboards submit an empty string for optional variables that
        were never filled in, and an empty HMAC key would make every ticket
        forgeable. Falling back to the development default keeps the service
        bootable while `is_production` still flags the misconfiguration.
        """
        if isinstance(value, str) and not value.strip():
            return "nexusmeet-development-ws-secret"
        return value

    @field_validator("session_cookie_secure", mode="before")
    @classmethod
    def blank_secure_cookie_is_unset(cls, value: Any) -> Any:
        """Treat a blank environment value as unset.

        Deployment dashboards submit an empty string for optional variables that
        were never filled in, and pydantic rejects `""` for `bool | None`. An
        unset value must stay unset so `use_secure_session_cookie` can fall back
        to the environment instead of crashing the service on start-up.
        """
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def stun_url_list(self) -> list[str]:
        return [url.strip() for url in self.stun_urls.split(",") if url.strip()]

    @property
    def turn_url_list(self) -> list[str]:
        """Every configured TURN URL, accepting either the singular or plural name."""
        raw = self.turn_urls or self.turn_url or ""
        return [url.strip() for url in raw.split(",") if url.strip()]

    @property
    def effective_turn_credential(self) -> str | None:
        return self.turn_password or self.turn_credential

    @property
    def has_turn_credentials(self) -> bool:
        return bool(self.turn_url_list and self.turn_username and self.effective_turn_credential)

    @property
    def uses_development_ws_secret(self) -> bool:
        return self.ws_ticket_secret == "nexusmeet-development-ws-secret"

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def session_ttl_seconds(self) -> int:
        return max(self.session_ttl_hours, 1) * 3600

    @property
    def use_secure_session_cookie(self) -> bool:
        if self.session_cookie_secure is None:
            return self.is_production
        return self.session_cookie_secure

    @property
    def session_cookie_samesite_value(self) -> Literal["lax", "strict", "none"]:
        value = self.session_cookie_samesite.strip().lower()
        if value in {"lax", "strict", "none"}:
            return cast(Literal["lax", "strict", "none"], value)
        return "lax"


@lru_cache
def get_settings() -> Settings:
    return Settings()

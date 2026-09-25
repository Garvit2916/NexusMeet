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

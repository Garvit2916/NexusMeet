from functools import lru_cache

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
    default_user_email: str = "demo@nexusmeet.local"
    default_user_avatar_url: str | None = None
    seed_sample_data: bool = True
    current_user_header: str = "X-User-ID"
    request_id_header: str = "X-Request-ID"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()

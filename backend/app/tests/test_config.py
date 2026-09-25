from typing import Any

from app.core.config import Settings


def _settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_secure_cookie_follows_the_environment_when_unset() -> None:
    assert _settings(environment="production").use_secure_session_cookie is True
    assert _settings(environment="development").use_secure_session_cookie is False


def test_secure_cookie_can_be_forced_both_ways() -> None:
    forced_off = _settings(environment="production", session_cookie_secure=False)
    forced_on = _settings(environment="development", session_cookie_secure=True)
    assert forced_off.use_secure_session_cookie is False
    assert forced_on.use_secure_session_cookie is True


def test_blank_environment_value_is_treated_as_unset() -> None:
    settings = _settings(environment="production", session_cookie_secure="")
    assert settings.session_cookie_secure is None
    assert settings.use_secure_session_cookie is True


def test_session_ttl_and_samesite_have_safe_defaults() -> None:
    settings = _settings(session_ttl_hours=0, session_cookie_samesite="NONSENSE")
    assert settings.session_ttl_seconds == 3600
    assert settings.session_cookie_samesite_value == "lax"
    assert _settings(session_cookie_samesite="none").session_cookie_samesite_value == "none"


def test_cors_origins_are_split_and_trimmed() -> None:
    settings = _settings(cors_origins=" https://a.example , ,https://b.example ")
    assert settings.cors_origin_list == ["https://a.example", "https://b.example"]

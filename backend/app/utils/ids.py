import secrets

MEETING_ID_BYTES = 16
MEETING_CODE_LENGTH = 8
MEETING_ID_PATTERN = r"^mtg_[0-9a-f]{32}$"
MEETING_IDENTIFIER_PATTERN = r"^(?:mtg_[0-9a-f]{32}|NM-[A-Za-z0-9-]{2,30})$"
MEETING_ID_MAX_LENGTH = 36
MEETING_IDENTIFIER_MIN_LENGTH = 3


def generate_meeting_id() -> str:
    return f"mtg_{secrets.token_hex(MEETING_ID_BYTES)}"


def meeting_code_from_id(meeting_id: str) -> str:
    token = meeting_id.removeprefix("mtg_")
    return f"NM-{token[:MEETING_CODE_LENGTH].upper()}"

from enum import StrEnum


class MeetingStatus(StrEnum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    ENDED = "ended"
    CANCELLED = "cancelled"


class ParticipantRole(StrEnum):
    HOST = "host"
    ATTENDEE = "attendee"

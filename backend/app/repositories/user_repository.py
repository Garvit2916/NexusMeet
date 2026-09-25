from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import ParticipantRole
from app.models.meeting import Meeting
from app.models.participant import MeetingParticipant
from app.models.user import User


class UserRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, user: User) -> User:
        self.session.add(user)
        return user

    def get_by_id(self, user_id: str) -> User | None:
        return self.session.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(func.lower(User.email) == email.lower())
        return self.session.scalar(statement)

    def count_hosted_meetings(self, user_id: str) -> int:
        statement = select(func.count(Meeting.id)).where(Meeting.host_id == user_id)
        return int(self.session.scalar(statement) or 0)

    def count_joined_meetings(self, user_id: str) -> int:
        statement = select(func.count(func.distinct(MeetingParticipant.meeting_id))).where(
            MeetingParticipant.user_id == user_id,
            MeetingParticipant.role == ParticipantRole.ATTENDEE,
            MeetingParticipant.joined_at.is_not(None),
        )
        return int(self.session.scalar(statement) or 0)

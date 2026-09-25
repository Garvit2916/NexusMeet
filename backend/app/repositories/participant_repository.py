from datetime import datetime
from typing import Any, cast

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, joinedload

from app.models.participant import MeetingParticipant


class ParticipantRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, participant: MeetingParticipant) -> MeetingParticipant:
        self.session.add(participant)
        return participant

    def get_by_id(self, participant_id: int) -> MeetingParticipant | None:
        statement = (
            select(MeetingParticipant)
            .where(MeetingParticipant.id == participant_id)
            .options(joinedload(MeetingParticipant.user))
        )
        return self.session.scalar(statement)

    def get_for_user(self, meeting_id: str, user_id: str) -> MeetingParticipant | None:
        statement = (
            select(MeetingParticipant)
            .where(
                MeetingParticipant.meeting_id == meeting_id,
                MeetingParticipant.user_id == user_id,
            )
            .options(joinedload(MeetingParticipant.user))
        )
        return self.session.scalar(statement)

    def list_active(self, meeting_id: str) -> list[MeetingParticipant]:
        statement = (
            select(MeetingParticipant)
            .where(
                MeetingParticipant.meeting_id == meeting_id,
                MeetingParticipant.joined_at.is_not(None),
                MeetingParticipant.left_at.is_(None),
            )
            .options(joinedload(MeetingParticipant.user))
            .order_by(MeetingParticipant.joined_at, MeetingParticipant.id)
        )
        return list(self.session.scalars(statement).all())

    def get_active_screen_sharer(
        self,
        meeting_id: str,
        *,
        exclude_participant_id: int,
    ) -> MeetingParticipant | None:
        statement = select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.id != exclude_participant_id,
            MeetingParticipant.joined_at.is_not(None),
            MeetingParticipant.left_at.is_(None),
            MeetingParticipant.screen_sharing.is_(True),
        )
        return self.session.scalar(statement)

    def reactivate(
        self,
        participant: MeetingParticipant,
        *,
        joined_at: datetime,
    ) -> MeetingParticipant:
        participant.joined_at = joined_at
        participant.left_at = None
        participant.audio_enabled = True
        participant.video_enabled = True
        participant.screen_sharing = False
        participant.updated_at = joined_at
        self.session.flush()
        return participant

    def mark_left(self, participant: MeetingParticipant, left_at: datetime) -> MeetingParticipant:
        participant.left_at = left_at
        participant.screen_sharing = False
        participant.updated_at = left_at
        self.session.flush()
        return participant

    def mark_all_left(self, meeting_id: str, left_at: datetime) -> int:
        statement = (
            update(MeetingParticipant)
            .where(
                MeetingParticipant.meeting_id == meeting_id,
                MeetingParticipant.joined_at.is_not(None),
                MeetingParticipant.left_at.is_(None),
            )
            .values(left_at=left_at, screen_sharing=False, updated_at=left_at)
        )
        result = cast(CursorResult[Any], self.session.execute(statement))
        return int(result.rowcount or 0)

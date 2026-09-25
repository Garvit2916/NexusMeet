from datetime import datetime
from typing import Any, cast

from sqlalchemy import case, exists, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.enums import MeetingStatus, ParticipantRole
from app.models.meeting import Meeting
from app.models.participant import MeetingParticipant
from app.utils.ids import meeting_code_from_id


class MeetingRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, meeting: Meeting) -> Meeting:
        self.session.add(meeting)
        return meeting

    def get_by_id(self, meeting_id: str, *, populate_existing: bool = False) -> Meeting | None:
        statement = (
            select(Meeting)
            .where(Meeting.id == meeting_id)
            .options(joinedload(Meeting.host))
            .execution_options(populate_existing=populate_existing)
        )
        return self.session.scalar(statement)

    def get_by_identifier(self, identifier: str) -> Meeting | None:
        meeting = self.get_by_id(identifier)
        if meeting is not None:
            return meeting
        normalized_identifier = identifier.strip().upper()
        if not normalized_identifier.startswith("NM-"):
            return None
        code = normalized_identifier[3:]
        if not code:
            return None
        statement = (
            select(Meeting)
            .where(Meeting.id.like(f"mtg_{code[:8].lower()}%"))
            .options(joinedload(Meeting.host))
        )
        for candidate in self.session.scalars(statement):
            if meeting_code_from_id(candidate.id) == normalized_identifier:
                return candidate
        return None

    def list_for_user(
        self,
        user_id: str,
        *,
        scope: str,
        status: MeetingStatus | None,
        limit: int,
        offset: int,
    ) -> tuple[list[Meeting], int]:
        participant_membership = exists(
            select(MeetingParticipant.id).where(
                MeetingParticipant.meeting_id == Meeting.id,
                MeetingParticipant.user_id == user_id,
                MeetingParticipant.role == ParticipantRole.ATTENDEE,
            )
        )
        conditions: list[Any] = []
        if scope == "hosted":
            conditions.append(Meeting.host_id == user_id)
        elif scope == "joined":
            conditions.append(participant_membership)
        else:
            conditions.append(or_(Meeting.host_id == user_id, participant_membership))
        if status is not None:
            conditions.append(Meeting.status == status)

        total_statement = select(func.count(Meeting.id)).where(*conditions)
        total = int(self.session.scalar(total_statement) or 0)

        status_order = case(
            (Meeting.status == MeetingStatus.LIVE, 0),
            (Meeting.status == MeetingStatus.SCHEDULED, 1),
            else_=2,
        )
        statement = (
            select(Meeting)
            .where(*conditions)
            .options(
                joinedload(Meeting.host),
                selectinload(Meeting.participants).joinedload(MeetingParticipant.user),
            )
            .order_by(
                status_order,
                func.coalesce(Meeting.scheduled_at, Meeting.created_at).asc(),
                Meeting.created_at.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        meetings = list(self.session.scalars(statement).unique().all())
        return meetings, total

    def update(self, meeting: Meeting, values: dict[str, Any], updated_at: datetime) -> Meeting:
        for field, value in values.items():
            setattr(meeting, field, value)
        meeting.updated_at = updated_at
        self.session.flush()
        return meeting

    def transition(
        self,
        meeting_id: str,
        *,
        expected_statuses: set[MeetingStatus],
        new_status: MeetingStatus,
        values: dict[str, Any],
    ) -> bool:
        statement = (
            update(Meeting)
            .where(
                Meeting.id == meeting_id,
                Meeting.status.in_(expected_statuses),
            )
            .values(status=new_status, **values)
        )
        result = cast(CursorResult[Any], self.session.execute(statement))
        return result.rowcount == 1

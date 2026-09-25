from datetime import datetime
from hashlib import sha256
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.enums import MeetingStatus, ParticipantRole
from app.models.meeting import MAX_MEETING_DURATION_MINUTES, Meeting
from app.models.participant import MeetingParticipant
from app.models.user import User
from app.repositories.meeting_repository import MeetingRepository
from app.repositories.participant_repository import ParticipantRepository
from app.repositories.user_repository import UserRepository
from app.schemas.common import PageMeta
from app.schemas.meeting import (
    CreateInstantMeetingRequest,
    MeetingBase,
    MeetingDetails,
    MeetingList,
    MeetingListItem,
    ScheduleMeetingRequest,
    UpdateMeetingRequest,
)
from app.schemas.participant import JoinMeetingRequest, MediaStateUpdate, ParticipantResponse
from app.utils.ids import generate_meeting_id
from app.utils.time import ensure_utc, utc_now


class MeetingService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.meetings = MeetingRepository(session)
        self.participants = ParticipantRepository(session)

    def schedule(self, host: User, payload: ScheduleMeetingRequest) -> MeetingDetails:
        scheduled_at = ensure_utc(payload.scheduled_at)
        self._require_future(scheduled_at)
        meeting = self._create_meeting(
            host=host,
            title=payload.title,
            description=payload.description,
            scheduled_at=scheduled_at,
            duration_minutes=payload.duration_minutes,
            timezone=payload.timezone,
            invite_emails=payload.invite_emails,
            status=MeetingStatus.SCHEDULED,
            is_instant=False,
            started_at=None,
        )
        return self._load_details(meeting.id, host.id)

    def create_instant(self, host: User, payload: CreateInstantMeetingRequest) -> MeetingDetails:
        started_at = utc_now()
        meeting = self._create_meeting(
            host=host,
            title=payload.title or "Instant meeting",
            description=payload.description,
            scheduled_at=None,
            duration_minutes=payload.duration_minutes,
            timezone=payload.timezone,
            invite_emails=payload.invite_emails,
            status=MeetingStatus.LIVE,
            is_instant=True,
            started_at=started_at,
        )
        return self._load_details(meeting.id, host.id)

    def get(self, meeting_id: str, current_user: User | None = None) -> MeetingDetails:
        return self._load_details(
            meeting_id,
            current_user.id if current_user is not None else None,
        )

    def list_meetings(
        self,
        current_user: User,
        *,
        scope: str,
        status: MeetingStatus | None,
        limit: int,
        offset: int,
    ) -> tuple[MeetingList, PageMeta]:
        meetings, total = self.meetings.list_for_user(
            current_user.id,
            scope=scope,
            status=status,
            limit=limit,
            offset=offset,
        )
        items = [self._to_list_item(meeting, current_user.id) for meeting in meetings]
        return (
            MeetingList(items=items, meetings=items, total=total),
            PageMeta(total=total, limit=limit, offset=offset),
        )

    def update(
        self,
        meeting_id: str,
        host: User,
        payload: UpdateMeetingRequest,
    ) -> MeetingDetails:
        meeting = self._required_meeting(meeting_id)
        self._require_host(meeting, host)
        if meeting.status is not MeetingStatus.SCHEDULED:
            self._raise_transition(meeting, "update", {MeetingStatus.SCHEDULED})

        values: dict[str, Any] = payload.model_dump(exclude_unset=True)
        if "scheduled_at" in values:
            scheduled_at = ensure_utc(values["scheduled_at"])
            self._require_future(scheduled_at)
            values["scheduled_at"] = scheduled_at
        if "end_time" in values:
            scheduled_at_value = values.get("scheduled_at", meeting.scheduled_at)
            if scheduled_at_value is None:
                raise AppError(
                    422,
                    "START_TIME_REQUIRED",
                    "A start time is required when updating the end time",
                )
            end_time = ensure_utc(values.pop("end_time"))
            duration_seconds = (end_time - scheduled_at_value).total_seconds()
            if duration_seconds <= 0 or duration_seconds % 60 != 0:
                raise AppError(
                    422,
                    "INVALID_MEETING_DURATION",
                    "Meeting end time must be after the start time in whole minutes",
                )
            derived_duration = int(duration_seconds // 60)
            if derived_duration > MAX_MEETING_DURATION_MINUTES:
                raise AppError(
                    422,
                    "INVALID_MEETING_DURATION",
                    "Meeting duration cannot exceed 1440 minutes",
                )
            if "duration_minutes" in values and values["duration_minutes"] != derived_duration:
                raise AppError(
                    422,
                    "INVALID_MEETING_DURATION",
                    "duration_minutes must match end_time",
                )
            values["duration_minutes"] = derived_duration
        self.meetings.update(meeting, values, utc_now())
        self._commit()
        return self._load_details(meeting.id, host.id)

    def start(self, meeting_id: str, host: User) -> MeetingDetails:
        meeting = self._required_meeting(meeting_id)
        self._require_host(meeting, host)
        if meeting.status is not MeetingStatus.SCHEDULED:
            self._raise_transition(meeting, "start", {MeetingStatus.SCHEDULED})

        now = utc_now()
        participant = self.participants.get_for_user(meeting.id, host.id)
        changed = self.meetings.transition(
            meeting.id,
            expected_statuses={MeetingStatus.SCHEDULED},
            new_status=MeetingStatus.LIVE,
            values={"started_at": now, "updated_at": now},
        )
        if not changed:
            self._raise_transition(meeting, "start", {MeetingStatus.SCHEDULED})
        if participant is None:
            participant = self.participants.add(
                MeetingParticipant(
                    meeting_id=meeting.id,
                    user_id=host.id,
                    role=ParticipantRole.HOST,
                    joined_at=now,
                    display_name=host.name,
                )
            )
        else:
            participant.role = ParticipantRole.HOST
            if not participant.display_name:
                participant.display_name = host.name
            if participant.joined_at is None or participant.left_at is not None:
                self.participants.reactivate(participant, joined_at=now)
            else:
                participant.updated_at = now
        self._commit()
        return self._load_details(meeting.id, host.id)

    def end(self, meeting_id: str, host: User) -> MeetingDetails:
        meeting = self._required_meeting(meeting_id)
        self._require_host(meeting, host)
        if meeting.status is not MeetingStatus.LIVE:
            self._raise_transition(meeting, "end", {MeetingStatus.LIVE})

        now = utc_now()
        changed = self.meetings.transition(
            meeting.id,
            expected_statuses={MeetingStatus.LIVE},
            new_status=MeetingStatus.ENDED,
            values={"ended_at": now, "updated_at": now},
        )
        if not changed:
            self._raise_transition(meeting, "end", {MeetingStatus.LIVE})
        self.participants.mark_all_left(meeting.id, now)
        self._commit()
        return self._load_details(meeting.id, host.id)

    def cancel(self, meeting_id: str, host: User) -> MeetingDetails:
        meeting = self._required_meeting(meeting_id)
        self._require_host(meeting, host)
        allowed = {MeetingStatus.SCHEDULED, MeetingStatus.LIVE}
        if meeting.status not in allowed:
            self._raise_transition(meeting, "cancel", allowed)

        now = utc_now()
        values: dict[str, datetime] = {"cancelled_at": now, "updated_at": now}
        if meeting.status is MeetingStatus.LIVE:
            values["ended_at"] = now
        changed = self.meetings.transition(
            meeting.id,
            expected_statuses=allowed,
            new_status=MeetingStatus.CANCELLED,
            values=values,
        )
        if not changed:
            self._raise_transition(meeting, "cancel", allowed)
        self.participants.mark_all_left(meeting.id, now)
        self._commit()
        return self._load_details(meeting.id, host.id)

    def join(
        self,
        meeting_id: str,
        current_user: User,
        payload: JoinMeetingRequest | None = None,
    ) -> MeetingDetails:
        meeting = self._required_meeting(meeting_id)
        display_name = payload.display_name if payload is not None else None
        actor = current_user
        now = utc_now()
        if meeting.status is MeetingStatus.SCHEDULED:
            is_host = meeting.host_id == actor.id
            scheduled_at = meeting.scheduled_at
            if not is_host and (scheduled_at is None or scheduled_at > now):
                self._raise_transition(meeting, "join", {MeetingStatus.LIVE})
            changed = self.meetings.transition(
                meeting.id,
                expected_statuses={MeetingStatus.SCHEDULED},
                new_status=MeetingStatus.LIVE,
                values={"started_at": now, "updated_at": now},
            )
            if not changed:
                self._raise_transition(meeting, "join", {MeetingStatus.LIVE})
        elif meeting.status is not MeetingStatus.LIVE:
            self._raise_transition(meeting, "join", {MeetingStatus.LIVE})

        participant = self.participants.get_for_user(meeting.id, actor.id)
        if participant is not None and participant.removed_at is not None:
            raise AppError(
                403,
                "PARTICIPANT_REMOVED",
                "You were removed from this meeting by the host",
                {"meeting_id": meeting.id},
            )
        if self._is_active(participant):
            if display_name is not None and participant is not None:
                participant.display_name = display_name
                participant.updated_at = utc_now()
                self._commit()
            return self._load_details(meeting.id, actor.id)

        now = utc_now()
        if participant is None:
            self.participants.add(
                MeetingParticipant(
                    meeting_id=meeting.id,
                    user_id=actor.id,
                    role=(
                        ParticipantRole.HOST
                        if meeting.host_id == actor.id
                        else ParticipantRole.ATTENDEE
                    ),
                    joined_at=now,
                    display_name=display_name or actor.name,
                )
            )
        else:
            participant.role = (
                ParticipantRole.HOST if meeting.host_id == actor.id else ParticipantRole.ATTENDEE
            )
            participant.display_name = display_name or participant.display_name or actor.name
            self.participants.reactivate(participant, joined_at=now)
        self._commit()
        return self._load_details(meeting.id, actor.id)

    def leave(self, meeting_id: str, current_user: User) -> MeetingDetails:
        meeting, _ = self._require_access(meeting_id, current_user.id)
        if meeting.status is not MeetingStatus.LIVE:
            self._raise_transition(meeting, "leave", {MeetingStatus.LIVE})
        participant = self.participants.get_for_user(meeting.id, current_user.id)
        if participant is not None and participant.removed_at is not None:
            raise AppError(
                403,
                "PARTICIPANT_REMOVED",
                "You were removed from this meeting by the host",
            )
        if not self._is_active(participant):
            raise AppError(
                409,
                "NOT_ACTIVE_PARTICIPANT",
                "The current user is not an active participant",
            )
        assert participant is not None
        self.participants.mark_left(participant, utc_now())
        self._commit()
        return self._load_details(meeting.id, current_user.id)

    def require_host(self, meeting_id: str, user: User) -> Meeting:
        meeting = self._required_meeting(meeting_id)
        self._require_host(meeting, user)
        return meeting

    def mute_participant(
        self,
        meeting_id: str,
        host: User,
        participant_id: int,
        *,
        muted: bool,
    ) -> ParticipantResponse:
        meeting = self.require_host(meeting_id, host)
        if meeting.status is not MeetingStatus.LIVE:
            self._raise_transition(meeting, "mute a participant", {MeetingStatus.LIVE})
        participant = self._require_participant(meeting.id, participant_id)
        self._reject_host_target(participant, "mute")
        self.participants.set_host_mute(participant, muted=muted, muted_at=utc_now())
        self._commit()
        return ParticipantResponse.model_validate(participant)

    def remove_participant(
        self,
        meeting_id: str,
        host: User,
        participant_id: int,
    ) -> ParticipantResponse:
        meeting = self.require_host(meeting_id, host)
        participant = self._require_participant(meeting.id, participant_id)
        if participant.removed_at is not None:
            raise AppError(
                409,
                "PARTICIPANT_ALREADY_REMOVED",
                "This participant has already been removed from the meeting",
            )
        self._reject_host_target(participant, "remove")
        if self._is_active(participant):
            self.participants.mark_removed(participant, utc_now())
        self._commit()
        return ParticipantResponse.model_validate(participant)

    def get_participants(
        self,
        meeting_id: str,
        current_user: User | None = None,
    ) -> list[ParticipantResponse]:
        meeting = self._required_meeting(meeting_id)
        participants = self.participants.list_active(meeting.id)
        return [ParticipantResponse.model_validate(item) for item in participants]

    def update_media_state(
        self,
        meeting_id: str,
        current_user: User,
        payload: MediaStateUpdate,
    ) -> ParticipantResponse:
        meeting, _ = self._require_access(meeting_id, current_user.id)
        if meeting.status is not MeetingStatus.LIVE:
            self._raise_transition(meeting, "update media state", {MeetingStatus.LIVE})
        participant = self.participants.get_for_user(meeting.id, current_user.id)
        if participant is not None and participant.removed_at is not None:
            raise AppError(
                403,
                "PARTICIPANT_REMOVED",
                "You were removed from this meeting by the host",
            )
        if not self._is_active(participant):
            raise AppError(
                409,
                "NOT_ACTIVE_PARTICIPANT",
                "The current user is not an active participant",
            )
        assert participant is not None
        if payload.screen_sharing is True:
            active_sharer = self.participants.get_active_screen_sharer(
                meeting.id, exclude_participant_id=participant.id
            )
            if active_sharer is not None:
                raise AppError(
                    409,
                    "SCREEN_SHARING_CONFLICT",
                    "Another participant is already sharing their screen",
                    {"participant_id": active_sharer.id},
                )
        values = payload.model_dump(exclude_unset=True)
        now = utc_now()
        for field, value in values.items():
            setattr(participant, field, value)
        participant.updated_at = now
        self._commit()
        return ParticipantResponse.model_validate(participant)

    def _create_meeting(
        self,
        *,
        host: User,
        title: str,
        description: str,
        scheduled_at: datetime | None,
        duration_minutes: int,
        timezone: str,
        invite_emails: list[str],
        status: MeetingStatus,
        is_instant: bool,
        started_at: datetime | None,
    ) -> Meeting:
        for _ in range(5):
            meeting = Meeting(
                id=generate_meeting_id(),
                host_id=host.id,
                title=title,
                description=description,
                scheduled_at=scheduled_at,
                duration_minutes=duration_minutes,
                timezone=timezone,
                status=status,
                is_instant=is_instant,
                started_at=started_at,
            )
            self.meetings.add(meeting)
            self.participants.add(
                MeetingParticipant(
                    meeting_id=meeting.id,
                    user_id=host.id,
                    role=ParticipantRole.HOST,
                    joined_at=started_at,
                    display_name=host.name,
                )
            )
            self._add_invitees(meeting.id, invite_emails, host.id)
            try:
                self._commit()
                return meeting
            except AppError as exc:
                if exc.code == "MEETING_ID_COLLISION":
                    continue
                raise
        raise AppError(
            503,
            "MEETING_ID_EXHAUSTED",
            "Could not allocate a unique meeting identifier",
        )

    def _add_invitees(self, meeting_id: str, invite_emails: list[str], host_id: str) -> None:
        for email in invite_emails:
            user = UserRepository(self.session).get_by_email(email)
            if user is None:
                email_hash = sha256(email.encode("utf-8")).hexdigest()[:24]
                user = User(
                    id=f"usr_invite_{email_hash}",
                    name=email.split("@", 1)[0].replace(".", " ").title(),
                    email=email,
                )
                UserRepository(self.session).add(user)
            if user.id == host_id:
                continue
            self.participants.add(
                MeetingParticipant(
                    meeting_id=meeting_id,
                    user_id=user.id,
                    role=ParticipantRole.ATTENDEE,
                    display_name=user.name,
                )
            )

    def _load_details(self, meeting_id: str, user_id: str | None) -> MeetingDetails:
        meeting = self._required_meeting(meeting_id)
        participant = (
            self.participants.get_for_user(meeting.id, user_id) if user_id is not None else None
        )
        active_participants = self.participants.list_active(meeting.id)
        return self._to_details(meeting, participant, active_participants)

    def _require_access(
        self, meeting_id: str, user_id: str
    ) -> tuple[Meeting, MeetingParticipant | None]:
        meeting = self._required_meeting(meeting_id)
        participant = self.participants.get_for_user(meeting.id, user_id)
        if meeting.host_id != user_id and participant is None:
            raise AppError(
                403,
                "MEETING_ACCESS_DENIED",
                "You do not have access to this meeting",
            )
        return meeting, participant

    def _required_meeting(self, meeting_id: str) -> Meeting:
        meeting = self.meetings.get_by_identifier(meeting_id)
        if meeting is None:
            raise AppError(
                404,
                "MEETING_NOT_FOUND",
                "Meeting not found",
                {"meeting_id": meeting_id},
            )
        return meeting

    def _require_participant(self, meeting_id: str, participant_id: int) -> MeetingParticipant:
        participant = self.participants.get_by_id(participant_id)
        if participant is None or participant.meeting_id != meeting_id:
            raise AppError(
                404,
                "PARTICIPANT_NOT_FOUND",
                "Participant not found in this meeting",
                {"participant_id": participant_id},
            )
        return participant

    @staticmethod
    def _reject_host_target(participant: MeetingParticipant, action: str) -> None:
        if participant.is_host:
            raise AppError(
                409,
                "HOST_PARTICIPANT_PROTECTED",
                f"The host cannot be {action} by a host control",
                {"participant_id": participant.id},
            )

    @staticmethod
    def _require_host(meeting: Meeting, user: User) -> None:
        if meeting.host_id != user.id:
            raise AppError(
                403,
                "MEETING_HOST_REQUIRED",
                "Only the meeting host can perform this action",
            )

    @staticmethod
    def _require_future(scheduled_at: datetime) -> None:
        if scheduled_at <= utc_now():
            raise AppError(
                422,
                "SCHEDULE_IN_PAST",
                "Meeting schedule must be in the future",
                {"scheduled_at": scheduled_at.isoformat()},
            )

    @staticmethod
    def _is_active(participant: MeetingParticipant | None) -> bool:
        return (
            participant is not None
            and participant.joined_at is not None
            and participant.left_at is None
            and participant.removed_at is None
        )

    @staticmethod
    def _raise_transition(
        meeting: Meeting,
        action: str,
        allowed_statuses: set[MeetingStatus],
    ) -> None:
        raise AppError(
            409,
            "INVALID_STATUS_TRANSITION",
            f"Cannot {action} a meeting with status '{meeting.status.value}'",
            {
                "current_status": meeting.status.value,
                "allowed_statuses": sorted(status.value for status in allowed_statuses),
            },
        )

    def _to_list_item(self, meeting: Meeting, current_user_id: str) -> MeetingListItem:
        participants = [
            participant for participant in meeting.participants if self._is_active(participant)
        ]
        membership = next(
            (
                participant
                for participant in meeting.participants
                if participant.user_id == current_user_id
            ),
            None,
        )
        role = (
            ParticipantRole.HOST
            if meeting.host_id == current_user_id
            else membership.role
            if membership is not None
            else None
        )
        return MeetingListItem(
            **MeetingBase.model_validate(meeting).model_dump(),
            participants=[
                ParticipantResponse.model_validate(participant) for participant in participants
            ],
            participant_count=len(participants),
            current_user_role=role,
        )

    def _to_details(
        self,
        meeting: Meeting,
        membership: MeetingParticipant | None,
        participants: list[MeetingParticipant],
    ) -> MeetingDetails:
        if membership is None:
            role = None
        elif meeting.host_id == membership.user_id:
            role = ParticipantRole.HOST
        else:
            role = membership.role
        meeting_base = MeetingBase.model_validate(meeting)
        meeting_item = MeetingListItem(
            **meeting_base.model_dump(),
            participants=[
                ParticipantResponse.model_validate(participant) for participant in participants
            ],
            participant_count=len(participants),
            current_user_role=role,
        )
        return MeetingDetails(
            **meeting_item.model_dump(),
            is_current_user_participant=self._is_active(membership),
        )

    def _commit(self) -> None:
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            message = str(exc)
            if "meetings.id" in message:
                raise AppError(
                    409,
                    "MEETING_ID_COLLISION",
                    "Meeting identifier collision detected",
                ) from exc
            raise AppError(
                409,
                "DATA_CONFLICT",
                "The request conflicts with existing data",
            ) from exc
        except Exception:
            self.session.rollback()
            raise

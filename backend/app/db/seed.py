from datetime import datetime, timedelta
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.security import hash_password
from app.db.session import Database
from app.models.enums import MeetingStatus, ParticipantRole
from app.models.meeting import Meeting
from app.models.participant import MeetingParticipant
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.utils.time import utc_now

SAMPLE_USERS: tuple[tuple[str, str, str], ...] = (
    (
        "usr_seed_maya_00000000000000000001",
        "Maya Chen",
        "maya.chen@nexusmeet.app",
    ),
    (
        "usr_seed_noah_00000000000000000001",
        "Noah Williams",
        "noah.williams@nexusmeet.app",
    ),
    (
        "usr_seed_priya_00000000000000000001",
        "Priya Shah",
        "priya.shah@nexusmeet.app",
    ),
)

SAMPLE_MEETINGS: tuple[tuple[str, int, int, MeetingStatus, tuple[str, ...]], ...] = (
    (
        "Product design sprint",
        1,
        10,
        MeetingStatus.SCHEDULED,
        ("usr_seed_maya_00000000000000000001", "usr_seed_noah_00000000000000000001"),
    ),
    (
        "NexusMeet weekly sync",
        3,
        14,
        MeetingStatus.SCHEDULED,
        ("usr_seed_maya_00000000000000000001", "usr_seed_priya_00000000000000000001"),
    ),
    (
        "Customer advisory circle",
        6,
        11,
        MeetingStatus.SCHEDULED,
        (
            "usr_seed_noah_00000000000000000001",
            "usr_seed_priya_00000000000000000001",
        ),
    ),
    (
        "Focus block: roadmap",
        8,
        9,
        MeetingStatus.SCHEDULED,
        (),
    ),
    (
        "Team retrospective",
        -1,
        15,
        MeetingStatus.ENDED,
        ("usr_seed_maya_00000000000000000001", "usr_seed_priya_00000000000000000001"),
    ),
    (
        "Research readout",
        -4,
        9,
        MeetingStatus.ENDED,
        (
            "usr_seed_maya_00000000000000000001",
            "usr_seed_noah_00000000000000000001",
        ),
    ),
)


LEGACY_SEED_EMAIL_SUFFIX = "@nexusmeet.local"


def _normalize_legacy_seed_email(user: User, email: str) -> bool:
    """Re-point seeded demo accounts at a deliverable email domain.

    Password validation rejects reserved domains such as `.local`, so demo rows
    created by earlier revisions are rewritten once to the configured address.
    """
    if not user.email.endswith(LEGACY_SEED_EMAIL_SUFFIX):
        return False
    normalized = email.strip().lower()
    if user.email == normalized:
        return False
    user.email = normalized
    return True


def seed_default_user(
    session_factory: sessionmaker[Session],
    *,
    user_id: str,
    name: str,
    email: str,
    password: str,
    avatar_url: str | None = None,
) -> bool:
    with session_factory() as session:
        repository = UserRepository(session)
        existing = repository.get_by_id(user_id)
        if existing is not None:
            changed = _normalize_legacy_seed_email(existing, email)
            # Databases created before authentication shipped have no password
            # hash, so backfill the documented development password once.
            if existing.password_hash is None:
                existing.password_hash = hash_password(password)
                changed = True
            if changed:
                session.commit()
                return True
            return False
        session.add(
            User(
                id=user_id,
                name=name,
                email=email.lower(),
                password_hash=hash_password(password),
                avatar_url=avatar_url,
            )
        )
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            if UserRepository(session).get_by_id(user_id) is not None:
                return False
            raise
        return True


def _sample_meeting_id(title: str) -> str:
    return f"mtg_{sha256(title.encode('utf-8')).hexdigest()[:32]}"


def _sample_start(reference: datetime, day_offset: int, hour: int) -> datetime:
    return reference.replace(hour=hour, minute=0, second=0, microsecond=0) + timedelta(
        days=day_offset
    )


def _seed_sample_user(session: Session, user_id: str, name: str, email: str, password: str) -> bool:
    repository = UserRepository(session)
    existing = repository.get_by_id(user_id)
    if existing is not None:
        changed = _normalize_legacy_seed_email(existing, email)
        if existing.password_hash is None:
            existing.password_hash = hash_password(password)
            changed = True
        if changed:
            session.flush()
            return True
        return False
    if repository.get_by_email(email) is not None:
        return False
    repository.add(User(id=user_id, name=name, email=email, password_hash=hash_password(password)))
    return True


def _ensure_participant(
    session: Session,
    *,
    meeting_id: str,
    user_id: str,
    display_name: str,
    role: ParticipantRole,
    joined_at: datetime | None,
    left_at: datetime | None,
) -> bool:
    participant = session.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.user_id == user_id,
        )
    )
    if participant is not None:
        participant.role = role
        if not participant.display_name:
            participant.display_name = display_name
        if participant.joined_at is None and joined_at is not None:
            participant.joined_at = joined_at
        if left_at is not None:
            participant.left_at = left_at
        return False
    session.add(
        MeetingParticipant(
            meeting_id=meeting_id,
            user_id=user_id,
            display_name=display_name,
            role=role,
            joined_at=joined_at,
            left_at=left_at,
        )
    )
    return True


def seed_sample_meetings(database: Database, settings: Settings) -> bool:
    created = False
    reference = utc_now()
    with database.session_factory() as session:
        for user_id, name, email in SAMPLE_USERS:
            created = (
                _seed_sample_user(session, user_id, name, email, settings.default_user_password)
                or created
            )
        session.flush()
        for title, day_offset, hour, status, attendee_ids in SAMPLE_MEETINGS:
            meeting_id = _sample_meeting_id(title)
            meeting = session.get(Meeting, meeting_id)
            started_at = _sample_start(reference, day_offset, hour)
            duration_minutes = 30 if "weekly sync" in title.lower() else 60
            if title == "Product design sprint":
                duration_minutes = 50
            elif title == "Focus block: roadmap":
                duration_minutes = 90
            elif title == "Team retrospective":
                duration_minutes = 45
            ended_at = started_at + timedelta(minutes=duration_minutes)
            if meeting is None:
                meeting = Meeting(
                    id=meeting_id,
                    host_id=settings.default_user_id,
                    title=title,
                    description=f"A seeded NexusMeet conversation about {title.lower()}.",
                    scheduled_at=started_at,
                    duration_minutes=duration_minutes,
                    timezone="UTC",
                    status=status,
                    is_instant=False,
                    started_at=started_at if status is MeetingStatus.ENDED else None,
                    ended_at=ended_at if status is MeetingStatus.ENDED else None,
                    created_at=started_at - timedelta(days=1),
                    updated_at=reference,
                )
                session.add(meeting)
                created = True
            session.flush()
            host = session.get(User, settings.default_user_id)
            if host is None:
                raise RuntimeError("The default user must be seeded before sample meetings")
            created = (
                _ensure_participant(
                    session,
                    meeting_id=meeting.id,
                    user_id=host.id,
                    display_name=host.name,
                    role=ParticipantRole.HOST,
                    joined_at=started_at if status is MeetingStatus.ENDED else None,
                    left_at=ended_at if status is MeetingStatus.ENDED else None,
                )
                or created
            )
            for attendee_id in attendee_ids:
                attendee = session.get(User, attendee_id)
                if attendee is None:
                    continue
                created = (
                    _ensure_participant(
                        session,
                        meeting_id=meeting.id,
                        user_id=attendee.id,
                        display_name=attendee.name,
                        role=ParticipantRole.ATTENDEE,
                        joined_at=started_at if status is MeetingStatus.ENDED else None,
                        left_at=ended_at if status is MeetingStatus.ENDED else None,
                    )
                    or created
                )
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            return False
    return created


def seed_database(database: Database, settings: Settings) -> bool:
    created_user = seed_default_user(
        database.session_factory,
        user_id=settings.default_user_id,
        name=settings.default_user_name,
        email=settings.default_user_email,
        password=settings.default_user_password,
        avatar_url=settings.default_user_avatar_url,
    )
    if not settings.seed_sample_data:
        return created_user
    created_samples = seed_sample_meetings(database, settings)
    return created_user or created_samples

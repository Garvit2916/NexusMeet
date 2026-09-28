import logging
from pathlib import Path

from sqlalchemy import Column, Engine, MetaData, String, Table, inspect, select, text

from alembic.config import Config
from alembic.script import ScriptDirectory
from app.db.base import Base

logger = logging.getLogger(__name__)

# The newest revision this compatibility bootstrap knows how to materialize.
# It must match the newest file in ``alembic/versions``; ``test_database.py``
# pins it so a new migration cannot be added without updating this value.
CURRENT_SCHEMA_REVISION = "0004_meeting_chat"


def initialize_database(engine: Engine) -> None:
    __import__("app.models")
    Base.metadata.create_all(bind=engine, checkfirst=True)
    _add_compatibility_columns(engine)
    _ensure_migration_stamp(engine)


def _alembic_config() -> Config | None:
    """Build an Alembic config from the ini that sits next to the backend package.

    Resolved from ``__file__`` rather than the process working directory, because
    the container, the CLI, and the test runner all start in different folders.
    """
    ini_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    if not ini_path.is_file():
        return None
    return Config(str(ini_path))


def _known_revision_order() -> list[str]:
    """Return every revision in this project ordered oldest to newest.

    Reads the real ``alembic/versions`` tree so the ordering cannot drift from
    the migrations that actually exist.
    """
    config = _alembic_config()
    if config is None:
        return []
    try:
        script = ScriptDirectory.from_config(config)
    except Exception:  # pragma: no cover - only when the ini is unreadable
        logger.warning("Could not read Alembic revisions", exc_info=True)
        return []
    ordered: list[str] = []
    for revision in script.walk_revisions():
        ordered.append(revision.revision)
    ordered.reverse()
    return ordered


def _ensure_migration_stamp(engine: Engine) -> None:
    if not inspect(engine).has_table("alembic_version"):
        metadata = MetaData()
        Table(
            "alembic_version",
            metadata,
            Column("version_num", String(32), primary_key=True),
        ).create(bind=engine)
    version_table = Table("alembic_version", MetaData(), autoload_with=engine)
    with engine.begin() as connection:
        current_revision = connection.execute(
            select(version_table.c.version_num)
        ).scalar_one_or_none()
        if current_revision == CURRENT_SCHEMA_REVISION:
            return
        order = _known_revision_order()
        if current_revision is not None:
            if current_revision not in order:
                # The stamp names a revision this build has never heard of, so
                # the database was migrated by newer code. Leave it untouched.
                logger.warning(
                    "Schema stamp %s is not a known revision; leaving it unchanged",
                    current_revision,
                )
                return
            if order.index(current_revision) >= order.index(CURRENT_SCHEMA_REVISION):
                # The database is already at (or ahead of) the revision this
                # bootstrap knows about. Never move the stamp backwards: a
                # downgrade here would make the next `alembic upgrade head`
                # replay a migration against tables that already exist.
                return
            logger.info(
                "Advancing schema stamp from %s to %s",
                current_revision,
                CURRENT_SCHEMA_REVISION,
            )
        # The compatibility pass above already materialized the current schema,
        # so bring the stamp forward instead of replaying a migration.
        if current_revision is None:
            connection.execute(
                version_table.insert().values(version_num=CURRENT_SCHEMA_REVISION)
            )
        else:
            connection.execute(
                version_table.update().values(version_num=CURRENT_SCHEMA_REVISION)
            )


def _add_compatibility_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    statements: list[str] = []
    if "meetings" in table_names:
        meeting_columns = {column["name"] for column in inspector.get_columns("meetings")}
        if "duration_minutes" not in meeting_columns:
            statements.append(
                "ALTER TABLE meetings ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30"
            )
        if "timezone" not in meeting_columns:
            statements.append(
                "ALTER TABLE meetings ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC'"
            )
    if "users" in table_names:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "password_hash" not in user_columns:
            statements.append("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)")
    if "meeting_participants" in table_names:
        participant_columns = {
            column["name"] for column in inspector.get_columns("meeting_participants")
        }
        if "display_name" not in participant_columns:
            statements.append(
                "ALTER TABLE meeting_participants "
                "ADD COLUMN display_name VARCHAR(100) NOT NULL DEFAULT ''"
            )
        if "is_muted" not in participant_columns:
            statements.append(
                "ALTER TABLE meeting_participants ADD COLUMN is_muted BOOLEAN NOT NULL DEFAULT 0"
            )
        if "removed_at" not in participant_columns:
            statements.append("ALTER TABLE meeting_participants ADD COLUMN removed_at DATETIME")
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if "meeting_participants" in table_names and any(
            "display_name" in statement for statement in statements
        ):
            connection.execute(
                text(
                    "UPDATE meeting_participants "
                    "SET display_name = (SELECT name FROM users "
                    "WHERE users.id = meeting_participants.user_id) "
                    "WHERE display_name = ''"
                )
            )

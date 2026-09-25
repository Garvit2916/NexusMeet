from sqlalchemy import Column, Engine, MetaData, String, Table, inspect, select, text

from app.db.base import Base

CURRENT_SCHEMA_REVISION = "0002_meeting_duration"


def initialize_database(engine: Engine) -> None:
    __import__("app.models")
    Base.metadata.create_all(bind=engine, checkfirst=True)
    _add_compatibility_columns(engine)
    _ensure_migration_stamp(engine)


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
        if current_revision is None:
            connection.execute(version_table.insert().values(version_num=CURRENT_SCHEMA_REVISION))


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
    if "meeting_participants" in table_names:
        participant_columns = {
            column["name"] for column in inspector.get_columns("meeting_participants")
        }
        if "display_name" not in participant_columns:
            statements.append(
                "ALTER TABLE meeting_participants "
                "ADD COLUMN display_name VARCHAR(100) NOT NULL DEFAULT ''"
            )
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

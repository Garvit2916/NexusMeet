"""Initial NexusMeet schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


meeting_status = sa.Enum(
    "scheduled",
    "live",
    "ended",
    "cancelled",
    name="meeting_status",
    native_enum=False,
    create_constraint=True,
    length=16,
)
participant_role = sa.Enum(
    "host",
    "attendee",
    name="participant_role",
    native_enum=False,
    create_constraint=True,
    length=16,
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("avatar_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "meetings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("host_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", meeting_status, nullable=False),
        sa.Column("is_instant", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "is_instant = 0 OR scheduled_at IS NULL",
            name="ck_meetings_instant_without_schedule",
        ),
        sa.ForeignKeyConstraint(["host_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meetings_created_at", "meetings", ["created_at"])
    op.create_index("ix_meetings_host_created_at", "meetings", ["host_id", "created_at"])
    op.create_index("ix_meetings_status_scheduled_at", "meetings", ["status", "scheduled_at"])

    op.create_table(
        "meeting_participants",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("meeting_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("role", participant_role, nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("audio_enabled", sa.Boolean(), nullable=False),
        sa.Column("video_enabled", sa.Boolean(), nullable=False),
        sa.Column("screen_sharing", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at",
            name="ck_meeting_participants_valid_interval",
        ),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "meeting_id",
            "user_id",
            name="uq_meeting_participants_meeting_user",
        ),
    )
    op.create_index(
        "ix_meeting_participants_meeting_joined_at",
        "meeting_participants",
        ["meeting_id", "joined_at"],
    )
    op.create_index(
        "ix_meeting_participants_user_meeting",
        "meeting_participants",
        ["user_id", "meeting_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_meeting_participants_user_meeting",
        table_name="meeting_participants",
    )
    op.drop_index(
        "ix_meeting_participants_meeting_joined_at",
        table_name="meeting_participants",
    )
    op.drop_table("meeting_participants")
    op.drop_index("ix_meetings_status_scheduled_at", table_name="meetings")
    op.drop_index("ix_meetings_host_created_at", table_name="meetings")
    op.drop_index("ix_meetings_created_at", table_name="meetings")
    op.drop_table("meetings")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

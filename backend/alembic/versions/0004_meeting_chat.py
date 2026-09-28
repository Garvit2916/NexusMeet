"""Add in-meeting chat.

Revision ID: 0004_meeting_chat
Revises: 0003_auth_and_host_controls
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_meeting_chat"
down_revision: str | None = "0003_auth_and_host_controls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "meeting_chat_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("meeting_id", sa.String(length=36), nullable=False),
        sa.Column("participant_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("sender_name", sa.String(length=100), nullable=False),
        sa.Column("body", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # The model declares the cascade, so the migration must too: without it
        # the chat rows outlive the meeting they belong to.
        sa.ForeignKeyConstraint(
            ["meeting_id"],
            ["meetings.id"],
            name="fk_meeting_chat_messages_meeting_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["participant_id"],
            ["meeting_participants.id"],
            name="fk_meeting_chat_messages_participant_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_meeting_chat_messages_user_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_meeting_chat_messages"),
    )
    op.create_index(
        "ix_meeting_chat_messages_meeting_id_id",
        "meeting_chat_messages",
        ["meeting_id", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_meeting_chat_messages_meeting_id_id", table_name="meeting_chat_messages")
    op.drop_table("meeting_chat_messages")

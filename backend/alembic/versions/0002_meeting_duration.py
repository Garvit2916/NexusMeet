"""Add meeting duration, timezone, and participant display names.

Revision ID: 0002_meeting_duration
Revises: 0001_initial
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_meeting_duration"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("meetings") as batch_op:
        batch_op.add_column(
            sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="30")
        )
        batch_op.add_column(
            sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC")
        )
        batch_op.create_check_constraint(
            "ck_meetings_positive_duration",
            "duration_minutes > 0",
        )

    with op.batch_alter_table("meeting_participants") as batch_op:
        batch_op.add_column(
            sa.Column(
                "display_name",
                sa.String(length=100),
                nullable=False,
                server_default="",
            )
        )

    op.execute(
        "UPDATE meeting_participants "
        "SET display_name = (SELECT name FROM users WHERE users.id = meeting_participants.user_id) "
        "WHERE display_name = ''"
    )


def downgrade() -> None:
    with op.batch_alter_table("meeting_participants") as batch_op:
        batch_op.drop_column("display_name")

    with op.batch_alter_table("meetings") as batch_op:
        batch_op.drop_constraint("ck_meetings_positive_duration", type_="check")
        batch_op.drop_column("timezone")
        batch_op.drop_column("duration_minutes")

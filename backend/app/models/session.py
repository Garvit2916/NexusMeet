from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.session import UTCDateTime
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.user import User


class AuthSession(Base):
    """Server-side session record.

    ``id`` stores the SHA-256 digest of the opaque session token that is handed to
    the browser in an HTTP-only cookie, so a database copy cannot be replayed.
    """

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    created_at = mapped_column(UTCDateTime, default=utc_now, nullable=False)

    user: Mapped[User] = relationship()

    __table_args__ = (
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_expires_at", "expires_at"),
    )

    @property
    def is_expired(self) -> bool:
        return self.expires_at <= utc_now()

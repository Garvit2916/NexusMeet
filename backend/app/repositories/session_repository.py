from datetime import datetime
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select
from sqlalchemy.orm import Session, joinedload

from app.models.session import AuthSession
from app.utils.time import utc_now


class SessionRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, auth_session: AuthSession) -> AuthSession:
        self.session.add(auth_session)
        return auth_session

    def get_active(self, session_id: str) -> AuthSession | None:
        statement = (
            select(AuthSession)
            .where(
                AuthSession.id == session_id,
                AuthSession.expires_at > utc_now(),
            )
            .options(joinedload(AuthSession.user))
        )
        return self.session.scalar(statement)

    def get(self, session_id: str) -> AuthSession | None:
        statement = select(AuthSession).where(AuthSession.id == session_id)
        return self.session.scalar(statement)

    def delete(self, auth_session: AuthSession) -> None:
        self.session.delete(auth_session)

    def purge_expired(self, *, now: datetime | None = None) -> int:
        cutoff = now if now is not None else utc_now()
        statement = delete(AuthSession).where(AuthSession.expires_at <= cutoff)
        result = cast(CursorResult[Any], self.session.execute(statement))
        return int(result.rowcount or 0)

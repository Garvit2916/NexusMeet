from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.session import get_db
from app.schemas.common import SuccessEnvelope
from app.schemas.health import HealthData
from app.utils.time import utc_now

router = APIRouter(tags=["health"])


@router.get("/health", response_model=SuccessEnvelope[HealthData])
def health_check(
    request: Request,
    db: Session = Depends(get_db),
) -> SuccessEnvelope[HealthData]:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise AppError(
            503,
            "DATABASE_UNAVAILABLE",
            "Database health check failed",
        ) from exc
    settings = request.app.state.settings
    return SuccessEnvelope(
        data=HealthData(
            status="healthy",
            service=settings.app_name,
            version=settings.app_version,
            database="ok",
            timestamp=utc_now(),
        )
    )

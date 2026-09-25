from datetime import datetime

from app.schemas.common import APIModel


class HealthData(APIModel):
    status: str
    service: str
    version: str
    database: str
    timestamp: datetime

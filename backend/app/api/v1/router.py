from fastapi import APIRouter

from app.api.v1.meetings import router as meetings_router
from app.api.v1.users import router as users_router

router = APIRouter()
router.include_router(meetings_router)
router.include_router(users_router)

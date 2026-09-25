import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import RequestResponseEndpoint

from app.api.health import router as health_router
from app.api.v1.router import router as api_v1_router
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.db.init_db import initialize_database
from app.db.seed import seed_database
from app.db.session import Database
from app.realtime.router import router as signaling_router

__all__ = ["app", "create_app"]


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
    database = Database(
        app_settings.database_url,
        echo=app_settings.database_echo,
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        try:
            if application.state.settings.auto_create_tables:
                initialize_database(application.state.database.engine)
            seed_database(application.state.database, application.state.settings)
            yield
        finally:
            application.state.database.dispose()

    application = FastAPI(
        title=app_settings.app_name,
        version=app_settings.app_version,
        environment=app_settings.environment,
        lifespan=lifespan,
    )
    application.state.settings = app_settings
    application.state.database = database
    application.state.session_factory = database.session_factory

    @application.middleware("http")
    async def request_id_middleware(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        incoming_request_id = request.headers.get(app_settings.request_id_header, "").strip()
        request_id = incoming_request_id[:128] or uuid4().hex
        request.state.request_id = request_id
        # Synchronous endpoints notify the async signaling hub from a worker
        # thread, so record the loop serving this request for them to hand off to.
        request.state.event_loop = asyncio.get_running_loop()
        response = await call_next(request)
        response.headers[app_settings.request_id_header] = request_id
        return response

    allow_all_origins = "*" in app_settings.cors_origin_list
    application.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origin_list,
        allow_credentials=not allow_all_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Authorization", app_settings.request_id_header],
        expose_headers=[app_settings.request_id_header],
    )
    register_exception_handlers(application)
    application.include_router(health_router)
    application.include_router(api_v1_router, prefix=app_settings.api_v1_prefix)
    # The signaling socket lives outside the versioned REST prefix: it is a
    # long-lived upgrade, not a resource under /api/v1.
    application.include_router(signaling_router)
    return application


app = create_app()

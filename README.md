# NexusMeet

NexusMeet is a calm, full-stack meeting workspace built around instant rooms, scheduled meetings, shareable invite links, and local camera/microphone previews. The project is intentionally small enough to run locally while keeping clear seams for authentication, WebRTC, and a production database.

## Features

- Responsive dashboard with upcoming and completed meetings
- Instant room creation
- Scheduled meetings with duration, timezone, description, and invite emails
- Meeting links and `NM-XXXXXXXX` codes
- Public meeting details and invite-link copying
- Pre-join camera and microphone preview
- Permission-aware local media with graceful camera/microphone fallbacks
- Persisted join, leave, and media-state updates
- Participant panel with host, online, microphone, camera, and screen-share state
- Scheduled meetings automatically become live when an attendee joins at or after the start time
- Idempotent default-user and sample-data seeding
- Typed frontend API boundary with request timeouts and structured errors
- FastAPI validation and consistent response envelopes
- SQLite for zero-configuration local development

## Stack

- **Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS, Vitest
- **Backend:** FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, SQLite
- **Identity:** A replaceable `UserIdentityProvider` with a development default user
- **Media:** Browser `MediaStream` APIs for local preview and controls

## Repository layout

```text
backend/
  app/
    api/                 FastAPI routes and dependencies
    core/                Settings, errors, identity provider
    db/                  Database setup, migrations, seed data
    models/              SQLAlchemy entities
    repositories/        Persistence boundaries
    schemas/             Pydantic request/response contracts
    services/            Business rules and transactions
    tests/               API and persistence tests
  alembic/                Versioned schema migrations
frontend/
  app/                    Next.js App Router routes
  components/             Dashboard, forms, room, and UI components
  hooks/                  Data loading and local media state
  lib/                    Types, parsing, formatting, and helpers
  services/               Typed API client boundary
  tests/                  Vitest component and utility tests
```

## Run locally

### Backend

From `backend/`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
alembic upgrade head
python seed.py
python -m uvicorn app.main:app --reload --port 8000
```

The API is available at `http://localhost:8000`; interactive OpenAPI documentation is at `http://localhost:8000/docs`.

The application also creates tables and seeds the default user on startup when `AUTO_CREATE_TABLES=true`. Alembic remains the recommended migration path for controlled deployments.

### Frontend

From `frontend/`, in a second terminal:

```powershell
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`.

The default development user is `Demo User` (`demo@nexusmeet.local`). Public meeting reads do not require a user header. Protected development endpoints use the default user when no header is supplied. The room client sends the known user ID when joining so participant state is associated with a stable user.

## API surface

All application endpoints are under `/api/v1` and return a success envelope shaped like:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Errors use a stable error envelope with a machine-readable `error.code`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness/readiness response |
| `GET` | `/users/me` | Current development user |
| `GET` | `/meetings` | Hosted/joined meeting list |
| `POST` | `/meetings` | Schedule a meeting alias |
| `POST` | `/meetings/schedule` | Schedule a meeting |
| `POST` | `/meetings/instant` | Create an instant live room |
| `GET` | `/meetings/{id-or-code}` | Public meeting details |
| `PATCH` | `/meetings/{id}` | Update a scheduled meeting |
| `POST` | `/meetings/{id}/start` | Host starts a scheduled meeting |
| `POST` | `/meetings/{id}/end` | Host ends a live meeting |
| `POST` | `/meetings/{id}/cancel` | Host cancels a meeting |
| `POST` | `/meetings/{id}/join` | Join a room |
| `POST` | `/meetings/{id}/leave` | Leave a room |
| `GET` | `/meetings/{id}/participants` | Active participant list |
| `PATCH` | `/meetings/{id}/participants/me/media` | Update own media state |

Meeting identifiers use the form `mtg_<32 hex characters>`. Short codes are derived from the first eight identifier characters and are formatted as `NM-XXXXXXXX`.

## Verification

Backend:

```powershell
python -m pytest
python -m ruff check app
python -m ruff format --check app
python -m mypy app
alembic upgrade head
alembic check
```

Frontend:

```powershell
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

## Deployment

`render.yaml` contains a two-service Render blueprint for a small deployment:

- FastAPI on a persistent disk for SQLite
- Next.js on a Node web service
- Environment values marked for dashboard configuration instead of committed secrets

Set the frontend build-time `NEXT_PUBLIC_API_URL` and backend `CORS_ORIGINS` to the actual deployed origins before building. For more than one backend instance, replace SQLite with a shared database and move participant presence/media signaling to a shared realtime service.

## Known limitations

- Remote WebRTC audio/video is not implemented. The room intentionally shows local video and synchronized participant/media metadata; it does not fake remote video tiles.
- The development identity header is not authentication. Replace `DefaultUserIdentityProvider` with session/JWT validation before exposing the service publicly.
- SQLite is appropriate for local development and a single API instance, not high-concurrency production workloads.
- Scheduled-time transitions are evaluated when a join request arrives; a background worker can be added for automatic status changes and notifications.

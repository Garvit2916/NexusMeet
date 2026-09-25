# NexusMeet

NexusMeet is a calm, full-stack meeting workspace built around instant rooms, scheduled meetings, shareable invite links, real email/password accounts, and server-authorized host controls. The project is intentionally small enough to run locally while keeping clear seams for WebRTC and a production database.

## Features

- Email/password accounts with Argon2id hashing and revocable server-side sessions
- Secure, HTTP-only session cookies (no tokens in `localStorage`, no `X-User-ID` identity header)
- Protected workspace, scheduling, and room routes with `next`-aware redirects
- Responsive dashboard with upcoming and completed meetings
- Instant room creation
- Scheduled meetings with duration, timezone, description, and invite emails
- Meeting links and `NM-XXXXXXXX` codes
- Public meeting details and invite-link copying
- Calendar integration: Google Calendar and Outlook prefilled event links, plus a standards-compliant `.ics` download with a stable UID, organizer, and a ten-minute reminder
- Pre-join camera and microphone preview
- Permission-aware local media with graceful camera/microphone fallbacks
- Persisted join, leave, and media-state updates
- Host-only end meeting, mute/unmute, and remove participant controls backed by the server
- Participant panel with host, muted-by-host, removed, online, microphone, camera, and screen-share state
- Scheduled meetings automatically become live when an attendee joins at or after the start time
- Idempotent default-user and sample-data seeding, including legacy seed backfill
- Typed frontend API boundary with request timeouts and structured errors
- FastAPI validation and consistent response envelopes
- SQLite for zero-configuration local development

## Stack

- **Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS, Vitest
- **Backend:** FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, SQLite
- **Auth:** Argon2id password hashing, opaque server-side sessions, HTTP-only cookies
- **Media:** Browser `MediaStream` APIs for local preview and controls

## Repository layout

```text
backend/
  app/
    api/                 FastAPI routes and dependencies
    core/                Settings, security helpers, errors
    db/                  Database setup, migrations, seed data
    models/              SQLAlchemy entities
    repositories/        Persistence boundaries
    schemas/             Pydantic request/response contracts
    services/            Business rules and transactions
    tests/               API and persistence tests
  alembic/                Versioned schema migrations
frontend/
  app/                    Next.js App Router routes
  components/             Auth, dashboard, forms, room, and UI components
  hooks/                  Data loading and local media state
  lib/                    Types, parsing, formatting, and helpers
  providers/              Auth and UI state providers
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

## Authentication

- Seeded development account: `demo@nexusmeet.app` / `demo12345` (override `DEFAULT_USER_PASSWORD` for any shared environment).
- Registration requires a name, a unique email, and a password of at least 8 characters.
- Passwords are hashed with Argon2id; the raw password is never stored or logged.
- On login or registration the API issues a random `nxs_`-prefixed token in an HTTP-only `nexusmeet_session` cookie and stores only its SHA-256 hash in the `sessions` table.
- Session lifetime is `SESSION_TTL_HOURS` (168 hours by default). `SESSION_COOKIE_SAMESITE` accepts `lax`, `strict`, or `none`, and `SESSION_COOKIE_SECURE` defaults to enabled in production.
- Logout revokes the server-side session, so the cookie cannot be replayed.
- CORS must list the exact frontend origins with credentials allowed; wildcard origins are rejected because the API uses cookies.
- Meetings can be created and signed up for with an account, and every participant is identified by the session's user record, never by a client-supplied user ID.

### Auth endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Create an account and start a session |
| `POST` | `/api/v1/auth/login` | Verify credentials and start a session |
| `GET` | `/api/v1/auth/me` | Current session user with hosted/joined counts |
| `POST` | `/api/v1/auth/logout` | Revoke the current session and clear the cookie |

## Host controls

Host authorization is enforced in the service layer against `Meeting.host_id`, so neither the frontend role nor any request body can grant host rights.

- End a meeting for everyone (host only)
- Mute or unmute a participant (host only; the host cannot be muted)
- Remove a participant (host only; the host cannot be removed)
- Removing marks the participant row with `removed_at` and drops their camera/mic state; removed participants cannot rejoin and are excluded from active participant lists
- Rejoining after a normal leave reactivates the existing row and clears stale mute state
- Removed participants and ended meetings are surfaced in the room UI with a clear next action

Mute and removal control the server's participant/media state. They do not silence a remote microphone by themselves, because no WebRTC peer connection or signaling channel exists yet.

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
| `GET` | `/users/me` | Current session user profile |
| `GET` | `/meetings` | Hosted/joined meeting list |
| `POST` | `/meetings` | Schedule a meeting alias |
| `POST` | `/meetings/schedule` | Schedule a meeting |
| `POST` | `/meetings/instant` | Create an instant live room |
| `GET` | `/meetings/{id-or-code}` | Public meeting details |
| `PATCH` | `/meetings/{id}` | Update a scheduled meeting |
| `POST` | `/meetings/{id}/start` | Host starts a scheduled meeting |
| `POST` | `/meetings/{id}/end` | Host ends a live meeting |
| `POST` | `/meetings/{id}/cancel` | Host cancels a meeting |
| `POST` | `/meetings/{id}/join` | Join a room (authenticated) |
| `POST` | `/meetings/{id}/leave` | Leave a room |
| `GET` | `/meetings/{id}/participants` | Active participant list |
| `PATCH` | `/meetings/{id}/participants/me/media` | Update own media state |
| `POST` | `/meetings/{id}/participants/{participant_id}/mute` | Host mutes or unmutes a participant |
| `DELETE` | `/meetings/{id}/participants/{participant_id}` | Host removes a participant |

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

### Frontend on Vercel, API on Render

1. Deploy the API from the `render.yaml` blueprint and note the service URL, for example `https://nexusmeet-api.onrender.com`. Render starts it with `alembic upgrade head` and keeps SQLite on a persistent disk.
2. Import the repository into Vercel and set the project root directory to `frontend`. Vercel detects Next.js; no build settings are required.
3. Add these frontend environment variables before deploying:

   | Variable | Value | Purpose |
   | --- | --- | --- |
   | `API_ORIGIN` | `https://<api-service>.onrender.com` | Enables the same-origin `/api/*` proxy in `next.config.mjs` |
   | `NEXT_PUBLIC_API_URL` | `/api/v1` | Makes the browser call only its own origin |

4. In the API service, set `CORS_ORIGINS` for direct API access and keep `ENVIRONMENT=production` so session cookies are issued with the `Secure` flag.

The proxy is deliberate. With the frontend on `*.vercel.app` and the API on `*.onrender.com` the origins are cross-site, so a `SameSite=Lax` session cookie would be dropped by the browser and every authenticated request would fail. Forwarding `/api/*` through Next.js keeps the cookie first-party, so authentication works in any browser without weakening cookie rules. Leave `API_ORIGIN` unset locally and the frontend calls `http://localhost:8000/api/v1` directly.

### All-in-Render alternative

`render.yaml` also contains a two-service Render blueprint for a small deployment:

- FastAPI on a persistent disk for SQLite, started with `alembic upgrade head`
- Next.js on a Node web service
- Environment values marked for dashboard configuration instead of committed secrets

Set the frontend build-time `NEXT_PUBLIC_API_URL` and backend `CORS_ORIGINS` to the actual deployed origins before building, and override `DEFAULT_USER_PASSWORD` in the dashboard. For more than one backend instance, replace SQLite with a shared database and move participant presence/media signaling to a shared realtime service.

## Known limitations

- Remote WebRTC audio/video is not implemented. The room intentionally shows local video and synchronized participant/media metadata; it does not fake remote video tiles.
- Host mute and removal are enforced as server-side participant state. Physically muting a remote microphone, and denying camera/mic permission, require a WebRTC signaling channel and permission policies that are out of scope here.
- There is no rate limiting, password reset, email verification, or multi-factor authentication; add them before public launch.
- SQLite is appropriate for local development and a single API instance, not high-concurrency production workloads.
- Scheduled-time transitions are evaluated when a join request arrives; a background worker can be added for automatic status changes and notifications.
- Session cleanup runs on login/registration rather than on a scheduler, so stale rows may linger until the next sign-in.

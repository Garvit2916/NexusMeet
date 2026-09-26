# NexusMeet

NexusMeet is a calm, full-stack meeting workspace built around instant rooms, scheduled meetings, shareable invite links, real email/password accounts, server-authorized host controls, and real peer-to-peer audio and video. The project is intentionally small enough to run locally while keeping clear seams for a production database and a multi-instance realtime tier.

## Live deployment

| | |
| --- | --- |
| App | **https://nexusmeet-theta.vercel.app** |
| API | **https://nexusmeet-api.onrender.com** |
| API docs (Swagger UI) | https://nexusmeet-api.onrender.com/docs |

Sign up with any email and password. The API is on Render's free plan, so it sleeps after inactivity (the first request can take 30-60 seconds) and its SQLite database is ephemeral, meaning accounts and meetings are recreated whenever the instance restarts.

Remote audio and video are live on the deployment above. Open the same meeting in two browsers, allow camera and microphone on both, and each side should show the other's live video tile with a `Media connected · 1 peer` status.

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
- Real peer-to-peer audio and video over a full WebRTC mesh, with live remote video tiles
- Short-lived HMAC-signed signaling tickets bound to a single meeting and minted only for active participants
- WebSocket signaling for SDP, ICE, media state, host mute/remove, and room lifecycle events
- Deterministic offer initiation, ICE buffering until the remote description arrives, and automatic reconnect with backoff
- Live signaling status, peer count, and per-peer connection state in the room UI
- Host mute that disables the guest's real microphone track, not just a UI flag
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
- **Realtime:** WebSocket signaling over a signed ticket, plus a full-mesh `RTCPeerConnection` for audio and video

## Repository layout

```text
backend/
  app/
    api/                 FastAPI routes and dependencies
    core/                Settings, security helpers, errors
    db/                  Database setup, migrations, seed data
    models/              SQLAlchemy entities
    realtime/            Signaling tickets, WebSocket router, room hub, message validation
    repositories/        Persistence boundaries
    schemas/             Pydantic request/response contracts
    services/            Business rules and transactions
    tests/               API, persistence, and signaling tests
  alembic/                Versioned schema migrations
frontend/
  app/                    Next.js App Router routes
  components/             Auth, dashboard, forms, room, and UI components
  hooks/                  Data loading, local media state, and the WebRTC mesh
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

Mute and removal are enforced as server-side participant state and are broadcast over the signaling channel. A host mute additionally disables the guest's real microphone track, and removing a participant drops their peer connections, so the effect is immediate rather than cosmetic.

## Real-time signaling

Audio and video never touch the server. The backend only brokers the handshake, then the browsers send media directly to each other in a full mesh.

### Connection flow

1. The client calls `POST /api/v1/meetings/{id}/ws-ticket` with its session cookie. The API verifies the caller is an active participant of a live meeting and returns a short-lived ticket plus the WebSocket URL and ICE servers.
2. The client opens `wss://<api-host>/ws/meetings/{id}?ticket=...`. The session cookie is not sent on that cross-origin socket, so the signed ticket is the credential.
3. The API verifies the ticket's HMAC, expiry, meeting binding, and origin, then re-checks the participant against the database. A client cannot claim another user, act as host, or reach a meeting it has not joined.
4. The server replies with a `welcome` message containing the current peer list, and each side negotiates one `RTCPeerConnection` per remote peer. The peer with the lower connection ID creates the offer, so both sides never offer at once.
5. Once connected, media flows browser to browser. The server relays signaling and state, not media.

### Signaling protocol

Every inbound message is schema-validated, and an unknown type is rejected with an `error` frame instead of being forwarded.

| Direction | Message | Purpose |
| --- | --- | --- |
| Client to server | `join` | Announce presence after the handshake |
| Client to server | `offer` / `answer` | SDP for one peer |
| Client to server | `ice-candidate` | ICE candidate for one peer |
| Client to server | `media-state` | Publish local camera and microphone state |
| Client to server | `leave` | Leave cleanly |
| Client to server | `ping` | Keepalive |
| Server to client | `welcome` | Self identity plus the current peer list |
| Server to client | `peer-joined` / `peer-left` | Mesh membership changes |
| Server to client | `media-state` | Relayed camera and microphone state |
| Server to client | `ping` / `pong` | Keepalive |
| Server to client | `error` | Rejected message with a machine-readable code |

Host mute, removal, and end-meeting are ordinary authenticated REST calls listed in the API surface. Their effect reaches other browsers through the signaling channel as relayed media state, which is why a host mute actually disables the guest's microphone track.

### Security properties

- Tickets are HMAC-SHA256 signed with `WS_TICKET_SECRET`, expire after `WS_TICKET_TTL_SECONDS` (120 by default), and are bound to one meeting and one user.
- Every inbound message is schema-validated before it reaches the hub.
- The handshake `Origin` must appear in `CORS_ORIGINS`, so a ticket that leaks out of band cannot be replayed by an unrelated page.
- In production the API refuses to mint tickets while `WS_TICKET_SECRET` is still the published development value.
- Refused handshakes close before `accept()`, so they never become WebSocket sessions.

### Scaling

The hub keeps rooms in process memory, which suits a single API instance. To run more than one instance, move signaling to a shared pub/sub backend (Redis, Postgres `LISTEN/NOTIFY`, or a managed realtime service) and replace SQLite with a shared database.

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
| `POST` | `/meetings/{id}/ws-ticket` | Mint a short-lived signaling ticket for the WebSocket |

One endpoint is not REST: the signaling socket is `GET /ws/meetings/{id}?ticket=...` as a WebSocket upgrade at the API root, outside the `/api/v1` prefix, because browsers cannot send an authenticated `POST` to a WebSocket handshake.

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

WebRTC cannot be covered by unit tests alone, because the interesting failures live in the browser. Verify signaling and media with two real browser contexts:

1. Start the backend and frontend as described under **Run locally**, then sign in as two different users (a private window for the second one).
2. Have the first user create an instant meeting and open the room link in both browsers.
3. Allow camera and microphone in both, press **Check devices**, then **Join meeting**.
4. Confirm each side shows the other's live video tile and a `Media connected · 1 peer` status.
5. Toggle camera and microphone on one side and watch the remote tile update, then exercise the host controls in the participants panel.
6. In the browser network panel, confirm `POST /api/v1/meetings/{id}/ws-ticket` returns `200` and the `wss://` request to `/ws/meetings/{id}` returns `101`. Anything else is the first thing to check, per **Deployment**.

Two useful signals when a deployed room shows a media error with zero peers: a `404` on `ws-ticket` means the API build predates the signaling route, and a `400` on the CORS preflight means the app origin is missing from `CORS_ORIGINS`. A refused WebSocket handshake returns `403` with an empty body, because the API closes the socket before accepting it.

## Deployment

### Frontend on Vercel, API on Render

1. Deploy the API from the `render.yaml` blueprint and note the service URL, for example `https://nexusmeet-api.onrender.com`. Render starts it with `alembic upgrade head` and runs it as a Docker image; on the free plan SQLite lives in `/tmp` and is therefore ephemeral (see the plan notes below).
2. Import the repository into Vercel and set the project root directory to `frontend`. Vercel detects Next.js; no build settings are required.
3. Add these frontend environment variables before deploying:

   | Variable | Value | Purpose |
   | --- | --- | --- |
   | `API_ORIGIN` | `https://<api-service>.onrender.com` | Enables the same-origin `/api/*` proxy in `next.config.mjs` |
   | `NEXT_PUBLIC_API_URL` | `/api/v1` | Makes the browser call only its own origin |

4. In the API service, set the signaling variables below and keep `ENVIRONMENT=production` so session cookies are issued with the `Secure` flag.

   | Variable | Value | Purpose |
   | --- | --- | --- |
   | `CORS_ORIGINS` | `https://<app>.vercel.app` | Required for the WebSocket handshake origin check |
   | `WS_TICKET_SECRET` | long random string | Signs signaling tickets; never reuse the development value |
   | `PUBLIC_WS_URL` | `wss://<api-service>.onrender.com` | Absolute socket URL handed to the browser |
   | `STUN_URLS` | comma-separated STUN URLs | ICE servers advertised to clients |
   | `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | relay credentials | Needed only when peers sit behind restrictive NAT |

The proxy is deliberate. With the frontend on `*.vercel.app` and the API on `*.onrender.com` the origins are cross-site, so a `SameSite=Lax` session cookie would be dropped by the browser and every authenticated request would fail. Forwarding `/api/*` through Next.js keeps the cookie first-party, so authentication works in any browser without weakening cookie rules. Leave `API_ORIGIN` unset locally and the frontend calls `http://localhost:8000/api/v1` directly.

The Vercel rewrite covers REST only. The WebSocket connects straight to `PUBLIC_WS_URL` on the API host, so that host must terminate WebSocket upgrades and its URL must be listed in `CORS_ORIGINS`. Two deployment mistakes are worth calling out because they look identical in the browser: a build without the signaling route returns `404` on `ws-ticket`, and a missing CORS entry returns `400` on the CORS preflight. Both surface in the room as a media error with zero peers, because no socket is ever opened.

### All-in-Render alternative

`render.yaml` defines the API service only, because the frontend runs on Vercel:

- FastAPI started with `alembic upgrade head`, which builds the schema on boot
- Environment values marked for dashboard configuration instead of committed secrets
- `plan: free` with SQLite in `/tmp`, so the database is **ephemeral**: free instances also sleep after inactivity and take roughly 30-60 seconds to wake. Meetings, participants, and sessions created during a demo are lost whenever the instance restarts, and `SEED_SAMPLE_DATA` recreates the demo account on the next boot. Switch the service to the `starter` plan and re-add the commented `disk` block (`sqlite:////data/nexusmeet.db`) when the data must survive restarts.
- Set `DEFAULT_USER_PASSWORD` in the dashboard. The seeded demo login is public knowledge, so change it before exposing the deployment.

For more than one backend instance, replace SQLite with a shared database and move participant presence/media signaling to a shared realtime service.

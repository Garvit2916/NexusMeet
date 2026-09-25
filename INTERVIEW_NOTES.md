# NexusMeet Interview Notes

## Product story

NexusMeet gives a team a single, low-friction place to create a room, share an invite, check local devices, and enter a conversation. The interface uses a calm mint/coral visual system, clear status language, and responsive layouts rather than reproducing an existing product.

## Architecture decisions

### Frontend

Next.js App Router keeps the route structure visible and makes meeting links shareable:

- `/dashboard` for the workspace overview
- `/schedule` for planned meetings
- `/join` for code/link entry
- `/meeting/[meetingId]` for public details
- `/meeting/[meetingId]/room` for pre-join and room state

The frontend does not call `fetch` from page components. `services/api.ts` owns the API base URL, request timeout, credentialed cookie handling, envelope unwrapping, and typed errors. `services/auth-service.ts` and `services/meeting-service.ts` own translation from backend DTOs to UI models. This keeps UI components focused on interaction and makes a future token-based adapter replaceable.

### Backend

The backend is organized into routes, services, repositories, and models:

- Routes validate HTTP input and choose response status codes.
- Services own meeting lifecycle rules, status transitions, host authorization, participant sessions, and transactions.
- Repositories isolate SQLAlchemy queries.
- Pydantic schemas define both canonical snake_case fields and compatibility aliases used by the frontend.

Meeting identifiers are random, non-sequential `mtg_<32 hex>` values. Short codes are derived from the identifier, so the same meeting can be shared as a long link or an `NM-XXXXXXXX` code.

### Persistence

SQLite keeps local setup dependency-free. Alembic has an initial schema migration and a follow-up migration for duration, timezone, and participant display names. The startup initializer also adds compatibility columns for older development databases, while Alembic remains the controlled production migration path.

### Identity and security boundary

Authentication is a real credential flow, not a development header:

- Passwords are hashed with Argon2id. The raw password is never stored, logged, or returned.
- Login or registration issues a random `nxs_`-prefixed token in an HTTP-only, `SameSite` session cookie. Only a SHA-256 hash of the token is persisted in `sessions`, so a database leak cannot be replayed as a live session.
- Logout revokes the server-side row, so deleting the cookie is not the only protection. Expired rows are purged on authentication.
- Every authenticated request resolves its user from the session. `X-User-ID` forwarding and guest identities were removed, so a client cannot claim to be another user.
- Public meeting details and invite links stay readable without an account, while creating, joining, and room actions require a session.
- Host rights are read from `Meeting.host_id` on the server. The frontend never sends a role, and mute/remove/end requests from a non-host are rejected with `403` before any state changes.

Remaining gaps are deliberate and documented: no password reset, email verification, MFA, or rate limiting.

## Meeting lifecycle

1. Host creates an instant meeting or schedules one for a future time.
2. Instant meetings are created as `live`; scheduled meetings are `scheduled` with no active host participant yet.
3. A host may join early and start a scheduled meeting.
4. At or after the scheduled time, the first attendee join transitions the meeting to `live`.
5. Join creates or reactivates a participant session, associates a display name, and commits atomically. Removed participants are rejected with `403` and cannot rejoin.
6. Media controls update the current participant row through `PATCH /participants/me/media`.
7. Leave marks the participant inactive; ending or cancelling marks all active participants inactive.
8. Reopening the same room uses the same user/participant record and resets media state on reactivation.
9. The host can mute or unmute a participant and remove them; the host row itself is protected from both actions.

## Trade-offs

- Local media is fully implemented, but remote WebRTC is not. A fake remote tile would make the demo look complete while hiding a critical networking requirement.
- Host mute and removal are enforced as server-side participant state, so a participant cannot bypass the host UI. Physically muting a remote microphone still requires a signaling channel, which is why the limitation is documented instead of implied.
- Polling participant details every ten seconds keeps the implementation simple and makes state visible after join/leave. A production room should use WebSocket or WebRTC signaling with a presence TTL.
- The service layer is synchronous because the API contract is simple and SQLite is local-first. Async database support can be introduced without changing route contracts.
- The API issues cookie sessions instead of returning tokens to JavaScript, so the frontend has nothing to store or leak in `localStorage`. The cost is that CORS must enumerate exact origins.

## Demo script

1. Start the backend and frontend with the commands in `README.md`.
2. Sign in with the seeded account `demo@nexusmeet.app` / `demo12345`, or register a new account from `/register`.
3. Open the dashboard and use **Start meeting** to create an instant room.
4. Open the invite in a second browser or private window, sign in as a second account, and join.
5. Toggle camera and microphone in both windows; participant state is persisted and visible in the panel.
6. As the host, open the participant panel, mute the participant, then remove them; the removed participant sees a notice in their room.
7. As the host, use **End for all**, confirm the dialog, and observe the meeting close for both windows.
8. Sign out and confirm `/dashboard` redirects to `/login`.
9. Create a scheduled meeting, copy its invite, and inspect the meeting details and calendar download.
10. Join after the scheduled time to see the automatic live transition.
11. Run the backend and frontend verification commands listed in the README.

## Production follow-ups

- Replace SQLite with PostgreSQL and run Alembic migrations during deployment.
- Add password reset, email verification, MFA, and rate limiting on authentication endpoints.
- Add WebRTC signaling, TURN configuration, reconnect behavior, and moderation controls.
- Move notifications and invitations to a background job system.
- Add rate limits, structured logging, metrics, tracing, and audit events.
- Add browser-level Playwright coverage for permissions and multi-participant sessions.

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

The frontend does not call `fetch` from page components. `services/api.ts` owns the API base URL, timeout, envelope unwrapping, `X-User-ID` forwarding, and typed errors. `services/meeting-service.ts` owns translation from backend DTOs to UI models. This keeps UI components focused on interaction and makes a future auth adapter replaceable.

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

`UserIdentityProvider` is a protocol with a `DefaultUserIdentityProvider` implementation. Development requests without a current-user header use the seeded default user for protected operations. Public reads are anonymous, and an explicit unknown identity can become a guest only when a display name is supplied to the join endpoint.

This is deliberately not presented as production authentication. A real deployment should replace the provider with verified session or JWT claims, enforce meeting access policy server-side, and remove the demo identity behavior.

## Meeting lifecycle

1. Host creates an instant meeting or schedules one for a future time.
2. Instant meetings are created as `live`; scheduled meetings are `scheduled` with no active host participant yet.
3. A host may join early and start a scheduled meeting.
4. At or after the scheduled time, the first attendee join transitions the meeting to `live`.
5. Join creates or reactivates a participant session, associates a display name, and commits atomically.
6. Media controls update the current participant row through `PATCH /participants/me/media`.
7. Leave marks the participant inactive; ending or cancelling marks all active participants inactive.
8. Reopening the same room uses the same user/participant record and resets media state on reactivation.

## Trade-offs

- Local media is fully implemented, but remote WebRTC is not. A fake remote tile would make the demo look complete while hiding a critical networking requirement.
- Polling participant details every ten seconds keeps the implementation simple and makes state visible after join/leave. A production room should use WebSocket or WebRTC signaling with a presence TTL.
- The service layer is synchronous because the API contract is simple and SQLite is local-first. Async database support can be introduced without changing route contracts.
- The frontend uses a development fallback identity to keep the first-run experience usable. The error state makes a missing backend visible instead of silently presenting seeded data as live data.

## Demo script

1. Start the backend and frontend with the commands in `README.md`.
2. Open the dashboard and use **Create room** to create an instant room.
3. Open the invite in a second browser or private window, enter a display name, and join.
4. Toggle camera and microphone in both windows; participant state is persisted and visible in the panel.
5. Leave the second window and observe the participant count change.
6. Create a scheduled meeting, copy its invite, and inspect the meeting details and calendar download.
7. Join after the scheduled time to see the automatic live transition.
8. Run the backend and frontend verification commands listed in the README.

## Production follow-ups

- Replace SQLite with PostgreSQL and run Alembic migrations during deployment.
- Add real authentication and authorization policies for private meetings.
- Add WebRTC signaling, TURN configuration, reconnect behavior, and moderation controls.
- Move notifications and invitations to a background job system.
- Add rate limits, structured logging, metrics, tracing, and audit events.
- Add browser-level Playwright coverage for permissions and multi-participant sessions.

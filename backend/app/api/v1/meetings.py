from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Path, Query, Request, status

from app.api.dependencies import (
    get_current_user,
    get_meeting_service,
    get_optional_current_user,
    get_settings,
    require_meeting_host,
)
from app.core.config import Settings
from app.core.errors import AppError
from app.models.enums import MeetingStatus
from app.models.user import User
from app.realtime.dispatch import dispatch_to_signaling
from app.realtime.hub import hub
from app.realtime.tickets import ice_servers, issue_ticket, resolve_ws_url
from app.schemas.common import SuccessEnvelope
from app.schemas.meeting import (
    CreateInstantMeetingRequest,
    MeetingDetails,
    MeetingList,
    ScheduleMeetingRequest,
    UpdateMeetingRequest,
)
from app.schemas.participant import (
    HostMuteUpdate,
    JoinMeetingRequest,
    MediaStateUpdate,
    ParticipantResponse,
)
from app.schemas.signaling import SignalingTicketResponse
from app.services.meeting_service import MeetingService
from app.utils.ids import (
    MEETING_ID_MAX_LENGTH,
    MEETING_IDENTIFIER_MIN_LENGTH,
    MEETING_IDENTIFIER_PATTERN,
)
from app.utils.time import utc_now

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meetings", tags=["meetings"])
MeetingId = Annotated[
    str,
    Path(
        min_length=MEETING_IDENTIFIER_MIN_LENGTH,
        max_length=MEETING_ID_MAX_LENGTH,
        pattern=MEETING_IDENTIFIER_PATTERN,
    ),
]
ParticipantId = Annotated[int, Path(ge=1)]


@router.post(
    "/schedule",
    response_model=SuccessEnvelope[MeetingDetails],
    status_code=status.HTTP_201_CREATED,
)
def schedule_meeting(
    payload: ScheduleMeetingRequest,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.schedule(current_user, payload))


@router.post(
    "/instant",
    response_model=SuccessEnvelope[MeetingDetails],
    status_code=status.HTTP_201_CREATED,
)
def create_instant_meeting(
    payload: CreateInstantMeetingRequest,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.create_instant(current_user, payload))


@router.post(
    "",
    response_model=SuccessEnvelope[MeetingDetails],
    status_code=status.HTTP_201_CREATED,
)
def create_scheduled_meeting(
    payload: ScheduleMeetingRequest,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.schedule(current_user, payload))


@router.get("", response_model=SuccessEnvelope[MeetingList])
def list_meetings(
    scope: str = Query("all", pattern="^(all|hosted|joined)$"),
    meeting_status: MeetingStatus | None = Query(default=None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingList]:
    meeting_list, page = service.list_meetings(
        current_user,
        scope=scope,
        status=meeting_status,
        limit=limit,
        offset=offset,
    )
    return SuccessEnvelope(
        data=meeting_list,
        meta={"total": page.total, "limit": page.limit, "offset": page.offset},
    )


@router.get("/{meeting_id}", response_model=SuccessEnvelope[MeetingDetails])
def get_meeting(
    meeting_id: MeetingId,
    current_user: User | None = Depends(get_optional_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.get(meeting_id, current_user))


@router.patch("/{meeting_id}", response_model=SuccessEnvelope[MeetingDetails])
def update_meeting(
    meeting_id: MeetingId,
    payload: UpdateMeetingRequest,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.update(meeting_id, current_user, payload))


@router.post(
    "/{meeting_id}/ws-ticket",
    response_model=SuccessEnvelope[SignalingTicketResponse],
)
def create_signaling_ticket(
    request: Request,
    meeting_id: MeetingId,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
    settings: Settings = Depends(get_settings),
) -> SuccessEnvelope[SignalingTicketResponse]:
    """Trade the authenticated session for a short-lived signaling credential.

    The browser cannot send its first-party session cookie on a cross-origin
    WebSocket handshake, so it presents this signed ticket instead. The ticket is
    bound to this user and this meeting and expires in minutes.
    """
    meeting, participant = service.require_access(meeting_id, current_user.id)
    if meeting.status is not MeetingStatus.LIVE:
        raise AppError(
            409,
            "INVALID_STATUS_TRANSITION",
            "This meeting is not live",
            {"current_status": meeting.status.value},
        )
    # Removal is checked before the left_at bookkeeping because the host's
    # removal sets both, and "removed by the host" is the actionable reason.
    if participant is not None and participant.removed_at is not None:
        raise AppError(
            403,
            "PARTICIPANT_REMOVED",
            "You were removed from this meeting by the host",
        )
    if participant is None or participant.joined_at is None or participant.left_at is not None:
        raise AppError(
            403,
            "NOT_ACTIVE_PARTICIPANT",
            "Join the meeting before connecting to its media channel",
        )
    # Fail closed on the insecure path. Tickets are the only thing authorizing a
    # socket, so signing them with a published development key would let anyone
    # forge a ticket for any meeting. Refusing here keeps the rest of the API up
    # while making the misconfiguration impossible to miss.
    if settings.is_production and settings.uses_development_ws_secret:
        logger.error(
            "Refusing to issue a signaling ticket: WS_TICKET_SECRET is still the "
            "development default in a production environment"
        )
        raise AppError(
            503,
            "SIGNALING_NOT_CONFIGURED",
            "Media is not available because the server is missing its signaling secret",
        )

    ticket, expires_at = issue_ticket(
        settings, user_id=current_user.id, meeting_id=meeting.id
    )
    ttl = max(expires_at - int(utc_now().timestamp()), 0)
    return SuccessEnvelope(
        data=SignalingTicketResponse(
            ticket=ticket,
            ws_url=resolve_ws_url(settings, request, meeting_id=meeting.id),
            expires_in=ttl,
            ice_servers=ice_servers(settings),
            max_participants=settings.max_webrtc_participants,
        )
    )


@router.post("/{meeting_id}/start", response_model=SuccessEnvelope[MeetingDetails])
def start_meeting(
    meeting_id: MeetingId,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.start(meeting_id, current_user))


@router.post("/{meeting_id}/end", response_model=SuccessEnvelope[MeetingDetails])
def end_meeting(
    request: Request,
    meeting_id: MeetingId,
    current_user: User = Depends(require_meeting_host),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    details = SuccessEnvelope(data=service.end(meeting_id, current_user))
    # The REST response already carries the ended status; the broadcast exists so
    # each client stops its tracks and leaves the room without polling.
    dispatch_to_signaling(
        request, hub.notify_and_close(meeting_id, {"type": "meeting-ended"})
    )
    return details


@router.post("/{meeting_id}/cancel", response_model=SuccessEnvelope[MeetingDetails])
def cancel_meeting(
    request: Request,
    meeting_id: MeetingId,
    current_user: User = Depends(require_meeting_host),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    details = SuccessEnvelope(data=service.cancel(meeting_id, current_user))
    dispatch_to_signaling(
        request, hub.notify_and_close(meeting_id, {"type": "meeting-ended"})
    )
    return details



@router.post("/{meeting_id}/join", response_model=SuccessEnvelope[MeetingDetails])
def join_meeting(
    meeting_id: MeetingId,
    payload: JoinMeetingRequest | None = Body(default=None),
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.join(meeting_id, current_user, payload))


@router.post("/{meeting_id}/leave", response_model=SuccessEnvelope[MeetingDetails])
def leave_meeting(
    meeting_id: MeetingId,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.leave(meeting_id, current_user))


@router.get(
    "/{meeting_id}/participants",
    response_model=SuccessEnvelope[list[ParticipantResponse]],
)
def list_participants(
    meeting_id: MeetingId,
    current_user: User | None = Depends(get_optional_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[list[ParticipantResponse]]:
    return SuccessEnvelope(data=service.get_participants(meeting_id, current_user))


@router.patch(
    "/{meeting_id}/participants/me/media",
    response_model=SuccessEnvelope[ParticipantResponse],
)
def update_media_state(
    meeting_id: MeetingId,
    payload: MediaStateUpdate,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[ParticipantResponse]:
    return SuccessEnvelope(data=service.update_media_state(meeting_id, current_user, payload))


@router.post(
    "/{meeting_id}/participants/{participant_id}/mute",
    response_model=SuccessEnvelope[ParticipantResponse],
)
def set_participant_mute(
    request: Request,
    meeting_id: MeetingId,
    participant_id: ParticipantId,
    payload: HostMuteUpdate | None = Body(default=None),
    current_user: User = Depends(require_meeting_host),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[ParticipantResponse]:
    muted = payload.muted if payload is not None else True
    participant = service.mute_participant(
        meeting_id, current_user, participant_id, muted=muted
    )
    # The database is authoritative, but the target's socket has to disable the
    # real audio track right away, so the state is pushed over signaling too.
    dispatch_to_signaling(
        request,
        hub.send_to_user(
            meeting_id,
            participant.user_id,
            {"type": "host-mute", "muted": muted, "by": current_user.id},
        ),
    )
    return SuccessEnvelope(data=participant)


@router.delete(
    "/{meeting_id}/participants/{participant_id}",
    response_model=SuccessEnvelope[ParticipantResponse],
)
def remove_participant(
    request: Request,
    meeting_id: MeetingId,
    participant_id: ParticipantId,
    current_user: User = Depends(require_meeting_host),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[ParticipantResponse]:
    participant = service.remove_participant(meeting_id, current_user, participant_id)
    # Closing the socket makes removal final on the media layer: the client tears
    # down its peer connections, stops its tracks, and cannot rejoin the socket.
    dispatch_to_signaling(
        request,
        hub.send_to_user(
            meeting_id, participant.user_id, {"type": "participant-removed"}
        ),
    )
    dispatch_to_signaling(
        request, hub.disconnect_user(meeting_id, participant.user_id)
    )
    return SuccessEnvelope(data=participant)

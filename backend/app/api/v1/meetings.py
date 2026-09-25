from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Depends, Path, Query, status

from app.api.dependencies import (
    get_current_user,
    get_meeting_service,
    get_optional_current_user,
    require_meeting_host,
)
from app.models.enums import MeetingStatus
from app.models.user import User
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
from app.services.meeting_service import MeetingService
from app.utils.ids import (
    MEETING_ID_MAX_LENGTH,
    MEETING_IDENTIFIER_MIN_LENGTH,
    MEETING_IDENTIFIER_PATTERN,
)

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


@router.post("/{meeting_id}/start", response_model=SuccessEnvelope[MeetingDetails])
def start_meeting(
    meeting_id: MeetingId,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.start(meeting_id, current_user))


@router.post("/{meeting_id}/end", response_model=SuccessEnvelope[MeetingDetails])
def end_meeting(
    meeting_id: MeetingId,
    current_user: User = Depends(require_meeting_host),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.end(meeting_id, current_user))


@router.post("/{meeting_id}/cancel", response_model=SuccessEnvelope[MeetingDetails])
def cancel_meeting(
    meeting_id: MeetingId,
    current_user: User = Depends(get_current_user),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[MeetingDetails]:
    return SuccessEnvelope(data=service.cancel(meeting_id, current_user))


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
    meeting_id: MeetingId,
    participant_id: ParticipantId,
    payload: HostMuteUpdate | None = Body(default=None),
    current_user: User = Depends(require_meeting_host),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[ParticipantResponse]:
    muted = payload.muted if payload is not None else True
    return SuccessEnvelope(
        data=service.mute_participant(meeting_id, current_user, participant_id, muted=muted)
    )


@router.delete(
    "/{meeting_id}/participants/{participant_id}",
    response_model=SuccessEnvelope[ParticipantResponse],
)
def remove_participant(
    meeting_id: MeetingId,
    participant_id: ParticipantId,
    current_user: User = Depends(require_meeting_host),
    service: MeetingService = Depends(get_meeting_service),
) -> SuccessEnvelope[ParticipantResponse]:
    return SuccessEnvelope(
        data=service.remove_participant(meeting_id, current_user, participant_id)
    )

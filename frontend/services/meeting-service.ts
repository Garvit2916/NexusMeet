import type { ApiMeeting, ApiMeetingList, ApiParticipant } from "@/lib/api-types";
import { apiRequest, ApiError } from "./api";
import { normalizeUser } from "@/services/auth-service";
import type { CreateMeetingInput, Meeting, MeetingListResponse, MeetingStatus, Participant } from "@/lib/types";

function initialsFor(name: string) {
  const pieces = name.split(" ").filter(Boolean);
  if (!pieces.length) return "?";
  if (pieces.length === 1) return pieces[0].slice(0, 2).toUpperCase();
  return `${pieces[0][0]}${pieces.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function normalizeParticipant(raw: ApiParticipant): Participant {
  const name = raw.display_name?.trim() || raw.name?.trim() || raw.user.name.trim() || "Guest";
  const role = raw.role === "host" || raw.role === "presenter" ? raw.role : "attendee";
  const isRemoved = raw.is_removed ?? Boolean(raw.removed_at);
  const isMuted = raw.is_muted ?? false;
  return {
    id: String(raw.id),
    userId: raw.user_id || raw.user.id,
    name,
    email: raw.email || raw.user.email,
    initials: raw.initials || initialsFor(name),
    role,
    isOnline: (raw.is_online ?? Boolean(raw.joined_at && !raw.left_at)) && !isRemoved,
    isMuted,
    mutedByHost: raw.muted_by_host ?? (isMuted && raw.audio_enabled === false),
    isRemoved,
    audioEnabled: raw.audio_enabled ?? true,
    videoEnabled: raw.video_enabled ?? true,
    screenSharing: raw.screen_sharing ?? false,
    joinedAt: raw.joined_at ?? undefined,
    avatarUrl: raw.avatar_url ?? raw.user.avatar_url ?? raw.user.avatarUrl ?? undefined,
  };
}

function statusFromApi(status: string | undefined): MeetingStatus {
  switch (status) {
    case "live":
      return "live";
    case "ended":
      return "ended";
    case "cancelled":
      return "cancelled";
    default:
      return "upcoming";
  }
}

function normalizeMeeting(raw: ApiMeeting): Meeting {
  const start = raw.start_time || raw.scheduled_at || raw.started_at || raw.created_at;
  const duration = raw.duration_minutes ?? raw.duration ?? 30;
  const end = raw.end_time || new Date(new Date(start).getTime() + duration * 60000).toISOString();
  const publicId = raw.public_id || raw.meeting_id || raw.id;
  const meetingCode = raw.meeting_code || `NM-${raw.id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}`;
  const joinUrl = raw.join_url || raw.invite_url || raw.invite_link || raw.meeting_link || `/meeting/${publicId}`;
  return {
    id: publicId,
    title: raw.title,
    description: raw.description || "",
    startTime: start,
    endTime: end,
    timezone: raw.timezone || "UTC",
    status: statusFromApi(raw.display_status || raw.status),
    meetingCode,
    joinUrl,
    roomId: raw.room_id || `room-${publicId}`,
    host: normalizeUser(raw.host, "host"),
    participants: (raw.participants || []).map(normalizeParticipant),
    createdAt: raw.created_at,
  };
}

function normalizeMeetingList(raw: ApiMeetingList): MeetingListResponse {
  const meetings = raw.items || raw.meetings || [];
  return { meetings: meetings.map(normalizeMeeting), total: raw.total ?? meetings.length };
}

export const meetingService = {
  async listMeetings(): Promise<MeetingListResponse> {
    const response = await apiRequest<ApiMeetingList>("/meetings?scope=hosted&limit=100");
    return normalizeMeetingList(response);
  },

  async getMeeting(meetingId: string): Promise<Meeting | null> {
    try {
      return normalizeMeeting(await apiRequest<ApiMeeting>(`/meetings/${encodeURIComponent(meetingId)}`));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  async createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      throw new ApiError("Choose a valid meeting duration.");
    }
    const raw = await apiRequest<ApiMeeting>("/meetings", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        scheduled_at: start.toISOString(),
        duration_minutes: durationMinutes,
        timezone: input.timezone,
        invite_emails: input.inviteEmails,
      }),
    });
    return normalizeMeeting(raw);
  },

  async createInstantMeeting(title = "Instant meeting"): Promise<Meeting> {
    const raw = await apiRequest<ApiMeeting>("/meetings/instant", {
      method: "POST",
      body: JSON.stringify({ title, duration_minutes: 60 }),
    });
    return normalizeMeeting(raw);
  },

  async joinMeeting(meetingId: string, displayName: string): Promise<Meeting> {
    const raw = await apiRequest<ApiMeeting>(`/meetings/${encodeURIComponent(meetingId)}/join`, {
      method: "POST",
      body: JSON.stringify({ display_name: displayName }),
    });
    return normalizeMeeting(raw);
  },

  async leaveMeeting(meetingId: string): Promise<Meeting> {
    const raw = await apiRequest<ApiMeeting>(`/meetings/${encodeURIComponent(meetingId)}/leave`, {
      method: "POST",
    });
    return normalizeMeeting(raw);
  },

  async updateMediaState(
    meetingId: string,
    state: { audio_enabled?: boolean; video_enabled?: boolean; screen_sharing?: boolean },
  ): Promise<void> {
    await apiRequest(`/meetings/${encodeURIComponent(meetingId)}/participants/me/media`, {
      method: "PATCH",
      body: JSON.stringify(state),
    });
  },

  async setParticipantMute(meetingId: string, participantId: string, muted: boolean): Promise<Participant> {
    const raw = await apiRequest<ApiParticipant>(
      `/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}/mute`,
      {
        method: "POST",
        body: JSON.stringify({ muted }),
      },
    );
    return normalizeParticipant(raw);
  },

  async removeParticipant(meetingId: string, participantId: string): Promise<Participant> {
    const raw = await apiRequest<ApiParticipant>(
      `/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}`,
      { method: "DELETE" },
    );
    return normalizeParticipant(raw);
  },

  async endMeeting(meetingId: string): Promise<Meeting> {
    const raw = await apiRequest<ApiMeeting>(`/meetings/${encodeURIComponent(meetingId)}/end`, {
      method: "POST",
    });
    return normalizeMeeting(raw);
  },
};

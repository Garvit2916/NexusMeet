export type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  meta?: Record<string, unknown> | null;
};

export type ApiUser = {
  id: string;
  name: string;
  email: string;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  created_at?: string;
  updated_at?: string;
  initials?: string;
  role?: "host" | "presenter" | "attendee";
};

export type ApiParticipant = {
  id: number | string;
  user: ApiUser;
  user_id?: string;
  name?: string;
  display_name?: string;
  email?: string;
  avatar_url?: string | null;
  initials?: string;
  role?: "host" | "presenter" | "attendee";
  is_host?: boolean;
  is_online?: boolean;
  is_active?: boolean;
  is_muted?: boolean;
  muted_by_host?: boolean;
  is_removed?: boolean;
  joined_at?: string | null;
  left_at?: string | null;
  removed_at?: string | null;
  audio_enabled?: boolean;
  video_enabled?: boolean;
  screen_sharing?: boolean;
};

export type ApiMeeting = {
  id: string;
  meeting_id?: string;
  public_id?: string;
  meeting_code?: string;
  host_id: string;
  host: ApiUser;
  title: string;
  description?: string | null;
  duration_minutes?: number;
  duration?: number;
  timezone?: string | null;
  scheduled_at?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  status: string;
  display_status?: string;
  is_instant?: boolean;
  started_at?: string | null;
  ended_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at?: string;
  invite_link?: string | null;
  invite_url?: string | null;
  join_url?: string | null;
  meeting_link?: string | null;
  room_id?: string | null;
  participants?: ApiParticipant[];
  participant_count?: number;
};

export type ApiMeetingList = {
  items?: ApiMeeting[];
  meetings?: ApiMeeting[];
  total?: number;
};

export type ApiSignalingTicket = {
  ticket: string;
  ws_url: string;
  expires_in: number;
  ice_servers?: RTCIceServer[] | null;
  max_participants: number;
};

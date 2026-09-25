export type UserRole = "host" | "presenter" | "attendee";

export type User = {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: UserRole;
  avatarUrl?: string;
  timezone?: string;
};

export type Participant = {
  id: string;
  userId: string;
  name: string;
  email: string;
  initials: string;
  role: UserRole;
  isOnline: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  joinedAt?: string;
  avatarUrl?: string;
};

export type MeetingStatus = "upcoming" | "live" | "ended" | "cancelled";

export type Meeting = {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: MeetingStatus;
  meetingCode: string;
  joinUrl: string;
  roomId: string;
  host: User;
  participants: Participant[];
  createdAt: string;
};

export type CreateMeetingInput = {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  timezone: string;
  inviteEmails: string[];
};

export type MeetingListResponse = {
  meetings: Meeting[];
  total: number;
};

export type ApiErrorShape = {
  message: string;
  status?: number;
  code?: string;
  details?: unknown;
};

export type AsyncStatus = "idle" | "loading" | "success" | "error";

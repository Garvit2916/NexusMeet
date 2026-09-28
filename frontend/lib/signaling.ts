/**
 * Types and pure helpers for the WebRTC signaling layer.
 *
 * Media never travels through these messages: the socket only carries SDP, ICE
 * candidates, and media state so peers can attach directly to each other.
 */

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type SignalingTicket = {
  ticket: string;
  wsUrl: string;
  expiresIn: number;
  iceServers: IceServer[];
  maxParticipants: number;
};

/** A peer as described by the signaling server, before any media flows. */
export type SignalingPeer = {
  connectionId: string;
  userId: string;
  participantId: number;
  name: string;
  isHost: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
};

export type SignalingStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "failed";

/** A remote participant with the live media the browser negotiated for it. */
export type RemoteParticipant = SignalingPeer & {
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  /**
   * `iceConnectionState` is what separates "still trying" from "gave up", and
   * the two need different messages. `connectionState` alone reports "new" and
   * "connecting" for the entire life of a connection that will never work.
   */
  iceConnectionState?: RTCIceConnectionState;
  /**
   * A `MediaStream` is a truthy object even when empty, so the UI must be told
   * explicitly whether media actually arrived. Optional because a stream can
   * also be synthesised before any peer connection exists.
   */
  hasVideoTrack?: boolean;
  hasAudioTrack?: boolean;
};

/**
 * What the tile should claim about a remote participant.
 *
 * The old logic asked only "does a stream object exist?", which is always true
 * for a peer that has been created but has not delivered media, so a peer that
 * could never connect rendered as a black rectangle. These four states are the
 * honest options, and they are derived from real ICE and track state.
 */
export type RemoteMediaState = "live" | "connecting" | "camera-off" | "failed";

export function remoteMediaState(participant: RemoteParticipant | undefined): RemoteMediaState {
  if (!participant) return "connecting";
  // A peer reporting its camera off is authoritative even when a track is still
  // attached: turning a camera off disables the track, it does not stop it, so
  // checking for a track first would keep claiming live video.
  if (!participant.videoEnabled) return "camera-off";
  if (participant.hasVideoTrack) return "live";
  const iceState = participant.iceConnectionState;
  const connectionState = participant.connectionState;
  if (
    iceState === "failed" ||
    iceState === "closed" ||
    connectionState === "failed" ||
    connectionState === "closed"
  ) {
    return "failed";
  }
  return "connecting";
}

export type MediaStateUpdate = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
};

/** Longest message the server will store, mirrored so the UI can refuse early. */
export const CHAT_MAX_LENGTH = 1000;

/**
 * One chat message, exactly as the server sends it.
 *
 * `id` is assigned server-side, so it is also the deduplication key: the sender
 * receives its own message back through the same broadcast as everyone else
 * rather than optimistically appending a local copy that could disagree with
 * what was actually stored.
 */
export type ChatMessage = {
  id: number;
  userId: string;
  participantId: number;
  senderName: string;
  body: string;
  createdAt: string;
};

/**
 * Characters that carry no visible meaning in a chat line.
 *
 * The server strips exactly this set before storing, so the client has to strip
 * it too. Without that, a message made only of zero-width characters passes the
 * local blank check and is then rejected by the server as empty, which looks to
 * the user like a message that was silently lost.
 */
const INVISIBLE_CHAT_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Reduce a draft to the text that will actually be stored.
 *
 * This mirrors the server's normalisation exactly, so what the length check
 * approves is what the server receives.
 */
export function normalizeChatDraft(draft: string): string {
  return draft.replace(INVISIBLE_CHAT_CHARS, "").replace(/\s+/g, " ").trim();
}

export function chatDraftError(draft: string, canSend: boolean): string | null {
  const normalized = normalizeChatDraft(draft);
  if (!normalized) return canSend ? null : "Reconnect to send messages.";
  if (normalized.length > CHAT_MAX_LENGTH) {
    return `Messages are limited to ${CHAT_MAX_LENGTH} characters.`;
  }
  return null;
}

export const SIGNALING_ERROR_MESSAGES: Record<string, string> = {
  UNKNOWN_TARGET: "A participant left before that message could be delivered.",
  INVALID_MESSAGE: "The signaling server rejected a message from this browser.",
  MESSAGE_EMPTY: "That message was empty.",
  MESSAGE_TOO_LONG: "That message was too long.",
  CHAT_ACCESS_DENIED: "You can no longer use chat in this meeting.",
  CHAT_UNAVAILABLE: "Your message could not be sent.",
  MEETING_NOT_LIVE: "This meeting is no longer live.",
};

export const SIGNALING_STATUS_TEXT: Record<SignalingStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting media…",
  connected: "Media connected",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
  failed: "Media connection failed",
};

/**
 * Decide which side of a pair creates the offer.
 *
 * Both browsers compare the same two connection ids, so exactly one offers and
 * the pair never has to resolve glare. Ties are impossible because a
 * connection id is unique per socket.
 */
export function shouldInitiateOffer(selfConnectionId: string, peerConnectionId: string): boolean {
  return selfConnectionId < peerConnectionId;
}

export function buildSocketUrl(wsUrl: string, ticket: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

/** STUN/TURN servers from the ticket, falling back to build-time configuration. */
export function resolveIceServers(
  ticketServers: IceServer[] | undefined,
  fallbackUrls: string[] = [],
): RTCIceServer[] {
  const fromTicket = (ticketServers ?? []).filter((server) =>
    Array.isArray(server.urls) ? server.urls.length > 0 : Boolean(server.urls),
  );
  const fromEnv = fallbackUrls.filter(Boolean).map((url) => ({ urls: url }));
  return [...fromTicket, ...fromEnv] as RTCIceServer[];
}

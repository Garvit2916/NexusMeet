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

export const SIGNALING_ERROR_MESSAGES: Record<string, string> = {
  UNKNOWN_TARGET: "A participant left before that message could be delivered.",
  INVALID_MESSAGE: "The signaling server rejected a message from this browser.",
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

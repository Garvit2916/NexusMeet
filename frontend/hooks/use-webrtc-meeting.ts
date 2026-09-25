"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { meetingService } from "@/services/meeting-service";
import {
  buildSocketUrl,
  resolveIceServers,
  shouldInitiateOffer,
  SIGNALING_ERROR_MESSAGES,
  type MediaStateUpdate,
  type RemoteParticipant,
  type SignalingPeer,
  type SignalingStatus,
} from "@/lib/signaling";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

const STUN_FALLBACK = (process.env.NEXT_PUBLIC_STUN_URL ?? "stun:stun.l.google.com:19302")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

type PeerEntry = {
  peer: SignalingPeer;
  connection: RTCPeerConnection;
  stream: MediaStream;
  /** ICE that arrived before the remote description was set. */
  pendingCandidates: RTCIceCandidateInit[];
};

type WebRTCMeetingOptions = {
  meetingId: string;
  /** Only connect once the user is actually in the room. */
  enabled: boolean;
  localStream: MediaStream | null;
  onHostMuteChange?: (muted: boolean) => void;
  onRemoved?: () => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  /** Injected in tests; production uses the real WebSocket. */
  createSocket?: (url: string) => WebSocket;
  /** Injected in tests; production uses the real RTCPeerConnection. */
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  createMediaStream?: (tracks?: MediaStreamTrack[]) => MediaStream;
  requestTicket?: (meetingId: string) => Promise<{
    ticket: string;
    wsUrl: string;
    iceServers: RTCIceServer[];
  }>;
};

function parsePeer(raw: Record<string, unknown>): SignalingPeer {
  return {
    connectionId: String(raw.connection_id ?? ""),
    userId: String(raw.user_id ?? ""),
    participantId: Number(raw.participant_id ?? 0),
    name: String(raw.name ?? "Guest"),
    isHost: Boolean(raw.is_host),
    audioEnabled: Boolean(raw.audio_enabled),
    videoEnabled: Boolean(raw.video_enabled),
    screenSharing: Boolean(raw.screen_sharing),
  };
}

function toRemoteParticipant(entry: PeerEntry): RemoteParticipant {
  return {
    ...entry.peer,
    stream: entry.stream,
    connectionState: entry.connection.connectionState,
  };
}

/**
 * Owns the whole real-time media layer for one meeting.
 *
 * Topology is a full mesh: one RTCPeerConnection per remote participant, each
 * carrying this browser's own camera and microphone tracks. Media flows
 * browser to browser over WebRTC; this socket only relays SDP and ICE.
 */
export function useWebRTCMeeting({
  meetingId,
  enabled,
  localStream,
  onHostMuteChange,
  onRemoved,
  onEnded,
  onError,
  createSocket,
  createPeerConnection,
  createMediaStream,
  requestTicket,
}: WebRTCMeetingOptions) {
  const [status, setStatus] = useState<SignalingStatus>("idle");
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [mutedByHost, setMutedByHost] = useState(false);
  const [protocolError, setProtocolError] = useState<string | null>(null);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const selfConnectionIdRef = useRef<string | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: STUN_FALLBACK[0] ?? "" }]);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedIntentionallyRef = useRef(false);
  const hostMutedRef = useRef(false);

  // Callbacks are read from refs so a parent re-render never tears down a
  // healthy peer connection just because a handler identity changed.
  const handlersRef = useRef({ onHostMuteChange, onRemoved, onEnded, onError });
  handlersRef.current = { onHostMuteChange, onRemoved, onEnded, onError };

  const factoryRef = useRef({ createSocket, createPeerConnection, createMediaStream, requestTicket });
  factoryRef.current = { createSocket, createPeerConnection, createMediaStream, requestTicket };

  const publishPeers = useCallback(() => {
    setRemoteParticipants(
      [...peersRef.current.values()].map(toRemoteParticipant),
    );
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const closePeer = useCallback((connectionId: string) => {
    const entry = peersRef.current.get(connectionId);
    if (!entry) return;
    peersRef.current.delete(connectionId);
    try {
      entry.connection.ontrack = null;
      entry.connection.onicecandidate = null;
      entry.connection.onconnectionstatechange = null;
      entry.connection.close();
    } catch {
      // A connection that is already gone needs no cleanup.
    }
    // Stop remote tracks so the browser stops decoding a departed peer.
    entry.stream.getTracks().forEach((track) => track.stop());
  }, []);

  const closeAllPeers = useCallback(() => {
    [...peersRef.current.keys()].forEach(closePeer);
    publishPeers();
  }, [closePeer, publishPeers]);

  /** Keep every peer's senders aligned with the current local tracks. */
  const syncLocalTracks = useCallback((stream: MediaStream | null) => {
    if (!stream) return;
    for (const entry of peersRef.current.values()) {
      const senders = entry.connection.getSenders();
      for (const track of stream.getTracks()) {
        const existing = senders.find(
          (sender) => sender.track?.kind === track.kind,
        );
        if (existing) {
          // Replacing keeps the negotiated transceiver and avoids a renegotiation.
          if (existing.track !== track) void existing.replaceTrack(track);
        } else {
          entry.connection.addTrack(track, stream);
        }
      }
    }
  }, []);

  const createPeer = useCallback(
    (peer: SignalingPeer): PeerEntry => {
      const existing = peersRef.current.get(peer.connectionId);
      if (existing) return existing;

      const factory = factoryRef.current.createPeerConnection;
      const connection = factory
        ? factory({ iceServers: iceServersRef.current })
        : new RTCPeerConnection({ iceServers: iceServersRef.current });
      const MediaStreamCtor = factoryRef.current.createMediaStream;
      const stream = MediaStreamCtor ? MediaStreamCtor() : new MediaStream();

      const entry: PeerEntry = { peer, connection, stream, pendingCandidates: [] };
      peersRef.current.set(peer.connectionId, entry);

      connection.ontrack = (event) => {
        const [incoming] = event.streams;
        if (incoming) {
          // Reuse the remote stream object the browser handed us.
          if (entry.stream !== incoming) {
            entry.stream.getTracks().forEach((track) => track.stop());
            entry.stream = incoming;
          }
        } else {
          entry.stream.addTrack(event.track);
        }
        publishPeers();
      };

      connection.onicecandidate = (event) => {
        if (!event.candidate) return;
        send({
          type: "ice-candidate",
          target: peer.connectionId,
          candidate: event.candidate.toJSON(),
        });
      };

      connection.onconnectionstatechange = () => {
        const current = peersRef.current.get(peer.connectionId);
        if (!current) return;
        if (current.connection.connectionState === "failed") {
          // A failed pair cannot be repaired in place; drop it and let the
          // signaling roster re-trigger negotiation on the next welcome.
          closePeer(peer.connectionId);
          publishPeers();
          return;
        }
        publishPeers();
      };

      const localMedia = localStreamRef.current;
      if (localMedia) {
        for (const track of localMedia.getTracks()) {
          connection.addTrack(track, localMedia);
        }
      }
      return entry;
    },
    [closePeer, publishPeers, send],
  );

  const startOffer = useCallback(
    async (peerConnectionId: string) => {
      const entry = peersRef.current.get(peerConnectionId);
      if (!entry) return;
      const offer = await entry.connection.createOffer();
      await entry.connection.setLocalDescription(offer);
      send({
        type: "offer",
        target: peerConnectionId,
        sdp: { type: offer.type, sdp: offer.sdp },
      });
    },
    [send],
  );

  const ensurePeer = useCallback(
    (peer: SignalingPeer) => {
      if (selfConnectionIdRef.current && peer.connectionId === selfConnectionIdRef.current) {
        return;
      }
      const isNew = !peersRef.current.has(peer.connectionId);
      const entry = createPeer(peer);
      if (isNew && selfConnectionIdRef.current) {
        // Only the lexicographically smaller connection id offers, so the pair
        // never negotiates from both ends at once.
        if (shouldInitiateOffer(selfConnectionIdRef.current, peer.connectionId)) {
          void startOffer(peer.connectionId);
        }
      }
      publishPeers();
      return entry;
    },
    [createPeer, publishPeers, startOffer],
  );

  const applyHostMute = useCallback((muted: boolean) => {
    hostMutedRef.current = muted;
    setMutedByHost(muted);
    const stream = localStreamRef.current;
    if (!stream) return;
    // The host mute has to reach the real track, otherwise the peer connection
    // keeps forwarding audio while the UI claims otherwise.
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    handlersRef.current.onHostMuteChange?.(muted);
  }, []);

  const handleMessage = useCallback(
    (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const message = raw as Record<string, unknown>;
      switch (message.type) {
        case "welcome": {
          const self = parsePeer((message.self ?? {}) as Record<string, unknown>);
          selfConnectionIdRef.current = self.connectionId;
          const servers = resolveIceServers(
            (message.ice_servers ?? undefined) as never,
            STUN_FALLBACK,
          );
          if (servers.length) iceServersRef.current = servers;
          const roster = (message.peers ?? []) as Record<string, unknown>[];
          for (const rawPeer of roster) ensurePeer(parsePeer(rawPeer));
          publishPeers();
          break;
        }
        case "peer-joined": {
          ensurePeer(parsePeer((message.peer ?? {}) as Record<string, unknown>));
          break;
        }
        case "offer": {
          void (async () => {
            const from = String(message.from ?? "");
            const peer = ensurePeer({
              connectionId: from,
              userId: String(message.from_user_id ?? ""),
              participantId: 0,
              name: "Guest",
              isHost: false,
              audioEnabled: true,
              videoEnabled: true,
              screenSharing: false,
            });
            if (!peer) return;
            const sdp = message.sdp as RTCSessionDescriptionInit;
            await peer.connection.setRemoteDescription(sdp);
            for (const candidate of peer.pendingCandidates.splice(0)) {
              await peer.connection.addIceCandidate(candidate).catch(() => undefined);
            }
            const answer = await peer.connection.createAnswer();
            await peer.connection.setLocalDescription(answer);
            send({
              type: "answer",
              target: from,
              sdp: { type: answer.type, sdp: answer.sdp },
            });
          })();
          break;
        }
        case "answer": {
          void (async () => {
            const entry = peersRef.current.get(String(message.from ?? ""));
            if (!entry) return;
            await entry.connection
              .setRemoteDescription(message.sdp as RTCSessionDescriptionInit)
              .catch(() => undefined);
            for (const candidate of entry.pendingCandidates.splice(0)) {
              await entry.connection.addIceCandidate(candidate).catch(() => undefined);
            }
          })();
          break;
        }
        case "ice-candidate": {
          const entry = peersRef.current.get(String(message.from ?? ""));
          const candidate = message.candidate as RTCIceCandidateInit;
          if (!entry || !candidate) return;
          if (entry.connection.remoteDescription) {
            void entry.connection.addIceCandidate(candidate).catch(() => undefined);
          } else {
            // Candidates can outrun the description; hold them until it lands.
            entry.pendingCandidates.push(candidate);
          }
          break;
        }
        case "media-state": {
          const connectionId = String(message.connection_id ?? "");
          const entry = peersRef.current.get(connectionId);
          if (!entry) break;
          entry.peer = {
            ...entry.peer,
            audioEnabled: Boolean(message.audio_enabled),
            videoEnabled: Boolean(message.video_enabled),
            screenSharing: Boolean(message.screen_sharing),
          };
          publishPeers();
          break;
        }
        case "host-mute": {
          applyHostMute(Boolean(message.muted));
          break;
        }
        case "participant-removed": {
          closeAllPeers();
          handlersRef.current.onRemoved?.();
          break;
        }
        case "meeting-ended": {
          closeAllPeers();
          handlersRef.current.onEnded?.();
          break;
        }
        case "peer-left": {
          closePeer(String(message.connection_id ?? ""));
          publishPeers();
          break;
        }
        case "error": {
          const text =
            SIGNALING_ERROR_MESSAGES[String(message.code)] ??
            "The signaling server reported a problem.";
          setProtocolError(text);
          handlersRef.current.onError?.(text);
          break;
        }
        default:
          break;
      }
    },
    [applyHostMute, closeAllPeers, closePeer, ensurePeer, publishPeers, send],
  );

  const teardownSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const socket = socketRef.current;
    socketRef.current = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.send(JSON.stringify({ type: "leave" }));
        socket.close(1000, "left meeting");
      } catch {
        socket.close();
      }
    }
  }, []);

  const connect = useCallback(async () => {
    if (!enabled) return;
    setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
    setProtocolError(null);

    let ticket: { ticket: string; wsUrl: string; iceServers: RTCIceServer[] };
    try {
      const request = factoryRef.current.requestTicket;
      ticket = request
        ? await request(meetingId)
        : await meetingService.createSignalingTicket(meetingId);
    } catch (error) {
      setStatus("failed");
      handlersRef.current.onError?.(
        error instanceof Error
          ? `Media could not start: ${error.message}`
          : "Media could not start because the signaling service is unavailable.",
      );
      return;
    }

    if (ticket.iceServers?.length) iceServersRef.current = ticket.iceServers;
    const url = buildSocketUrl(ticket.wsUrl, ticket.ticket);
    const socketFactory = factoryRef.current.createSocket;
    const socket = socketFactory ? socketFactory(url) : new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      setStatus("connected");
    };
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      try {
        handleMessage(JSON.parse(event.data));
      } catch {
        // A frame we cannot parse is not worth tearing the room down for.
      }
    };
    socket.onerror = () => {
      // `onclose` always follows and owns the retry policy.
    };
    socket.onclose = () => {
      if (closedIntentionallyRef.current) {
        setStatus("closed");
        return;
      }
      socketRef.current = null;
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setStatus("failed");
        handlersRef.current.onError?.(
          "The media connection dropped and could not be re-established.",
        );
        return;
      }
      setStatus("reconnecting");
      const attempt = reconnectAttemptRef.current;
      reconnectAttemptRef.current += 1;
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** attempt,
        RECONNECT_MAX_DELAY_MS,
      );
      // Reconnecting re-runs the whole handshake, which also refreshes the
      // short-lived ticket. Peers are rebuilt from the fresh roster, so no
      // duplicate connections can survive the attempt.
      reconnectTimerRef.current = setTimeout(() => void connect(), delay);
    };
  }, [enabled, handleMessage, meetingId]);

  useEffect(() => {
    localStreamRef.current = localStream;
    if (localStream) {
      if (hostMutedRef.current) {
        localStream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      // Media can be granted after the room is joined, so late tracks are
      // attached to peers that were negotiated without them.
      syncLocalTracks(localStream);
    }
  }, [localStream, syncLocalTracks]);

  useEffect(() => {
    if (!enabled) return;
    closedIntentionallyRef.current = false;
    void connect();
    return () => {
      closedIntentionallyRef.current = true;
      teardownSocket();
      closeAllPeers();
      selfConnectionIdRef.current = null;
      reconnectAttemptRef.current = 0;
      setStatus("idle");
      setRemoteParticipants([]);
    };
  }, [closeAllPeers, connect, enabled, teardownSocket]);

  const publishMediaState = useCallback(
    (state: MediaStateUpdate) => {
      send({
        type: "media-state",
        audio_enabled: state.audioEnabled,
        video_enabled: state.videoEnabled,
        screen_sharing: state.screenSharing ?? false,
      });
    },
    [send],
  );

  return useMemo(
    () => ({
      remoteParticipants,
      status,
      mutedByHost,
      protocolError,
      peerCount: remoteParticipants.length,
      publishMediaState,
    }),
    [mutedByHost, protocolError, publishMediaState, remoteParticipants, status],
  );
}

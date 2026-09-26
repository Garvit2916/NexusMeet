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
import { createDiagnostics, iceCandidateType } from "@/lib/webrtc-diagnostics";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

/**
 * ICE restarts are the cheap repair for a connection that merely looks dead.
 * They are rate limited because a peer that has genuinely failed (no common
 * candidate pair) will fail again, and an unbounded restart loop would keep two
 * phones awake for no reason.
 */
const MAX_ICE_RESTARTS = 4;
const ICE_RESTART_MIN_INTERVAL_MS = 3000;
/** Cap on candidates held for a peer we have not met yet. */
const MAX_ORPHAN_CANDIDATES = 32;

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
  /**
   * Incremented every time the entry is replaced or torn down. Handlers capture
   * the value they were created with and bail out when it no longer matches, so
   * a late event from a discarded connection can never overwrite live state.
   */
  generation: number;
  /** Rate limiting state for `restartIce`. */
  restartAttempts: number;
  lastRestartAt: number;
  /** True while this side owns an in-flight negotiation, to detect glare. */
  negotiating: boolean;
  /** Last time we saw any sign of life from this peer. */
  lastSeenAt: number;
  /** Created from an `offer` before the roster identified the peer. */
  isPlaceholder: boolean;
  /** Set once the first offer/answer round has completed. */
  negotiationReady: boolean;
  /** Perfect-negotiation bookkeeping, so a late renegotiation can converge. */
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswer: boolean;
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
    iceConnectionState: entry.connection.iceConnectionState,
    // An empty MediaStream is a truthy object, so the presence of the stream
    // itself proves nothing. The track list is what the tile must check.
    hasVideoTrack: entry.stream.getVideoTracks().length > 0,
    hasAudioTrack: entry.stream.getAudioTracks().length > 0,
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
  /**
   * ICE that arrived before we knew the peer existed. Dropping these is what
   * makes a connection that was mid-handshake fail forever: the first candidates
   * are exactly the ones a late `peer-joined` would otherwise have consumed.
   */
  const orphanCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const selfConnectionIdRef = useRef<string | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: STUN_FALLBACK[0] ?? "" }]);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedIntentionallyRef = useRef(false);
  const hostMutedRef = useRef(false);
  const isHostRef = useRef(false);
  const clientIdRef = useRef(`c${Math.random().toString(36).slice(2, 8)}`);

  // Diagnostics are wired up unconditionally: a media failure that only shows up
  // for someone else on another network is invisible without a log.
  const diagnosticsRef = useRef(
    createDiagnostics(() => ({
      clientId: clientIdRef.current,
      role: isHostRef.current ? "host" : "guest",
      meetingId,
      selfConnectionId: selfConnectionIdRef.current,
      peerConnectionId: "",
      participantId: 0,
      peerName: "",
    })),
  );


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
    const type = String(payload.type ?? "unknown");
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // Silently dropping an offer or answer here is indistinguishable from a
      // network failure later, so it gets logged explicitly.
      diagnosticsRef.current.signal("out", type, String(payload.target ?? ""), { dropped: "socket-not-open" });
      return false;
    }
    socket.send(JSON.stringify(payload));
    diagnosticsRef.current.signal("out", type, String(payload.target ?? ""));
    return true;
  }, []);

  const closePeer = useCallback((connectionId: string) => {
    const entry = peersRef.current.get(connectionId);
    if (!entry) return;
    // Invalidate every handler bound to this connection before discarding it, so
    // an in-flight promise from the old connection cannot republish it.
    entry.generation += 1;
    peersRef.current.delete(connectionId);
    try {
      entry.connection.ontrack = null;
      entry.connection.onicecandidate = null;
      entry.connection.onconnectionstatechange = null;
      entry.connection.oniceconnectionstatechange = null;
      entry.connection.onnegotiationneeded = null;
      entry.connection.onicecandidateerror = null;
      entry.connection.close();
    } catch {
      // A connection that is already gone needs no cleanup.
    }
    // Stop remote tracks so the browser stops decoding a departed peer.
    entry.stream.getTracks().forEach((track) => track.stop());
  }, []);

  const closeAllPeers = useCallback(() => {
    [...peersRef.current.keys()].forEach(closePeer);
    orphanCandidatesRef.current.clear();
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

  /**
   * Applies queued candidates. One unusable candidate must never stop the rest
   * of a pair from working, so a rejection is logged and the queue continues.
   */
  const flushCandidates = useCallback(async (entry: PeerEntry, connectionId: string) => {
    const queued = entry.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await entry.connection.addIceCandidate(candidate);
      } catch (error) {
        diagnosticsRef.current.candidateError(connectionId, "add-ice-failed", {
          type: iceCandidateType(candidate),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (queued.length) {
      diagnosticsRef.current.peerEvent(connectionId, "candidates-flushed", entry.connection, {
        count: queued.length,
      });
    }
  }, []);

  /**
   * The impolite peer is the one that owns the initial offer; it wins a glare
   * race. The other side rolls back. This is what lets either browser start a
   * renegotiation, which is the only way a camera enabled *after* joining ever
   * reaches the other browser.
   */
  const isPolitePeer = useCallback((connectionId: string) => {
    const self = selfConnectionIdRef.current;
    return self ? !shouldInitiateOffer(self, connectionId) : true;
  }, []);

  const startOffer = useCallback(
    async (peerConnectionId: string, reason: string) => {
      const entry = peersRef.current.get(peerConnectionId);
      if (!entry) return;
      const { connection } = entry;
      const generation = entry.generation;
      const stillCurrent = () => peersRef.current.get(peerConnectionId)?.generation === generation;
      try {
        entry.makingOffer = true;
        entry.negotiating = true;
        const offer = await connection.createOffer();
        if (!stillCurrent()) return;
        await connection.setLocalDescription(offer);
        if (!stillCurrent()) return;
        diagnosticsRef.current.peerEvent(peerConnectionId, "offer-created", connection, {
          reason,
          sdpBytes: offer.sdp?.length ?? 0,
        });
        send({
          type: "offer",
          target: peerConnectionId,
          sdp: { type: offer.type, sdp: offer.sdp },
        });
      } catch (error) {
        diagnosticsRef.current.signalError(peerConnectionId, "create-offer", error);
      } finally {
        entry.makingOffer = false;
        entry.negotiating = false;
      }
    },
    [send],
  );

  const applyAnswer = useCallback(
    async (entry: PeerEntry, sdp: RTCSessionDescriptionInit) => {
      const { connection } = entry;
      const connectionId = entry.peer.connectionId;
      const generation = entry.generation;
      const stillCurrent = () => peersRef.current.get(connectionId)?.generation === generation;
      entry.isSettingRemoteAnswer = true;
      try {
        await connection.setRemoteDescription(sdp);
      } catch (error) {
        diagnosticsRef.current.signalError(connectionId, "set-remote-answer", error);
        return;
      } finally {
        entry.isSettingRemoteAnswer = false;
      }
      if (!stillCurrent()) return;
      entry.negotiationReady = true;
      await flushCandidates(entry, connectionId);
      void diagnosticsRef.current.selectedPair(connectionId, connection);
    },
    [flushCandidates],
  );

  const answerOffer = useCallback(
    async (entry: PeerEntry, sdp: RTCSessionDescriptionInit) => {
      const { connection } = entry;
      const connectionId = entry.peer.connectionId;
      const generation = entry.generation;
      const stillCurrent = () => peersRef.current.get(connectionId)?.generation === generation;
      diagnosticsRef.current.signal("in", "offer", connectionId, {
        sdpBytes: String(sdp?.sdp ?? "").length,
      });

      // Glare: both sides renegotiated at once. The impolite side discards its
      // own offer; the polite side rolls back and accepts theirs.
      if (entry.makingOffer) {
        if (!isPolitePeer(connectionId)) {
          entry.ignoreOffer = true;
          diagnosticsRef.current.signal("in", "offer", connectionId, { ignored: "glare-impolite" });
          return;
        }
        try {
          await connection.setLocalDescription({ type: "rollback" });
        } catch (error) {
          diagnosticsRef.current.signalError(connectionId, "rollback", error);
        }
      }
      entry.makingOffer = false;
      entry.ignoreOffer = false;

      try {
        await connection.setRemoteDescription(sdp);
      } catch (error) {
        diagnosticsRef.current.signalError(connectionId, "set-remote-offer", error);
        return;
      }
      if (!stillCurrent()) return;
      await flushCandidates(entry, connectionId);
      let answer: RTCSessionDescriptionInit;
      try {
        answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
      } catch (error) {
        diagnosticsRef.current.signalError(connectionId, "create-answer", error);
        return;
      }
      if (!stillCurrent()) return;
      entry.negotiationReady = true;
      send({
        type: "answer",
        target: connectionId,
        sdp: { type: answer.type, sdp: answer.sdp },
      });
    },
    [flushCandidates, isPolitePeer, send],
  );

  const createPeer = useCallback(
    (peer: SignalingPeer, authoritative: boolean): PeerEntry | null => {
      if (selfConnectionIdRef.current && peer.connectionId === selfConnectionIdRef.current) {
        return null;
      }

      const existing = peersRef.current.get(peer.connectionId);
      if (existing) {
        // A placeholder built from an early `offer` must be upgraded to the real
        // identity, or the tile is stuck on "Guest" with no camera state. A
        // roster must never overwrite fresher `media-state` on a real peer.
        if (authoritative && existing.isPlaceholder) {
          existing.peer = peer;
          existing.isPlaceholder = false;
          publishPeers();
        }
        return existing;
      }

      const factory = factoryRef.current.createPeerConnection;
      const connection = factory
        ? factory({ iceServers: iceServersRef.current })
        : new RTCPeerConnection({ iceServers: iceServersRef.current });
      const MediaStreamCtor = factoryRef.current.createMediaStream;
      const stream = MediaStreamCtor ? MediaStreamCtor() : new MediaStream();

      const entry: PeerEntry = {
        peer,
        connection,
        stream,
        pendingCandidates: [],
        generation: 0,
        restartAttempts: 0,
        lastRestartAt: 0,
        negotiating: false,
        isPlaceholder: !authoritative,
        negotiationReady: false,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswer: false,
        lastSeenAt: Date.now(),
      };
      peersRef.current.set(peer.connectionId, entry);
      const { connectionId } = peer;
      const generation = entry.generation;
      /** Guards every handler against a connection that has been replaced. */
      const stillCurrent = () => peersRef.current.get(connectionId)?.generation === generation;

      // Hand over anything that arrived while this peer was still unknown.
      const orphans = orphanCandidatesRef.current.get(connectionId);
      if (orphans?.length) {
        orphanCandidatesRef.current.delete(connectionId);
        entry.pendingCandidates.push(...orphans);
        diagnosticsRef.current.peerEvent(connectionId, "orphan-candidates-claimed", connection, {
          count: orphans.length,
        });
      }

      diagnosticsRef.current.peerEvent(connectionId, "created", connection, {
        name: peer.name,
        participantId: peer.participantId,
        placeholder: !authoritative,
        iceServers: iceServersRef.current.length,
      });

      /**
       * Re-gathering ICE is far cheaper than rebuilding the connection, and it
       * repairs the common real-world case: a NAT binding that expired while the
       * laptop was asleep. Previously a `failed` connection was simply deleted,
       * and because no new roster ever arrives the UI sat on "Connecting..."
       * for the rest of the meeting.
       */
      const attemptIceRestart = (why: string) => {
        if (!stillCurrent()) return;
        const now = Date.now();
        if (entry.restartAttempts >= MAX_ICE_RESTARTS) {
          diagnosticsRef.current.peerFailed(connectionId, connection, "restart-exhausted");
          handlersRef.current.onError?.(
            "Media could not reach the other participant. This is usually a restrictive network; try a different network or ask the host to relay traffic.",
          );
          return;
        }
        if (now - entry.lastRestartAt < ICE_RESTART_MIN_INTERVAL_MS) return;
        entry.restartAttempts += 1;
        entry.lastRestartAt = now;
        // An ICE restart only re-offers once the first round has settled.
        entry.negotiationReady = true;
        diagnosticsRef.current.peerEvent(connectionId, "restart-ice", connection, {
          attempt: entry.restartAttempts,
          why,
        });
        if (typeof connection.restartIce === "function") {
          try {
            connection.restartIce();
          } catch (error) {
            diagnosticsRef.current.signalError(connectionId, "restart-ice", error);
          }
        }
      };

      connection.ontrack = (event) => {
        if (!stillCurrent()) return;
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
        entry.lastSeenAt = Date.now();
        diagnosticsRef.current.track(connectionId, event, entry.stream);
        publishPeers();
      };

      connection.onicecandidate = (event) => {
        if (!stillCurrent()) return;
        if (!event.candidate) {
          diagnosticsRef.current.peerEvent(connectionId, "gathering-complete", connection, {});
          return;
        }
        diagnosticsRef.current.localCandidate(connectionId, event.candidate);
        send({
          type: "ice-candidate",
          target: connectionId,
          candidate: event.candidate.toJSON(),
        });
      };

      connection.onicecandidateerror = (event) => {
        diagnosticsRef.current.iceGatherNotice(
          connectionId,
          (event as RTCPeerConnectionIceErrorEvent).errorCode,
        );
      };

      connection.oniceconnectionstatechange = () => {
        if (!stillCurrent()) return;
        diagnosticsRef.current.peerEvent(connectionId, "ice-state", connection, {});
        if (connection.iceConnectionState === "failed") attemptIceRestart("ice-failed");
      };

      connection.onconnectionstatechange = () => {
        if (!stillCurrent()) return;
        diagnosticsRef.current.peerEvent(connectionId, "connection-state", connection, {});
        if (connection.connectionState === "connected") {
          entry.restartAttempts = 0;
          entry.lastRestartAt = 0;
          entry.lastSeenAt = Date.now();
          // Media actually flowing is the only proof the socket is healthy, so
          // the backoff resets here rather than on socket open.
          if (reconnectAttemptRef.current > 0) {
            diagnosticsRef.current.socket("reconnect-confirmed-by-media", {
              attempts: reconnectAttemptRef.current,
            });
            reconnectAttemptRef.current = 0;
          }
          void diagnosticsRef.current.selectedPair(connectionId, connection);
          void diagnosticsRef.current.summary(connectionId, connection);
        } else if (connection.connectionState === "disconnected") {
          // Recoverable on its own: re-check ICE without discarding anything.
          attemptIceRestart("disconnected");
        } else if (connection.connectionState === "failed") {
          diagnosticsRef.current.peerFailed(connectionId, connection, "failed");
          attemptIceRestart("failed");
        }
        publishPeers();
      };

      connection.onnegotiationneeded = () => {
        if (!stillCurrent()) return;
        if (!entry.negotiationReady) {
          // The initial offer still belongs to the deterministic initiator;
          // offering here too would have both sides negotiating at once.
          diagnosticsRef.current.peerEvent(
            connectionId,
            "negotiation-needed-deferred",
            connection,
            {},
          );
          return;
        }
        void startOffer(connectionId, "negotiationneeded");
      };

      const localMedia = localStreamRef.current;
      if (localMedia) {
        for (const track of localMedia.getTracks()) {
          connection.addTrack(track, localMedia);
        }
      }
      return entry;
    },
    [publishPeers, send, startOffer],
  );

  const ensurePeer = useCallback(
    (peer: SignalingPeer, authoritative = true): PeerEntry | null => {
      if (selfConnectionIdRef.current && peer.connectionId === selfConnectionIdRef.current) {
        return null;
      }
      const isNew = !peersRef.current.has(peer.connectionId);
      const entry = createPeer(peer, authoritative);
      if (!entry) return null;
      if (isNew && authoritative && selfConnectionIdRef.current) {
        // Only the lexicographically smaller connection id opens the first
        // negotiation, so the initial pair never negotiates from both ends.
        if (shouldInitiateOffer(selfConnectionIdRef.current, peer.connectionId)) {
          void startOffer(peer.connectionId, "roster");
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
          isHostRef.current = self.isHost;
          const servers = resolveIceServers(
            (message.ice_servers ?? undefined) as never,
            STUN_FALLBACK,
          );
          if (servers.length) iceServersRef.current = servers;
          diagnosticsRef.current.iceServers(iceServersRef.current);
          const roster = (message.peers ?? []) as Record<string, unknown>[];
          const seen = new Set<string>();
          for (const rawPeer of roster) {
            const peer = parsePeer(rawPeer);
            seen.add(peer.connectionId);
            ensurePeer(peer);
          }
          // Reconcile: the roster is authoritative, so a peer that is no longer
          // listed is gone even though we never received a `peer-left`. Without
          // this, every reconnect left a permanently dead tile behind.
          for (const connectionId of [...peersRef.current.keys()]) {
            if (!seen.has(connectionId)) {
              diagnosticsRef.current.peerEvent(connectionId, "roster-removed", null, {});
              closePeer(connectionId);
              orphanCandidatesRef.current.delete(connectionId);
            }
          }
          publishPeers();
          break;
        }
        case "peer-joined": {
          const peer = parsePeer((message.peer ?? {}) as Record<string, unknown>);
          diagnosticsRef.current.signal("in", "peer-joined", peer.connectionId, {
            name: peer.name,
          });
          ensurePeer(peer);
          break;
        }
        case "offer": {
          void (async () => {
            const from = String(message.from ?? "");
            // The offer can beat the roster, so this entry starts as a
            // placeholder and is upgraded to the real identity on arrival.
            const peer = ensurePeer(
              {
                connectionId: from,
                userId: String(message.from_user_id ?? ""),
                participantId: 0,
                name: "Guest",
                isHost: false,
                audioEnabled: true,
                videoEnabled: true,
                screenSharing: false,
              },
              false,
            );
            if (!peer) return;
            await answerOffer(peer, message.sdp as RTCSessionDescriptionInit);
          })();
          break;
        }
        case "answer": {
          void (async () => {
            const entry = peersRef.current.get(String(message.from ?? ""));
            if (!entry) {
              // An answer with no matching offer means our state was replaced
              // mid-negotiation; the new connection will renegotiate.
              diagnosticsRef.current.signal("in", "answer", String(message.from ?? ""), {
                ignored: "no-peer",
              });
              return;
            }
            if (entry.isSettingRemoteAnswer) return;
            await applyAnswer(entry, message.sdp as RTCSessionDescriptionInit);
          })();
          break;
        }
        case "ice-candidate": {
          const from = String(message.from ?? "");
          const candidate = message.candidate as RTCIceCandidateInit;
          if (!candidate) return;
          const entry = peersRef.current.get(from);
          if (!entry) {
            // Hold it. A candidate for a peer we have not met yet is normal when
            // the socket hands us ICE before the roster, and discarding these is
            // what left peers stuck connecting with no way back.
            const buffered = orphanCandidatesRef.current.get(from) ?? [];
            if (buffered.length < MAX_ORPHAN_CANDIDATES) {
              buffered.push(candidate);
              orphanCandidatesRef.current.set(from, buffered);
            }
            diagnosticsRef.current.remoteCandidate(from, candidate);
            diagnosticsRef.current.notice(from, "buffered-for-unknown-peer", {
              type: iceCandidateType(candidate),
              buffered: buffered.length,
            });
            return;
          }
          diagnosticsRef.current.remoteCandidate(from, candidate);
          if (entry.connection.remoteDescription) {
            entry.connection.addIceCandidate(candidate).catch((error: unknown) => {
              diagnosticsRef.current.candidateError(from, "add-ice-failed", {
                type: iceCandidateType(candidate),
                error: error instanceof Error ? error.message : String(error),
              });
            });
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
          const connectionId = String(message.connection_id ?? "");
          closePeer(connectionId);
          orphanCandidatesRef.current.delete(connectionId);
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
    [answerOffer, applyAnswer, applyHostMute, closeAllPeers, closePeer, ensurePeer, publishPeers],
  );

  const teardownSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const socket = socketRef.current;
    socketRef.current = null;
    orphanCandidatesRef.current.clear();
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    diagnosticsRef.current.socket("teardown", {});
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
      diagnosticsRef.current.socket("ticket-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
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
    diagnosticsRef.current.socket("connecting", { attempt: reconnectAttemptRef.current });

    socket.onopen = () => {
      // The backoff is deliberately *not* reset here: an open socket is not
      // proof of working media. It resets in the peer connection once ICE
      // actually connects, so a socket that keeps flapping is still retried.
      diagnosticsRef.current.socket("open", { attempt: reconnectAttemptRef.current });
      setStatus("connected");
    };
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      try {
        handleMessage(JSON.parse(event.data));
      } catch {
        // A frame we cannot parse is not worth tearing the room down for.
        diagnosticsRef.current.socket("unparseable-frame", {});
      }
    };
    socket.onerror = () => {
      // `onclose` always follows and owns the retry policy.
      diagnosticsRef.current.socket("error", {});
    };
    socket.onclose = () => {
      if (closedIntentionallyRef.current) {
        setStatus("closed");
        return;
      }
      socketRef.current = null;
      diagnosticsRef.current.socket("closed", { attempt: reconnectAttemptRef.current });
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setStatus("failed");
        diagnosticsRef.current.socket("reconnect-exhausted", {
          attempts: reconnectAttemptRef.current,
        });
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

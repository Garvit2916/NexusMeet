/**
 * Structured diagnostics for the WebRTC media layer.
 *
 * The whole point of this module is that a media failure is otherwise
 * invisible: a dropped ICE candidate, a swallowed `setRemoteDescription`
 * rejection, and a peer that silently disappears all look identical in the UI.
 * Every event is emitted as a single console line with a stable prefix so the
 * host and guest logs can be interleaved and read as one timeline.
 *
 * Nothing here ever logs credentials: tickets, session cookies, TURN passwords,
 * SDP bodies, and ICE candidates (which embed host addresses) are reduced to
 * counts and types before they reach the console.
 */

/** One browser taking part in a meeting. Used to tell the two logs apart. */
export type DiagnosticRole = "host" | "guest";

export type PeerDiagnostic = {
  /** Stable per-tab id so two log streams can be matched up. */
  clientId: string;
  role: DiagnosticRole;
  meetingId: string;
  /** Our own connection id, once the server has issued one. */
  selfConnectionId: string | null;
  /** The remote peer's connection id, as a short label. */
  peerConnectionId: string;
  participantId: number;
  peerName: string;
};

const PREFIX = "[webrtc]";

/**
 * The hook logs on every peer event, which is the point in production but pure
 * noise in a test run. Tests assert on behaviour (a restart happened, a peer was
 * reconciled) rather than on log text, so the output is suppressed.
 */
const QUIET = process.env.NODE_ENV === "test";

/** Keep a value short enough to stay readable in a console. */
function clip(value: string, max = 48): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function describeIceServers(servers: RTCIceServer[] | undefined): string {
  if (!servers?.length) return "none";
  return servers
    .map((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      const kinds = urls.map((url) => {
        const scheme = String(url).split(":")[0];
        return scheme === "turns" || scheme === "turn" ? "TURN" : "STUN";
      });
      return `${kinds.join("+")}(${urls.length})`;
    })
    .join(",");
}

/**
 * `RTCIceCandidate.type` is the only reliable way to tell a LAN address from a
 * STUN-reflected address from a TURN relay, and the distinction decides whether
 * a connection is possible at all.
 */
export function iceCandidateType(candidate: RTCIceCandidate | RTCIceCandidateInit | null): string {
  if (!candidate) return "none";
  const type = (candidate as RTCIceCandidate).type;
  if (type) return type;
  // A candidate received over the wire arrives as a plain init object.
  const raw = String((candidate as RTCIceCandidateInit).candidate ?? "");
  if (!raw) return "unknown";
  if (/\brelay\b/.test(raw)) return "relay";
  if (/\bsrflx\b/.test(raw)) return "srflx";
  if (/\bprflx\b/.test(raw)) return "prflx";
  if (/\bhost\b/.test(raw)) return "host";
  return "unknown";
}

/**
 * Resolved at emit time rather than at construction, because the connection id
 * and host role only become known once the server sends `welcome`.
 */
export function createDiagnostics(source: () => PeerDiagnostic) {
  function emit(channel: string, remoteId: string, event: string, detail?: Record<string, unknown>) {
    if (QUIET || typeof console === "undefined") return;
    const peer = source();
    const context = `role=${peer.role} client=${clip(peer.clientId, 8)} meeting=${clip(peer.meetingId, 16)}`;
    const parts = Object.entries(detail ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`);
    const line = `${PREFIX} ${channel} ${context} self=${clip(peer.selfConnectionId ?? "-", 10)} peer=${clip(remoteId || "-", 10)}${parts.length ? ` ${parts.join(" ")}` : ""}`;
    if (channel === "signal-error" || channel === "ice-error" || channel === "peer-failed") {
      console.error(line);
      return;
    }
    console.info(line);
  }

  return {
    /** Full ICE server list actually handed to the peer connection. */
    iceServers(servers: RTCIceServer[] | undefined) {
      emit("ice-config", "", "servers", { configured: describeIceServers(servers) });
    },

    socket(event: string, detail?: Record<string, unknown>) {
      emit("socket", "", event, detail);
    },

    /** Signaling frames, with payloads reduced to a type. */
    signal(direction: "out" | "in", type: string, from: string, detail?: Record<string, unknown>) {
      emit("signal", from, direction === "out" ? "send" : "recv", { msg: type, ...detail });
    },

    peerEvent(
      remoteId: string,
      event: string,
      connection: RTCPeerConnection | null,
      detail?: Record<string, unknown>,
    ) {
      emit("peer", remoteId, event, {
        connectionState: connection?.connectionState,
        iceConnectionState: connection?.iceConnectionState,
        iceGatheringState: connection?.iceGatheringState,
        signalingState: connection?.signalingState,
        ...detail,
      });
    },

    /** Local candidate produced by this browser. */
    localCandidate(remoteId: string, candidate: RTCIceCandidate | null) {
      emit("ice", remoteId, "local-candidate", {
        type: iceCandidateType(candidate),
        protocol: candidate?.protocol,
      });
    },

    /** Candidate received from the other browser. */
    remoteCandidate(remoteId: string, candidate: RTCIceCandidateInit | null) {
      emit("ice", remoteId, "remote-candidate", {
        type: iceCandidateType(candidate),
      });
    },

    iceError(remoteId: string, detail: Record<string, unknown>) {
      emit("ice-error", remoteId, "gather-failed", detail);
    },

    /** A candidate we could not use, or could not deliver to a peer. */
    candidateError(remoteId: string, stage: string, detail: Record<string, unknown>) {
      emit("ice-error", remoteId, stage, detail);
    },

    /** A rejected SDP or ICE operation that would otherwise be swallowed. */
    signalError(remoteId: string, operation: string, error: unknown) {
      emit("signal-error", remoteId, operation, {
        error: error instanceof Error ? clip(error.message, 80) : String(error),
      });
    },

    /** Track arrival, which is the moment media becomes visible. */
    track(remoteId: string, event: RTCTrackEvent, stream: MediaStream | null) {
      const track = event.track;
      emit("track", remoteId, "ontrack", {
        trackKind: track.kind,
        trackId: clip(track.id, 12),
        readyState: track.readyState,
        enabled: track.enabled,
        muted: track.muted,
        streamsInEvent: event.streams.length,
        streamId: clip(stream?.id ?? "-", 12),
        hasVideoTrack: Boolean(stream?.getVideoTracks().length),
      });
    },

    /** Explicit failure of a peer connection, kept separate from UI state. */
    peerFailed(remoteId: string, connection: RTCPeerConnection, reason: string) {
      emit("peer-failed", remoteId, reason, {
        connectionState: connection.connectionState,
        iceConnectionState: connection.iceConnectionState,
      });
    },

    /**
     * The pair ICE actually selected. This is the single most useful line when
     * diagnosing a cross-network failure, because it proves whether media is
     * flowing and over which candidate types.
     */
    async selectedPair(remoteId: string, connection: RTCPeerConnection) {
      try {
        const report = await connection.getStats();
        // Held in an object because a `let` assigned inside the callback is not
        // tracked by control flow analysis.
        const found: { pair?: Record<string, unknown> } = {};
        let bytesReceived = 0;
        let packetsReceived = 0;
        report.forEach((entry) => {
          if (entry.type === "candidate-pair" && (entry as { nominated?: boolean }).nominated) {
            found.pair = entry as unknown as Record<string, unknown>;
          }
          if (entry.type === "inbound-rtp") {
            const inbound = entry as unknown as Record<string, number>;
            bytesReceived += inbound.bytesReceived ?? 0;
            packetsReceived += inbound.packetsReceived ?? 0;
          }
        });
        emit("pair", remoteId, "selected", {
          state: found.pair?.state,
          nominated: found.pair ? "yes" : "no",
          bytesReceived,
          packetsReceived,
        });
      } catch (error) {
        emit("pair", remoteId, "unavailable", {
          error: error instanceof Error ? clip(error.message, 60) : String(error),
        });
      }
    },

    /** A short, log-safe summary of what this browser can currently reach. */
    async summary(remoteId: string, connection: RTCPeerConnection) {
      try {
        const report = await connection.getStats();
        const candidates: string[] = [];
        report.forEach((entry) => {
          if (entry.type === "local-candidate" || entry.type === "remote-candidate") {
            const candidateType = (entry as { candidateType?: string }).candidateType;
            if (candidateType) candidates.push(candidateType);
          }
        });
        const unique = [...new Set(candidates)].sort();
        emit("pair", remoteId, "candidate-types", {
          types: unique.length ? unique.join("+") : "none",
          hasRelay: unique.includes("relay"),
        });
      } catch {
        // Stats are best-effort diagnostics only.
      }
    },
  };
}

export type WebRTCDiagnostics = ReturnType<typeof createDiagnostics>;

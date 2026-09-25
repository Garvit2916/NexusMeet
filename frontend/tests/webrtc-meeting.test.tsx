import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWebRTCMeeting } from "@/hooks/use-webrtc-meeting";

/** Minimal stand-in for a browser MediaStreamTrack. */
class FakeTrack {
  enabled = true;
  stopped = false;
  constructor(readonly kind: "audio" | "video", readonly id = `${kind}-${Math.random()}`) {}
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
  stop() {
    this.tracks.forEach((track) => track.stop());
  }
}

type FakeSender = { kind: string; track: FakeTrack | null; replaceTrack: (track: FakeTrack) => Promise<void> };

/**
 * Fake RTCPeerConnection. The real API is async and event-driven, so this keeps
 * an explicit queue of effects the test can flush to control ordering.
 */
class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  readonly addedTracks: FakeTrack[] = [];
  readonly appliedCandidates: RTCIceCandidateInit[] = [];
  readonly senders: FakeSender[] = [];
  ontrack: ((event: { streams: MediaStream[]; track: FakeTrack }) => void) | null = null;
  onicecandidate: ((event: { candidate: { toJSON: () => unknown } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
  /** When set, setRemoteDescription blocks until resolved by the test. */
  private remoteGate: Promise<void> | null = null;
  private resolveRemoteGate: (() => void) | null = null;

  addTrack(track: FakeTrack) {
    this.addedTracks.push(track);
    const sender: FakeSender = {
      kind: track.kind,
      track,
      replaceTrack: async (next: FakeTrack) => {
        sender.track = next;
      },
    };
    this.senders.push(sender);
  }

  getSenders() {
    return this.senders;
  }

  createOffer = vi.fn(async () => ({ type: "offer" as RTCSdpType, sdp: "offer-sdp" }));
  createAnswer = vi.fn(async () => ({ type: "answer" as RTCSdpType, sdp: "answer-sdp" }));

  async setLocalDescription(description: unknown) {
    this.localDescription = description;
  }

  setRemoteDescription(description: unknown) {
    if (!this.remoteGate) {
      this.remoteDescription = description;
      return Promise.resolve();
    }
    // A real peer connection only exposes `remoteDescription` once the SDP has
    // actually been applied, so the fake must not set it early either.
    return this.remoteGate.then(() => {
      this.remoteDescription = description;
    });
  }

  holdRemoteDescription() {
    this.remoteGate = new Promise<void>((resolve) => {
      this.resolveRemoteGate = resolve;
    });
    return () => this.resolveRemoteGate?.();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.appliedCandidates.push(candidate);
  }

  close() {
    this.closed = true;
  }

  emitRemoteTrack(stream: FakeStream, track: FakeTrack) {
    this.ontrack?.({ streams: [stream as unknown as MediaStream], track });
  }

  emitConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  open() {
    this.onopen?.();
  }

  emit(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const TICKET = {
  ticket: "signed-ticket",
  wsUrl: "wss://nexusmeet-api.onrender.com/ws/meetings/room-1",
  iceServers: [{ urls: "stun:stun.example.test:19302" }],
};

function peer(connectionId: string, overrides: Record<string, unknown> = {}) {
  return {
    connection_id: connectionId,
    user_id: `usr_${connectionId}`,
    participant_id: 1,
    name: `Peer ${connectionId}`,
    is_host: false,
    audio_enabled: true,
    video_enabled: true,
    screen_sharing: false,
    ...overrides,
  };
}

function setup(options: {
  localStream?: FakeStream | null;
  enabled?: boolean;
  onHostMuteChange?: (muted: boolean) => void;
  onRemoved?: () => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
} = {}) {
  FakeSocket.instances = [];
  const connections: FakePeerConnection[] = [];
  const requestTicket = vi.fn(async () => TICKET);
  const localStream = options.localStream === undefined ? new FakeStream([new FakeTrack("audio"), new FakeTrack("video")]) : options.localStream;

  const view = renderHook(() =>
    useWebRTCMeeting({
      meetingId: "room-1",
      enabled: options.enabled ?? true,
      localStream: localStream as unknown as MediaStream | null,
      onHostMuteChange: options.onHostMuteChange,
      onRemoved: options.onRemoved,
      onEnded: options.onEnded,
      onError: options.onError,
      createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
      createPeerConnection: () => {
        const connection = new FakePeerConnection();
        connections.push(connection);
        return connection as unknown as RTCPeerConnection;
      },
      createMediaStream: () => new FakeStream() as unknown as MediaStream,
      requestTicket,
    }),
  );

  return { view, connections, requestTicket, localStream, socket: () => FakeSocket.instances[0] };
}

async function connect(options: Parameters<typeof setup>[0] = {}) {
  const harness = setup(options);
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  const socket = harness.socket();
  act(() => socket.open());
  return { ...harness, socket };
}

describe("useWebRTCMeeting", () => {
  it("trades the session for a ticket and connects to the ticket's wss url", async () => {
    const { view, requestTicket, socket } = await connect();
    expect(requestTicket).toHaveBeenCalledWith("room-1");
    expect(socket.url).toContain("ticket=signed-ticket");
    await waitFor(() => expect(view.result.current.status).toBe("connected"));
  });

  it("does not open a socket before the user joins", async () => {
    setup({ enabled: false });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("reports a failed start instead of throwing when the ticket cannot be minted", async () => {
    const onError = vi.fn();
    FakeSocket.instances = [];
    renderHook(() =>
      useWebRTCMeeting({
        meetingId: "room-1",
        enabled: true,
        localStream: null,
        onError,
        createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
        createPeerConnection: () => new FakePeerConnection() as unknown as RTCPeerConnection,
        createMediaStream: () => new FakeStream() as unknown as MediaStream,
        requestTicket: async () => {
          throw new Error("not a member");
        },
      }),
    );
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("not a member")));
  });

  it("adds the local camera and microphone tracks to every new peer", async () => {
    const { view, connections, socket } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-b")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(connections).toHaveLength(1));
    expect(view.result.current.remoteParticipants).toHaveLength(1);
    expect(connections[0].addedTracks.map((track) => track.kind).sort()).toEqual(["audio", "video"]);
  });

  it("lets only the lower connection id offer, so both peers never negotiate at once", async () => {
    const { connections, socket, view } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-b"), peers: [peer("conn-a")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(view.result.current.peerCount).toBe(1));
    // "conn-b" sorts after "conn-a", so this side must wait for the offer.
    expect(connections[0].createOffer).not.toHaveBeenCalled();

    act(() => socket.emit({ type: "peer-joined", peer: peer("conn-c") }));
    await waitFor(() => expect(view.result.current.peerCount).toBe(2));
    // "conn-b" sorts before "conn-c", so this side offers.
    await waitFor(() => expect(connections[1].createOffer).toHaveBeenCalledTimes(1));
    expect(connections[0].createOffer).not.toHaveBeenCalled();
  });

  it("sends the offer to the peer it negotiated for", async () => {
    const { socket } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-z")], ice_servers: TICKET.iceServers }));
    await waitFor(() =>
      expect(socket.sent.some((message) => message.type === "offer" && message.target === "conn-z")).toBe(true),
    );
    expect(socket.sent.find((message) => message.type === "offer")?.sdp).toEqual({ type: "offer", sdp: "offer-sdp" });
  });

  it("answers an incoming offer and returns the answer to the offerer", async () => {
    const { connections, socket } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-b"), peers: [], ice_servers: TICKET.iceServers }));
    act(() => socket.emit({ type: "offer", from: "conn-a", sdp: { type: "offer", sdp: "remote-offer" } }));
    await waitFor(() => expect(connections[0].createAnswer).toHaveBeenCalledTimes(1));
    expect(connections[0].remoteDescription).toEqual({ type: "offer", sdp: "remote-offer" });
    const answer = socket.sent.find((message) => message.type === "answer");
    expect(answer).toMatchObject({ target: "conn-a", sdp: { type: "answer", sdp: "answer-sdp" } });
  });

  it("buffers ICE that arrives before the remote description is set", async () => {
    const { connections, socket, view } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-b"), peers: [peer("conn-a")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(view.result.current.peerCount).toBe(1));

    // Hold the SDP application so the candidate lands mid-negotiation, which is
    // exactly the ordering a real socket produces when ICE is gathered fast.
    const release = connections[0].holdRemoteDescription();
    act(() => socket.emit({ type: "offer", from: "conn-a", sdp: { type: "offer", sdp: "remote-offer" } }));
    act(() => socket.emit({ type: "ice-candidate", from: "conn-a", candidate: { candidate: "candidate:1" } }));
    // A candidate cannot be applied before setRemoteDescription completes.
    expect(connections[0].appliedCandidates).toHaveLength(0);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(connections[0].appliedCandidates).toHaveLength(1));
    expect(connections[0].appliedCandidates[0]).toMatchObject({ candidate: "candidate:1" });
  });

  it("relays locally gathered ICE to the specific peer", async () => {
    const { connections, socket } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-z")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(connections[0].onicecandidate).toBeTypeOf("function"));
    act(() => connections[0].onicecandidate?.({ candidate: { toJSON: () => ({ candidate: "host-candidate" }) } }));
    expect(socket.sent.find((message) => message.type === "ice-candidate")).toMatchObject({
      target: "conn-z",
      candidate: { candidate: "host-candidate" },
    });
  });

  it("exposes the remote stream once tracks arrive", async () => {
    const { view, connections, socket } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-b")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(connections[0]).toBeDefined());
    const remoteStream = new FakeStream([new FakeTrack("video", "remote-video"), new FakeTrack("audio", "remote-audio")]);
    act(() => connections[0].emitRemoteTrack(remoteStream, new FakeTrack("video", "remote-video")));
    await waitFor(() => expect(view.result.current.remoteParticipants[0].stream).not.toBeNull());
    expect(view.result.current.remoteParticipants[0].stream?.getVideoTracks()).toHaveLength(1);
  });

  it("replaces the local track on an existing peer when media is swapped", async () => {
    FakeSocket.instances = [];
    const connections: FakePeerConnection[] = [];
    const first = new FakeStream([new FakeTrack("audio", "mic-1"), new FakeTrack("video", "cam-1")]);
    const second = new FakeStream([new FakeTrack("audio", "mic-2"), new FakeTrack("video", "cam-2")]);

    const view = renderHook(
      (props: { stream: FakeStream }) =>
        useWebRTCMeeting({
          meetingId: "room-1",
          enabled: true,
          localStream: props.stream as unknown as MediaStream,
          createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
          createPeerConnection: () => {
            const connection = new FakePeerConnection();
            connections.push(connection);
            return connection as unknown as RTCPeerConnection;
          },
          createMediaStream: () => new FakeStream() as unknown as MediaStream,
          requestTicket: async () => TICKET,
        }),
      { initialProps: { stream: first } },
    );
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    act(() => FakeSocket.instances[0].open());
    act(() => FakeSocket.instances[0].emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-z")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(connections[0].addedTracks).toHaveLength(2));

    view.rerender({ stream: second });
    await waitFor(() =>
      expect(connections[0].getSenders().map((sender) => sender.track?.id)).toEqual(["mic-2", "cam-2"]),
    );
    // A replaced track must not be added a second time or the peers would
    // renegotiate a duplicate sender.
    expect(connections[0].addedTracks).toHaveLength(2);
  });

  it("updates a remote participant's camera and microphone state", async () => {
    const { view, socket } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-b")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(view.result.current.remoteParticipants).toHaveLength(1));
    act(() => socket.emit({ type: "media-state", connection_id: "conn-b", audio_enabled: false, video_enabled: false, screen_sharing: true }));
    await waitFor(() =>
      expect(view.result.current.remoteParticipants[0]).toMatchObject({ audioEnabled: false, videoEnabled: false, screenSharing: true }),
    );
  });

  it("disables the real microphone track when the host mutes this participant", async () => {
    const onHostMuteChange = vi.fn();
    const localStream = new FakeStream([new FakeTrack("audio")]);
    const { socket } = await connect({ localStream, onHostMuteChange });
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [], ice_servers: TICKET.iceServers }));
    act(() => socket.emit({ type: "host-mute", muted: true }));
    expect(localStream.getAudioTracks()[0].enabled).toBe(false);
    expect(onHostMuteChange).toHaveBeenCalledWith(true);

    act(() => socket.emit({ type: "host-mute", muted: false }));
    expect(localStream.getAudioTracks()[0].enabled).toBe(true);
  });

  it("cleans up every peer and the socket when the host removes this participant", async () => {
    const onRemoved = vi.fn();
    const { connections, socket, view } = await connect({ onRemoved });
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-b")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(connections).toHaveLength(1));
    act(() => socket.emit({ type: "participant-removed" }));
    expect(onRemoved).toHaveBeenCalled();
    expect(view.result.current.remoteParticipants).toHaveLength(0);
    expect(connections[0].closed).toBe(true);
  });

  it("tells the room the meeting ended", async () => {
    const onEnded = vi.fn();
    const { socket } = await connect({ onEnded });
    act(() => socket.emit({ type: "meeting-ended" }));
    expect(onEnded).toHaveBeenCalled();
  });

  it("drops and closes a peer whose connection fails", async () => {
    const { view, connections, socket } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-b")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(view.result.current.remoteParticipants).toHaveLength(1));
    act(() => connections[0].emitConnectionState("failed"));
    await waitFor(() => expect(view.result.current.remoteParticipants).toHaveLength(0));
    expect(connections[0].closed).toBe(true);
  });

  it("removes a peer that leaves", async () => {
    const { view, connections, socket } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-b"), peer("conn-c")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(view.result.current.remoteParticipants).toHaveLength(2));
    act(() => socket.emit({ type: "peer-left", connection_id: "conn-b" }));
    await waitFor(() => expect(view.result.current.remoteParticipants).toHaveLength(1));
    expect(view.result.current.remoteParticipants[0].connectionId).toBe("conn-c");
    expect(connections[0].closed).toBe(true);
  });

  it("translates a protocol error into readable text", async () => {
    const onError = vi.fn();
    const { socket } = await connect({ onError });
    act(() => socket.emit({ type: "error", code: "UNKNOWN_TARGET" }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("participant left"));
  });

  it("ignores an unparseable frame instead of tearing the room down", async () => {
    const { view, socket } = await connect();
    act(() => socket.onmessage?.({ data: "not json" }));
    expect(view.result.current.status).toBe("connected");
  });

  it("does not negotiate with itself", async () => {
    const { connections, socket, view } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-a")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(view.result.current.peerCount).toBe(0));
    expect(connections).toHaveLength(0);
  });

  it("stops the socket and peers on unmount", async () => {
    const { connections, socket, view } = await connect();
    act(() => socket.emit({ type: "welcome", self: peer("conn-a"), peers: [peer("conn-b")], ice_servers: TICKET.iceServers }));
    await waitFor(() => expect(connections).toHaveLength(1));
    view.unmount();
    expect(connections[0].closed).toBe(true);
  });
});

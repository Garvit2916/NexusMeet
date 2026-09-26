import { describe, expect, it } from "vitest";
import {
  describeIceServers,
  formatDiagnosticLine,
  iceCandidateType,
  type PeerDiagnostic,
} from "@/lib/webrtc-diagnostics";

const PEER: PeerDiagnostic = {
  clientId: "c0pqghc",
  role: "guest",
  meetingId: "mtg_01c16c931cc2",
  selfConnectionId: "dR6-J4HnAQ",
  peerConnectionId: "",
  participantId: 0,
  peerName: "",
};

describe("formatDiagnosticLine", () => {
  it("labels the event, so a line can be read without knowing the caller", () => {
    const line = formatDiagnosticLine(PEER, "pair", "tOgzV0fAPD", "selected", {
      state: "succeeded",
    });
    expect(line).toContain("[webrtc] pair");
    expect(line).toContain("event=selected");
    expect(line).toContain("peer=tOgzV0fAPD");
    expect(line).toContain("self=dR6-J4HnAQ");
    expect(line).toContain("state=succeeded");
  });

  it("keeps the identity of both sides distinguishable", () => {
    const host = formatDiagnosticLine({ ...PEER, role: "host" }, "socket", "", "open");
    const guest = formatDiagnosticLine(PEER, "socket", "", "open");
    expect(host).toContain("role=host");
    expect(guest).toContain("role=guest");
  });

  it("shows a dash rather than an empty value before an id is known", () => {
    const line = formatDiagnosticLine({ ...PEER, selfConnectionId: null }, "socket", "", "connecting");
    expect(line).toContain("self=-");
    expect(line).toContain("peer=-");
  });

  it("omits absent detail instead of printing undefined", () => {
    const line = formatDiagnosticLine(PEER, "ice", "p", "remote-candidate", {
      type: "srflx",
      protocol: undefined,
    });
    expect(line).toContain("type=srflx");
    expect(line).not.toContain("undefined");
  });
});

describe("describeIceServers", () => {
  it("reports TURN and STUN presence without revealing the credential", () => {
    const report = describeIceServers([
      { urls: ["turn:turn.example.test:3478"], username: "ephemeral-user", credential: "ephemeral-secret" },
      { urls: ["stun:stun.example.test:19302"] },
    ]);

    expect(report).toBe("TURN(1),STUN(1)");
    expect(report).not.toContain("ephemeral-user");
    expect(report).not.toContain("ephemeral-secret");
    // Not even the provider hostname, which is unnecessary for the diagnosis.
    expect(report).not.toContain("turn.example.test");
  });

  it("distinguishes a TURN-only config from no configuration at all", () => {
    expect(describeIceServers([{ urls: ["turn:turn.example.test:3478"] }])).toBe("TURN(1)");
    expect(describeIceServers([])).toBe("none");
    expect(describeIceServers(undefined)).toBe("none");
  });
});

describe("the candidate-types diagnostic", () => {
  it("reports only the gathered types and whether a relay is in use", () => {
    const line = formatDiagnosticLine(PEER, "pair", "p", "candidate-types", {
      types: "host+srflx",
      hasRelay: false,
    });
    expect(line).toContain("types=host+srflx");
    expect(line).toContain("hasRelay=false");
  });

  it("makes a relay-backed call identifiable from the log alone", () => {
    const line = formatDiagnosticLine(PEER, "pair", "p", "candidate-types", {
      types: "host+srflx+relay",
      hasRelay: true,
    });
    expect(line).toContain("types=host+srflx+relay");
    expect(line).toContain("hasRelay=true");
  });
});

describe("iceCandidateType", () => {
  it("prefers the type the browser reports", () => {
    expect(iceCandidateType({ type: "relay" } as RTCIceCandidate)).toBe("relay");
    expect(iceCandidateType({ type: "srflx" } as RTCIceCandidate)).toBe("srflx");
  });

  it("derives the type from a candidate string received over the wire", () => {
    const relay = iceCandidateType({ candidate: "candidate:1 1 udp 2 relay 10.0.0.1 1 typ relay" });
    expect(relay).toBe("relay");
    const srflx = iceCandidateType({ candidate: "candidate:2 1 udp 2 srflx 1.2.3.4 5 typ srflx" });
    expect(srflx).toBe("srflx");
    const host = iceCandidateType({ candidate: "candidate:3 1 udp 2 host 192.168.1.9 9 typ host" });
    expect(host).toBe("host");
  });

  it("reports a missing candidate instead of guessing", () => {
    expect(iceCandidateType(null)).toBe("none");
    expect(iceCandidateType({} as RTCIceCandidateInit)).toBe("unknown");
  });
});

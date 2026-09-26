import { describe, expect, it } from "vitest";
import {
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

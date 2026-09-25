import { describe, expect, it } from "vitest";
import {
  buildSocketUrl,
  resolveIceServers,
  shouldInitiateOffer,
  SIGNALING_ERROR_MESSAGES,
  SIGNALING_STATUS_TEXT,
  type SignalingStatus,
} from "@/lib/signaling";

describe("shouldInitiateOffer", () => {
  it("picks exactly one side of a pair so negotiation never glares", () => {
    const self = "conn-a";
    const peer = "conn-b";
    expect(shouldInitiateOffer(self, peer)).toBe(true);
    expect(shouldInitiateOffer(peer, self)).toBe(false);
  });

  it("is stable regardless of who evaluates it", () => {
    const ids = ["conn-1", "conn-2", "conn-3"];
    for (const self of ids) {
      for (const peer of ids) {
        if (self === peer) continue;
        // Both browsers must reach the same answer for the same pair.
        expect(shouldInitiateOffer(self, peer)).toBe(!shouldInitiateOffer(peer, self));
      }
    }
  });

  it("never offers to itself", () => {
    expect(shouldInitiateOffer("conn-a", "conn-a")).toBe(false);
  });
});

describe("buildSocketUrl", () => {
  it("carries the ticket as a query parameter", () => {
    const url = buildSocketUrl("wss://nexusmeet-api.onrender.com/ws/meetings/room-1", "abc.def");
    expect(url).toBe("wss://nexusmeet-api.onrender.com/ws/meetings/room-1?ticket=abc.def");
  });

  it("preserves an existing query and escapes the ticket", () => {
    const url = buildSocketUrl("wss://example.test/ws?trace=1", "a b&c=d");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("trace")).toBe("1");
    expect(parsed.searchParams.get("ticket")).toBe("a b&c=d");
  });

  it("replaces a stale ticket rather than appending a second one", () => {
    const url = buildSocketUrl("wss://example.test/ws?ticket=old", "new");
    expect(new URL(url).searchParams.getAll("ticket")).toEqual(["new"]);
  });
});

describe("resolveIceServers", () => {
  it("uses the ticket servers first because they can carry TURN credentials", () => {
    const servers = resolveIceServers(
      [{ urls: "turn:turn.example.test:3478", username: "u", credential: "c" }],
      ["stun:stun.example.test:19302"],
    );
    expect(servers).toHaveLength(2);
    expect(servers[0].urls).toBe("turn:turn.example.test:3478");
    expect(servers[0].username).toBe("u");
  });

  it("falls back to build-time STUN when the ticket has none", () => {
    const servers = resolveIceServers([], ["stun:stun.example.test:19302"]);
    expect(servers).toEqual([{ urls: "stun:stun.example.test:19302" }]);
  });

  it("drops unusable entries so the browser is not given a broken server", () => {
    const servers = resolveIceServers([{ urls: [] }, { urls: "" }], ["stun:a.test"]);
    expect(servers).toEqual([{ urls: "stun:a.test" }]);
  });

  it("never hands WebRTC an empty list", () => {
    expect(resolveIceServers(undefined, [])).toEqual([]);
  });
});

describe("signaling copy", () => {
  it("has readable text for every status the room can show", () => {
    const statuses: SignalingStatus[] = ["idle", "connecting", "connected", "reconnecting", "closed", "failed"];
    for (const status of statuses) {
      expect(SIGNALING_STATUS_TEXT[status]).toBeTruthy();
    }
  });

  it("explains an undeliverable target instead of leaking a protocol code", () => {
    expect(SIGNALING_ERROR_MESSAGES.UNKNOWN_TARGET).toMatch(/participant left/i);
  });
});

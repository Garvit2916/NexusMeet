import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PERMISSION_BLOCKED_MESSAGE, useLocalMedia } from "@/hooks/use-local-media";

let permissionState: PermissionState = "prompt";

function stubPermissions(state: PermissionState) {
  permissionState = state;
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: vi.fn(async () => ({ state: permissionState }) as unknown as PermissionStatus),
    },
  });
}

class StubMediaStream {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks;
  }

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((candidate) => candidate.kind === "audio");
  }

  getVideoTracks() {
    return this.tracks.filter((candidate) => candidate.kind === "video");
  }
}

beforeAll(() => {
  // jsdom does not implement MediaStream, which the audio-only fallback path constructs.
  globalThis.MediaStream = StubMediaStream as unknown as typeof MediaStream;
});

function stubMediaDevices(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  });
}

function makeTrack(kind: "audio" | "video") {
  return { kind, enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack;
}

function stream(...kinds: Array<"audio" | "video">) {
  const tracks = kinds.map(makeTrack);
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((candidate) => candidate.kind === "audio"),
    getVideoTracks: () => tracks.filter((candidate) => candidate.kind === "video"),
  } as unknown as MediaStream;
}

describe("useLocalMedia", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a timeout instead of spinning forever when the permission prompt is never answered", async () => {
    vi.useFakeTimers();
    stubMediaDevices(() => new Promise<MediaStream>(() => undefined));

    const { result } = renderHook(() => useLocalMedia());
    await act(async () => {
      void result.current.start();
    });
    expect(result.current.isStarting).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    expect(result.current.isStarting).toBe(false);
    expect(result.current.error).toMatch(/timed out/i);
    expect(result.current.stream).toBeNull();
  });

  it("releases the camera when access is granted after the timeout", async () => {
    vi.useFakeTimers();
    const stopVideo = vi.fn();
    let resolveLate: ((granted: MediaStream) => void) | undefined;
    stubMediaDevices(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveLate = resolve;
        }),
    );

    const { result } = renderHook(() => useLocalMedia());
    await act(async () => {
      void result.current.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current.isStarting).toBe(false);

    const late = { getTracks: () => [{ stop: stopVideo }] } as unknown as MediaStream;
    await act(async () => {
      resolveLate?.(late);
      await Promise.resolve();
    });

    expect(stopVideo).toHaveBeenCalled();
  });

  it("falls back to audio only when the camera is unavailable", async () => {
    stubMediaDevices((constraints) =>
      constraints.video
        ? Promise.reject(new DOMException("denied", "NotAllowedError"))
        : Promise.resolve(stream("audio")),
    );

    const { result } = renderHook(() => useLocalMedia());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.isStarting).toBe(false);
    expect(result.current.stream).not.toBeNull();
    expect(result.current.micEnabled).toBe(true);
    expect(result.current.cameraEnabled).toBe(false);
    expect(result.current.error).toMatch(/camera access was blocked/i);
  });

  it("enables both devices when access is granted", async () => {
    stubMediaDevices(() => Promise.resolve(stream("audio", "video")));

    const { result } = renderHook(() => useLocalMedia());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.isStarting).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.micEnabled).toBe(true);
    expect(result.current.cameraEnabled).toBe(true);
  });

  it("reports a blocked site instead of prompting when permission was denied", async () => {
    stubPermissions("denied");
    const getUserMedia = vi.fn(() => Promise.resolve(stream("audio", "video")));
    stubMediaDevices(getUserMedia);

    const { result } = renderHook(() => useLocalMedia());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.permission).toBe("denied");
    expect(result.current.isStarting).toBe(false);
    expect(result.current.error).toBe(PERMISSION_BLOCKED_MESSAGE);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("prompts normally when the browser has not decided yet", async () => {
    stubPermissions("prompt");
    stubMediaDevices(() => Promise.resolve(stream("audio", "video")));

    const { result } = renderHook(() => useLocalMedia());
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.permission).toBe("prompt");
    expect(result.current.error).toBeNull();
    expect(result.current.stream).not.toBeNull();
  });

  it("clears the blocked message once the user allows access", async () => {
    stubPermissions("denied");
    stubMediaDevices(() => Promise.resolve(stream("audio", "video")));

    const { result } = renderHook(() => useLocalMedia());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error).toBe(PERMISSION_BLOCKED_MESSAGE);

    permissionState = "granted";
    await act(async () => {
      await result.current.refreshPermission();
    });

    expect(result.current.permission).toBe("granted");
    expect(result.current.error).toBeNull();
  });
});

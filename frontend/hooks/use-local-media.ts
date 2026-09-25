"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MediaPermissionState = "granted" | "denied" | "prompt" | "unsupported";

export type LocalMediaState = {
  stream: MediaStream | null;
  isStarting: boolean;
  isSupported: boolean;
  error: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  permission: MediaPermissionState;
};

const initialState: LocalMediaState = {
  stream: null,
  isStarting: false,
  isSupported: true,
  error: null,
  micEnabled: false,
  cameraEnabled: false,
  permission: "prompt",
};

function messageFor(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return fallback;
  if (error instanceof DOMException && error.name === "NotFoundError") return "No matching device was found.";
  return fallback;
}

const DEVICE_CHECK_TIMEOUT_MS = 15000;

const PERMISSION_PROMPT_TIMEOUT_MESSAGE =
  "Camera and microphone access timed out. Allow camera and microphone for this site in your browser, then check your devices again.";

export const PERMISSION_BLOCKED_MESSAGE =
  "Camera and microphone are blocked for this site. Open your browser's site settings, allow both, then reload this page.";

function isPermissionTimeout(error: unknown) {
  return error instanceof DOMException && error.name === "TimeoutError";
}

/**
 * Reads the browser's camera and microphone permission state. Deployed origins
 * require an explicit grant, so this is what distinguishes "not decided yet"
 * from "the user blocked this site".
 */
async function readMediaPermission(): Promise<MediaPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  const names = ["camera", "microphone"] as const;
  try {
    const statuses = await Promise.all(
      names.map((name) => navigator.permissions.query({ name } as unknown as PermissionDescriptor)),
    );
    if (statuses.some((status) => status.state === "denied")) return "denied";
    if (statuses.every((status) => status.state === "granted")) return "granted";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

function requestDevices(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const request = navigator.mediaDevices.getUserMedia(constraints);
  return new Promise<MediaStream>((resolve, reject) => {
    const timer = setTimeout(() => {
      request
        .then((granted) => granted.getTracks().forEach((track) => track.stop()))
        .catch(() => undefined);
      reject(new DOMException("Device access timed out", "TimeoutError"));
    }, DEVICE_CHECK_TIMEOUT_MS);
    request.then(
      (granted) => {
        clearTimeout(timer);
        resolve(granted);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function useLocalMedia() {
  const [state, setState] = useState<LocalMediaState>(initialState);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState((current) => ({ ...current, stream: null, micEnabled: false, cameraEnabled: false }));
  }, []);

  const refreshPermission = useCallback(async () => {
    const next = await readMediaPermission();
    setState((current) => {
      if (current.permission === next) return current;
      return {
        ...current,
        permission: next,
        // A site-level block is the real reason devices are unavailable, so say so
        // instead of leaving a stale "blocked" warning after access is restored.
        error: current.error === PERMISSION_BLOCKED_MESSAGE && next !== "denied" ? null : current.error,
      };
    });
    return next;
  }, []);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // The user grants access from browser settings while this tab is in the background,
    // so re-read the state whenever the tab becomes active again.
    const handleFocus = () => {
      void refreshPermission();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshPermission]);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState((current) => ({ ...current, isSupported: false, error: "Camera and microphone access is not available in this browser." }));
      return null;
    }

    const permission = await refreshPermission();
    if (permission === "denied") {
      setState((current) => ({ ...current, isStarting: false, stream: null, micEnabled: false, cameraEnabled: false, error: PERMISSION_BLOCKED_MESSAGE }));
      return null;
    }

    setState((current) => ({ ...current, isStarting: true, error: null }));
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    try {
      const stream = await requestDevices({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      setState((current) => ({
        ...current,
        stream,
        isStarting: false,
        error: null,
        micEnabled: stream.getAudioTracks().some((track) => track.enabled),
        cameraEnabled: stream.getVideoTracks().some((track) => track.enabled),
      }));
      return stream;
    } catch (combinedError) {
      if (isPermissionTimeout(combinedError)) {
        streamRef.current = null;
        setState((current) => ({ ...current, isStarting: false, stream: null, micEnabled: false, cameraEnabled: false, error: PERMISSION_PROMPT_TIMEOUT_MESSAGE }));
        return null;
      }
      const warnings: string[] = [];
      let videoStream: MediaStream | null = null;
      let audioStream: MediaStream | null = null;
      try {
        videoStream = await requestDevices({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
      } catch (error) {
        if (isPermissionTimeout(error)) {
          setState((current) => ({ ...current, isStarting: false, stream: null, micEnabled: false, cameraEnabled: false, error: PERMISSION_PROMPT_TIMEOUT_MESSAGE }));
          return null;
        }
        warnings.push(messageFor(error, "Camera access was blocked. You can continue without video."));
      }
      try {
        audioStream = await requestDevices({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (error) {
        if (isPermissionTimeout(error)) {
          setState((current) => ({ ...current, isStarting: false, stream: null, micEnabled: false, cameraEnabled: false, error: PERMISSION_PROMPT_TIMEOUT_MESSAGE }));
          return null;
        }
        warnings.push(messageFor(error, "Microphone access was blocked. You can continue with video only."));
      }
      const tracks = [...(videoStream?.getTracks() || []), ...(audioStream?.getTracks() || [])];
      if (!tracks.length) {
        setState((current) => ({ ...current, isStarting: false, stream: null, micEnabled: false, cameraEnabled: false, error: warnings[0] || messageFor(combinedError, "We could not access your camera or microphone.") }));
        return null;
      }
      const stream = new MediaStream(tracks);
      streamRef.current = stream;
      setState((current) => ({
        ...current,
        stream,
        isStarting: false,
        error: warnings.join(" ") || null,
        micEnabled: stream.getAudioTracks().some((track) => track.enabled),
        cameraEnabled: stream.getVideoTracks().some((track) => track.enabled),
      }));
      return stream;
    }
  }, [refreshPermission]);

  const toggleMic = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const nextEnabled = !state.micEnabled;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    setState((current) => ({ ...current, micEnabled: nextEnabled }));
  }, [state.micEnabled]);

  const toggleCamera = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const nextEnabled = !state.cameraEnabled;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    setState((current) => ({ ...current, cameraEnabled: nextEnabled }));
  }, [state.cameraEnabled]);

  /**
   * Sets an explicit state instead of toggling it. A host mute is pushed from
   * the server, so calling a toggle here could re-enable a track the host just
   * disabled.
   */
  const setMicEnabled = useCallback((enabled: boolean) => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    setState((current) => ({ ...current, micEnabled: enabled }));
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return { ...state, start, stop, toggleMic, toggleCamera, setMicEnabled, refreshPermission };
}

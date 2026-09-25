"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LocalMediaState = {
  stream: MediaStream | null;
  isStarting: boolean;
  isSupported: boolean;
  error: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
};

const initialState: LocalMediaState = {
  stream: null,
  isStarting: false,
  isSupported: true,
  error: null,
  micEnabled: false,
  cameraEnabled: false,
};

function messageFor(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return fallback;
  if (error instanceof DOMException && error.name === "NotFoundError") return "No matching device was found.";
  return fallback;
}

export function useLocalMedia() {
  const [state, setState] = useState<LocalMediaState>(initialState);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState((current) => ({ ...current, stream: null, micEnabled: false, cameraEnabled: false }));
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState((current) => ({ ...current, isSupported: false, error: "Camera and microphone access is not available in this browser." }));
      return null;
    }

    setState((current) => ({ ...current, isStarting: true, error: null }));
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
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
      const warnings: string[] = [];
      let videoStream: MediaStream | null = null;
      let audioStream: MediaStream | null = null;
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
      } catch (error) {
        warnings.push(messageFor(error, "Camera access was blocked. You can continue without video."));
      }
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (error) {
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
  }, []);

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

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return { ...state, start, stop, toggleMic, toggleCamera };
}

"use client";

import { useEffect, useRef } from "react";

export function LocalVideo({ stream, muted = true, className, ariaLabel = "Your camera preview" }: { stream: MediaStream | null; muted?: boolean; className?: string; ariaLabel?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return <video ref={videoRef} aria-label={ariaLabel} autoPlay playsInline muted={muted} className={className} />;
}

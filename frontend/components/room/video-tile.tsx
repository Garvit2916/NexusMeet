"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, VideoOff } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import type { RemoteMediaState } from "@/lib/signaling";

/**
 * One participant's live media.
 *
 * The element is a real `<video>` bound straight to the MediaStream that
 * WebRTC negotiated. Remote tiles are unmuted so inbound audio actually plays;
 * browsers may still block that until a gesture, so a rejected `play()` is
 * surfaced as a one-click "enable sound" control instead of silent audio.
 */
/**
 * `play()` is not implemented in every environment and older Safari returned
 * undefined instead of a promise, so normalise it before chaining.
 */
function safePlay(video: HTMLVideoElement): Promise<void> {
  const result = video.play() as Promise<void> | undefined;
  return result && typeof result.then === "function" ? result.catch(() => undefined) : Promise.resolve();
}

export function VideoTile({
  stream,
  name,
  initials,
  muted = false,
  audioEnabled,
  videoEnabled,
  isHost = false,
  isSelf = false,
  labelSuffix,
  tone = "mint",
  className,
  mediaState,
}: {
  stream: MediaStream | null;
  name: string;
  initials: string;
  muted?: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isHost?: boolean;
  isSelf?: boolean;
  labelSuffix?: string;
  tone?: "mint" | "coral" | "lilac";
  className?: string;
  /**
   * Supplied for remote peers, where the connection and track state is known.
   * Omitted for the local tile, where the stream is authoritative.
   */
  mediaState?: RemoteMediaState;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    setAudioBlocked(false);
    if (!stream) return;
    // Rejecting here means autoplay with sound was blocked, not that the
    // connection failed, so offer the gesture rather than an error.
    void safePlay(video).then(() => setAudioBlocked(!muted));
    return () => {
      video.srcObject = null;
    };
  }, [muted, stream]);

  const enableAudio = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    void safePlay(video).then(() => setAudioBlocked(false));
  }, []);

  // `Boolean(stream)` is always true once a peer exists, because the hook
  // creates an empty MediaStream up front. Only a real video track means the
  // tile may claim to be showing video.
  const hasVideoTrack = Boolean(
    typeof stream?.getVideoTracks === "function" ? stream.getVideoTracks().length : stream,
  );
  const resolvedState: RemoteMediaState =
    mediaState ??
    (hasVideoTrack && videoEnabled
      ? "live"
      : videoEnabled
        ? "connecting"
        : "camera-off");
  const hasVideo = resolvedState === "live";

  const statusCopy: Record<Exclude<RemoteMediaState, "live">, { label: string; icon: typeof VideoOff }> = {
    connecting: { label: "Connecting", icon: Loader2 },
    "camera-off": { label: "Camera off", icon: VideoOff },
    failed: { label: "Connection lost", icon: VideoOff },
  };

  return (
    <div
      className={cn(
        "relative flex min-h-[140px] items-center justify-center overflow-hidden rounded-xl bg-[#3b4046]",
        className,
      )}
      data-testid={`tile-${name}`}
      data-video={hasVideo ? "on" : "off"}
      data-audio={audioEnabled ? "on" : "off"}
    >
      <video
        ref={videoRef}
        aria-label={`${name} video`}
        autoPlay
        playsInline
        muted={muted}
        className={cn("h-full w-full object-cover", !hasVideo && "hidden")}
      />
      {!hasVideo ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#181a1d]">
          <Avatar initials={initials} name={name} size="lg" tone={tone} />
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-white/60">
            {(() => {
              const { icon: StatusIcon, label } = statusCopy[resolvedState as Exclude<RemoteMediaState, "live">];
              return (
                <>
                  <StatusIcon
                    className={cn("h-3.5 w-3.5", resolvedState === "connecting" && "animate-spin")}
                    aria-hidden="true"
                  />
                  {label}
                </>
              );
            })()}
          </p>
        </div>
      ) : null}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-lg bg-black/45 px-2.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
        {name}
        {isSelf ? <span className="font-normal text-white/50">(you)</span> : null}
        {isHost ? (
          <span className="rounded bg-mint/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            Host
          </span>
        ) : null}
        {labelSuffix ? <span className="text-coral">{labelSuffix}</span> : null}
      </div>
      <span
        className={cn(
          "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-lg",
          audioEnabled ? "bg-black/45 text-mint" : "bg-coral/85 text-white",
        )}
        title={audioEnabled ? "Microphone on" : "Microphone off"}
        aria-label={audioEnabled ? `${name} microphone on` : `${name} microphone off`}
      >
        {audioEnabled ? <Mic className="h-3 w-3" aria-hidden="true" /> : <MicOff className="h-3 w-3" aria-hidden="true" />}
      </span>
      {audioBlocked ? (
        <button
          type="button"
          onClick={enableAudio}
          className="absolute inset-x-2 bottom-10 rounded-lg bg-black/70 px-2 py-1.5 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/85"
        >
          Click to enable sound
        </button>
      ) : null}
    </div>
  );
}

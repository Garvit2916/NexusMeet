"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Camera, CameraOff, CheckCircle2, Mic, MicOff, RefreshCw, ShieldCheck, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineLoading } from "@/components/ui/loading";
import { LocalVideo } from "@/components/room/local-video";
import type { LocalMediaState } from "@/hooks/use-local-media";
import type { Meeting } from "@/lib/types";

type PrejoinScreenProps = {
  meeting: Meeting;
  media: LocalMediaState & { start: () => Promise<MediaStream | null>; stop: () => void; toggleMic: () => void; toggleCamera: () => void };
  defaultDisplayName: string;
  initials: string;
  onJoin: (displayName: string) => Promise<void>;
  onLeave: () => void;
  joinError?: string | null;
  isJoining?: boolean;
  canJoin?: boolean;
};

function MediaToggle({ active, disabled, label, onClick, children }: { active: boolean; disabled: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-white text-[#202124]" : "bg-white/10 text-white hover:bg-white/15"}`} aria-pressed={active} aria-label={label}>{children}</button>;
}

export function PrejoinScreen({ meeting, media, defaultDisplayName, initials, onJoin, onLeave, joinError, isJoining, canJoin = true }: PrejoinScreenProps) {
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [nameError, setNameError] = useState<string | null>(null);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = displayName.trim();
    if (normalizedName.length < 2) {
      setNameError("Enter a display name with at least 2 characters.");
      return;
    }
    setNameError(null);
    await onJoin(normalizedName);
  }

  return (
    <div className="min-h-screen bg-[#202124] px-5 py-5 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint text-white"><Video className="h-[18px] w-[18px]" aria-hidden="true" /></span><div className="min-w-0"><p className="truncate text-sm font-bold">NexusMeet</p><p className="truncate text-xs text-white/45">{meeting.title}</p></div></div>
          <div className="flex items-center gap-4"><span className="hidden text-xs font-medium text-white/45 sm:block">Pre-join lobby</span><button type="button" onClick={onLeave} className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-white/65 transition hover:bg-white/10 hover:text-white" aria-label="Leave meeting"><X className="h-4 w-4" aria-hidden="true" />Leave</button></div>
        </header>

        <main className="grid items-center gap-6 py-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:py-12">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#2d3136] p-2 shadow-2xl sm:p-3">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-[#181a1d]">
              <LocalVideo stream={media.stream} className="h-full w-full object-cover" />
              {!media.stream ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="flex h-20 w-20 items-center justify-center rounded-full bg-mint text-2xl font-bold text-white">{initials}</span><p className="mt-4 text-sm font-bold text-white/85">Camera preview unavailable</p><p className="mt-1 text-xs text-white/40">You can still join with your microphone.</p></div> : null}
              {media.stream && !media.cameraEnabled ? <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#181a1d]"><span className="flex h-20 w-20 items-center justify-center rounded-full bg-mint text-2xl font-bold text-white">{initials}</span><p className="mt-4 text-sm font-bold text-white/85">Your camera is off</p></div> : null}
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/40 px-2.5 py-1.5 text-xs font-semibold backdrop-blur"><span className="h-1.5 w-1.5 rounded-full bg-mint" />You</div>
              <div className="absolute right-3 top-3 rounded-lg bg-black/35 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 backdrop-blur">Camera preview</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-1 pt-4">
              <div className="flex flex-wrap gap-2">
                <MediaToggle active={media.micEnabled} disabled={!media.stream} label={media.micEnabled ? "Mute microphone" : "Unmute microphone"} onClick={media.toggleMic}>{media.micEnabled ? <Mic className="h-4 w-4" aria-hidden="true" /> : <MicOff className="h-4 w-4" aria-hidden="true" />}{media.micEnabled ? "Mic on" : "Mic off"}</MediaToggle>
                <MediaToggle active={media.cameraEnabled} disabled={!media.stream} label={media.cameraEnabled ? "Turn camera off" : "Turn camera on"} onClick={media.toggleCamera}>{media.cameraEnabled ? <Camera className="h-4 w-4" aria-hidden="true" /> : <CameraOff className="h-4 w-4" aria-hidden="true" />}{media.cameraEnabled ? "Camera on" : "Camera off"}</MediaToggle>
              </div>
              <span className="text-xs font-medium text-white/40">{media.stream ? "Devices connected" : "Devices not connected"}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#2d3136] p-6 sm:p-7">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-mint"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span><div><h1 className="text-lg font-bold">Ready to join?</h1><p className="mt-1 text-xs text-white/45">Check your setup before entering.</p></div></div>
            <div className="mt-7 space-y-3 text-sm text-white/70"><p className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-mint" aria-hidden="true" />Check your camera and microphone</p><p className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-mint" aria-hidden="true" />Review your display name</p><p className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-mint" aria-hidden="true" />Join when you feel ready</p></div>
            <form onSubmit={handleJoin} className="mt-8 space-y-4">
              <div><label htmlFor="display-name" className="mb-2 block text-xs font-semibold text-white/60">Your display name</label><input id="display-name" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setNameError(null); }} maxLength={100} autoComplete="name" className="h-11 w-full rounded-xl border border-white/15 bg-white/10 px-3.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-mint" placeholder="How should others see you?" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "display-name-error" : undefined} />{nameError ? <p id="display-name-error" className="mt-2 text-xs font-semibold text-[#ffb4b7]" role="alert">{nameError}</p> : null}</div>
              <div className="flex flex-col gap-2 sm:flex-row"><Button type="button" variant="ghost" onClick={() => void media.start()} disabled={media.isStarting || !media.isSupported} className="h-11 flex-1 text-white hover:bg-white/10 hover:text-white">{media.isStarting ? <InlineLoading label="Checking devices" /> : <><RefreshCw className="h-4 w-4" aria-hidden="true" />Check devices</>}</Button><Button type="submit" disabled={isJoining || !canJoin} className="h-11 flex-1 bg-mint text-white hover:bg-mint-dark">{isJoining ? <InlineLoading label="Joining" /> : <><Video className="h-4 w-4" aria-hidden="true" />Join meeting</>}</Button></div>
            </form>
            {!canJoin ? <p className="mt-5 rounded-xl border border-[#f5b544]/30 bg-[#f5b544]/10 p-3 text-xs leading-5 text-[#ffe5a0]" role="status">This meeting is not open for joining yet. Return to the meeting details or try again when it starts.</p> : null}
            {joinError ? <div className="mt-5 flex items-start gap-3 rounded-xl border border-coral/30 bg-coral/10 p-3 text-sm text-[#ffb4b7]" role="alert"><CameraOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>{joinError}</p></div> : null}
            {media.error ? <div className="mt-5 flex items-start gap-3 rounded-xl border border-coral/30 bg-coral/10 p-3 text-sm text-[#ffb4b7]" role="alert"><CameraOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>{media.error}</p></div> : null}
            <p className="mt-5 flex items-center gap-2 text-xs text-white/35"><CheckCircle2 className="h-4 w-4 text-mint" aria-hidden="true" />Only you can see this preview.</p>
          </div>
        </main>
      </div>
    </div>
  );
}

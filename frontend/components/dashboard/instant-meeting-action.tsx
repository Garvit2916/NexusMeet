"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, LoaderCircle, Video } from "lucide-react";
import { meetingService } from "@/services/meeting-service";
import { cn } from "@/lib/cn";

export function InstantMeetingAction({ className }: { className?: string }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setError(null);
    setIsCreating(true);
    try {
      const meeting = await meetingService.createInstantMeeting();
      router.push(`/meeting/${meeting.id}`);
    } catch {
      setError("We could not create the room. Try again.");
      setIsCreating(false);
    }
  }

  return (
    <div className={cn("group relative overflow-hidden rounded-2xl border border-mint/20 bg-mint p-5 text-white shadow-[0_10px_24px_rgba(45,140,255,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(45,140,255,0.25)]", className)}>
      <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15"><Video className="h-5 w-5" aria-hidden="true" /></span><ArrowUpRight className="h-5 w-5 text-white/70 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></div>
      <h2 className="relative mt-6 text-base font-bold">Start an instant meeting</h2>
      <p className="relative mt-1.5 text-sm leading-5 text-white/75">Open a room now and invite people when you’re ready.</p>
      <button type="button" onClick={() => void createRoom()} disabled={isCreating} className="relative mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-mint-dark transition hover:bg-[#f0f6ff] disabled:cursor-not-allowed disabled:opacity-70">{isCreating ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />Creating room…</> : <>Start meeting <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></>}</button>
      {error ? <p className="relative mt-2 text-xs font-semibold text-white" role="alert">{error}</p> : null}
    </div>
  );
}

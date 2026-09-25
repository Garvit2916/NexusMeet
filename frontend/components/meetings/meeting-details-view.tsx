"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, CalendarPlus, Check, Clipboard, Download, ExternalLink, LockKeyhole, MapPin, Video } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { useMeeting } from "@/hooks/use-meeting";
import { buildCalendarFile } from "@/lib/meeting-utils";
import { formatDuration, formatMeetingDate, formatMeetingRange, formatMeetingWeekday } from "@/lib/date";
import type { Meeting } from "@/lib/types";
import { useAuth } from "@/providers/auth-provider";

function meetingStatusTone(status: Meeting["status"]) {
  if (status === "live") return "mint" as const;
  if (status === "ended") return "slate" as const;
  if (status === "cancelled") return "coral" as const;
  return "sun" as const;
}

function meetingStatusLabel(status: Meeting["status"]) {
  if (status === "live") return "Live now";
  if (status === "ended") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Upcoming";
}

export function MeetingDetailsView({ meetingId }: { meetingId: string }) {
  const { user } = useAuth();
  const { meeting, status, error, refresh } = useMeeting(meetingId);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const inviteUrl = useMemo(() => {
    if (!meeting) return "";
    if (meeting.joinUrl.startsWith("http")) return meeting.joinUrl;
    return typeof window === "undefined" ? meeting.joinUrl : `${window.location.origin}${meeting.joinUrl}`;
  }, [meeting]);

  async function copyInvite() {
    if (!inviteUrl) return;
    const copyWithFallback = () => {
      const textarea = document.createElement("textarea");
      textarea.value = inviteUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copiedWithCommand = document.execCommand("copy");
      textarea.remove();
      if (!copiedWithCommand) throw new Error("Copy command failed");
    };
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(inviteUrl);
        } catch {
          copyWithFallback();
        }
      } else {
        copyWithFallback();
      }
      setCopied(true);
      setNotice("Invite link copied");
      window.setTimeout(() => { setCopied(false); setNotice(null); }, 2500);
    } catch {
      setNotice("Copy failed — select the link manually.");
    }
  }

  function downloadInvite() {
    if (!meeting) return;
    const content = buildCalendarFile({ title: meeting.title, description: meeting.description, startTime: meeting.startTime, endTime: meeting.endTime, joinUrl: inviteUrl });
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Calendar file downloaded");
    window.setTimeout(() => setNotice(null), 2500);
  }

  if (status === "loading") return <div className="min-h-screen bg-canvas"><LoadingState label="Opening meeting details" /></div>;
  if (status === "error" || !meeting) return <div className="min-h-screen bg-canvas px-5 py-16"><ErrorState message={error ?? "This meeting could not be found."} onRetry={() => void refresh()} /></div>;

  const scheduledTimeReached = meeting.status === "upcoming" && new Date(meeting.startTime).getTime() <= Date.now();
  const canJoin = meeting.status === "live" || (meeting.status === "upcoming" && (meeting.host.id === user?.id || scheduledTimeReached));

  return (
    <div className="min-h-screen bg-canvas px-5 py-7 text-ink sm:px-8 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6 animate-float-in">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-muted transition hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to overview</Link>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
          <div className="space-y-5">
            <section className="relative overflow-hidden rounded-2xl bg-ink p-6 text-white shadow-soft sm:p-9">
              <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-mint/20 blur-3xl" />
              <div className="relative"><div className="flex flex-wrap items-center gap-2"><Badge tone={meetingStatusTone(meeting.status)}>{meetingStatusLabel(meeting.status)}</Badge><span className="text-xs font-semibold text-white/50">Meeting ID · {meeting.meetingCode}</span></div><h1 className="mt-6 max-w-2xl text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">{meeting.title}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-white/60">{meeting.description || "Join the room when you’re ready."}</p><div className="mt-7 flex flex-wrap gap-3"><Link href={canJoin ? `/meeting/${meeting.id}/room` : "/dashboard"} className="inline-flex h-11 items-center gap-2 rounded-xl bg-mint px-5 text-sm font-bold text-white transition hover:bg-mint-dark">{canJoin ? <><Video className="h-4 w-4" aria-hidden="true" />{meeting.status === "live" ? "Join room" : "Enter meeting"}</> : <><CalendarPlus className="h-4 w-4" aria-hidden="true" />Back to calendar</>}</Link><Button variant="ghost" onClick={() => void copyInvite()} className="text-white hover:bg-white/10 hover:text-white">{copied ? <Check className="h-4 w-4 text-mint" aria-hidden="true" /> : <Clipboard className="h-4 w-4" aria-hidden="true" />}{copied ? "Copied" : "Copy invite"}</Button></div></div>
            </section>
            <section className="rounded-2xl border border-line bg-white p-6 shadow-card sm:p-7"><div className="mb-6 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-mint-dark">When</p><h2 className="mt-1 text-lg font-bold text-ink">Meeting time</h2></div><CalendarPlus className="h-5 w-5 text-muted" aria-hidden="true" /></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-canvas p-4"><p className="text-xs font-semibold text-muted">Date</p><p className="mt-2 text-sm font-bold text-ink">{formatMeetingDate(meeting.startTime)}</p><p className="mt-1 text-xs text-muted">{formatMeetingWeekday(meeting.startTime)}</p></div><div className="rounded-xl bg-canvas p-4"><p className="text-xs font-semibold text-muted">Time</p><p className="mt-2 text-sm font-bold text-ink">{formatMeetingRange(meeting.startTime, meeting.endTime)}</p><p className="mt-1 text-xs text-muted">{formatDuration(meeting.startTime, meeting.endTime)}</p></div><div className="rounded-xl bg-canvas p-4"><p className="text-xs font-semibold text-muted">Timezone</p><p className="mt-2 text-sm font-bold text-ink">{meeting.timezone.replace("_", " ")}</p><p className="mt-1 inline-flex items-center gap-1 text-xs text-mint-dark"><MapPin className="h-3 w-3" aria-hidden="true" />Your local time</p></div></div><div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5"><Button variant="secondary" size="sm" onClick={downloadInvite}><Download className="h-4 w-4" aria-hidden="true" />Add to calendar</Button><a href={inviteUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted transition hover:bg-canvas hover:text-ink">Open invite <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a></div></section>
          </div>
          <aside className="space-y-5">
            <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-mint-dark">Invite</p><h2 className="mt-1 text-lg font-bold text-ink">Bring the right people</h2></div><LockKeyhole className="h-5 w-5 text-muted" aria-hidden="true" /></div><p className="mt-4 text-sm leading-6 text-muted">Share this private link with your guests. Anyone with it can request access to the room.</p><div className="mt-5 flex items-center gap-2 rounded-xl border border-line bg-canvas p-2"><input aria-label="Meeting invite link" readOnly value={inviteUrl} className="min-w-0 flex-1 bg-transparent px-2 text-xs text-muted outline-none" /><button type="button" onClick={() => void copyInvite()} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-ink shadow-card transition hover:text-mint-dark" aria-label="Copy meeting invite link">{copied ? <Check className="h-3.5 w-3.5 text-mint-dark" aria-hidden="true" /> : <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button></div><div className="mt-3 flex items-center gap-2 text-xs text-muted"><span className="h-2 w-2 rounded-full bg-mint" />Room is private until you share it</div></section>
            <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-mint-dark">People</p><h2 className="mt-1 text-lg font-bold text-ink">Participants</h2></div><span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-bold text-muted">{meeting.participants.length}</span></div><div className="mt-5 space-y-3">{meeting.participants.map((participant, index) => <div key={participant.id} className="flex items-center gap-3"><Avatar initials={participant.initials} name={participant.name} size="sm" tone={index % 3 === 0 ? "mint" : index % 3 === 1 ? "coral" : "lilac"} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{participant.name}{participant.userId === meeting.host.id ? <span className="ml-1 font-normal text-muted">(host)</span> : null}</p><p className="truncate text-[11px] text-muted">{participant.email}</p></div><span className={`h-2 w-2 rounded-full ${participant.isOnline ? "bg-mint" : "bg-line"}`} title={participant.isOnline ? "Online" : "Not in room yet"} /></div>)}</div></section>
            <div className="flex items-start gap-3 rounded-xl border border-sun/35 bg-[#fffaf0] p-4 text-sm text-[#80621d]"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>Keep this link somewhere safe. Anyone who has it can see the meeting details.</p></div>
          </aside>
        </div>
        {notice ? <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white shadow-float" role="status">{notice}</div> : null}
      </div>
    </div>
  );
}

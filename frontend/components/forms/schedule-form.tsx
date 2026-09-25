"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, Clock3, FileText, Mail, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineLoading } from "@/components/ui/loading";
import { meetingService } from "@/services/meeting-service";
import { toDateTimeLocal } from "@/lib/date";
import type { CreateMeetingInput } from "@/lib/types";

function localStartFromNow(minutes = 30) {
  const value = new Date(Date.now() + minutes * 60000);
  value.setSeconds(0, 0);
  return value;
}

export function ScheduleForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quick = searchParams.get("quick") === "1";
  const defaultStart = useMemo(() => localStartFromNow(quick ? 5 : 60), [quick]);
  const [title, setTitle] = useState(quick ? "Quick room" : "");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(toDateTimeLocal(defaultStart));
  const [duration, setDuration] = useState("30");
  const [inviteEmails, setInviteEmails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (quick) setTitle((current) => current || "Quick room");
  }, [quick]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Give your meeting a name so guests know what to expect.");
      return;
    }
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) {
      setError("Choose a valid date and time.");
      return;
    }
    const durationMinutes = Number(duration);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
      setError("Choose a duration between 15 minutes and 8 hours.");
      return;
    }
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
    const emails = [...new Set(inviteEmails.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError("Check the invite emails and try again.");
      return;
    }

    setIsSaving(true);
    try {
      const payload: CreateMeetingInput = {
        title: trimmedTitle,
        description: description.trim(),
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
        inviteEmails: emails,
      };
      const meeting = await meetingService.createMeeting(payload);
      router.push(`/meeting/${meeting.id}`);
    } catch {
      setError("We could not create that meeting. Please try again.");
      setIsSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <section className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7">
        <div className="mb-6 flex items-center gap-3 border-b border-line pb-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky text-mint-dark"><FileText className="h-5 w-5" aria-hidden="true" /></span>
          <div><h2 className="text-base font-bold text-ink">Meeting details</h2><p className="mt-1 text-xs text-muted">Give people enough context to arrive prepared.</p></div>
        </div>
        <div className="grid gap-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="meeting-title">Meeting name <span className="text-coral">*</span></label>
            <input id="meeting-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Product design review" className="h-11 w-full rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink placeholder:text-muted/70 focus:border-mint focus:bg-white focus:outline-none" aria-required="true" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="meeting-description">Description <span className="font-normal text-muted">(optional)</span></label>
            <textarea id="meeting-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What will you make space for?" rows={3} className="w-full resize-none rounded-xl border border-line bg-canvas px-3.5 py-3 text-sm leading-6 text-ink placeholder:text-muted/70 focus:border-mint focus:bg-white focus:outline-none" />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7">
        <div className="mb-6 flex items-center gap-3 border-b border-line pb-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff4d9] text-[#8a6416]"><CalendarDays className="h-5 w-5" aria-hidden="true" /></span>
          <div><h2 className="text-base font-bold text-ink">Date and time</h2><p className="mt-1 text-xs text-muted">Your local timezone is used automatically.</p></div>
        </div>
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="meeting-start">Start time</label>
            <div className="relative"><Clock3 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" /><input id="meeting-start" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="h-11 w-full rounded-xl border border-line bg-canvas pl-10 pr-3.5 text-sm text-ink focus:border-mint focus:bg-white focus:outline-none" /></div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="meeting-duration">Duration</label>
            <select id="meeting-duration" value={duration} onChange={(event) => setDuration(event.target.value)} className="h-11 w-full rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink focus:border-mint focus:bg-white focus:outline-none">
              <option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option>
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone || "your local timezone"}</p>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7">
        <div className="mb-6 flex items-center gap-3 border-b border-line pb-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-lilac text-[#5a4eb1]"><UsersRound className="h-5 w-5" aria-hidden="true" /></span>
          <div><h2 className="text-base font-bold text-ink">Invite people</h2><p className="mt-1 text-xs text-muted">Add email addresses separated by commas or spaces.</p></div>
        </div>
        <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="meeting-invites">Invite guests <span className="font-normal text-muted">(optional)</span></label>
        <div className="relative"><Mail className="pointer-events-none absolute left-3.5 top-4 h-4 w-4 text-muted" aria-hidden="true" /><textarea id="meeting-invites" value={inviteEmails} onChange={(event) => setInviteEmails(event.target.value)} placeholder="maya@company.com, noah@company.com" rows={2} className="w-full resize-none rounded-xl border border-line bg-canvas py-3 pl-10 pr-3.5 text-sm leading-6 text-ink placeholder:text-muted/70 focus:border-mint focus:bg-white focus:outline-none" /></div>
      </section>

      {error ? <div className="rounded-xl border border-coral/25 bg-[#fff8f8] px-4 py-3 text-sm font-medium text-[#a9363b]" role="alert">{error}</div> : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted">You can copy the invite link after creating the meeting.</p>
        <Button type="submit" size="lg" disabled={isSaving} className="w-full sm:w-auto">{isSaving ? <InlineLoading label="Creating meeting" /> : <><Check className="h-4 w-4" aria-hidden="true" />Create meeting</>}</Button>
      </div>
    </form>
  );
}

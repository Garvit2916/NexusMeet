"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildCalendarFile, buildGoogleCalendarUrl, buildOutlookCalendarUrl, calendarFileName } from "@/lib/calendar";
import type { Meeting } from "@/lib/types";

type CalendarLinksProps = {
  meeting: Meeting;
  inviteUrl: string;
  onNotice?: (message: string) => void;
};

const linkClass = "inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-sm font-semibold text-ink transition hover:border-mint/50 hover:bg-sky/40";

export function CalendarLinks({ meeting, inviteUrl, onNotice }: CalendarLinksProps) {
  const [downloaded, setDownloaded] = useState(false);

  const event = useMemo(
    () => ({
      meetingId: meeting.id,
      title: meeting.title,
      description: meeting.description,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      joinUrl: inviteUrl,
      timezone: meeting.timezone,
      organizerName: meeting.host.name,
      organizerEmail: meeting.host.email,
    }),
    [meeting, inviteUrl],
  );

  const googleUrl = useMemo(() => buildGoogleCalendarUrl(event), [event]);
  const outlookUrl = useMemo(() => buildOutlookCalendarUrl(event), [event]);

  function downloadFile() {
    const content = buildCalendarFile(event);
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = calendarFileName(meeting.title);
    anchor.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    onNotice?.("Calendar file downloaded");
    window.setTimeout(() => setDownloaded(false), 2500);
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant="secondary" size="sm" onClick={downloadFile} aria-label="Download calendar file">
        <Download className="h-4 w-4" aria-hidden="true" />
        {downloaded ? "Downloaded" : "Download .ics"}
      </Button>
      <a className={linkClass} href={googleUrl} target="_blank" rel="noreferrer" aria-label="Add to Google Calendar">
        <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        Google
        <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
      </a>
      <a className={linkClass} href={outlookUrl} target="_blank" rel="noreferrer" aria-label="Add to Outlook">
        <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        Outlook
        <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
      </a>
    </div>
  );
}

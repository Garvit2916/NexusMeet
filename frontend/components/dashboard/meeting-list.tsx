import Link from "next/link";
import { CalendarDays, ChevronRight, Clock3, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { formatDuration, formatMeetingRange, formatRelativeMeetingDate } from "@/lib/date";
import type { Meeting } from "@/lib/types";

function statusTone(status: Meeting["status"]) {
  if (status === "live") return "mint" as const;
  if (status === "ended") return "slate" as const;
  if (status === "cancelled") return "coral" as const;
  return "sun" as const;
}

function statusLabel(status: Meeting["status"]) {
  if (status === "live") return "Live now";
  if (status === "ended") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Upcoming";
}

export function MeetingList({ meetings, emptyMessage = "Your next conversation will appear here." }: { meetings: Meeting[]; emptyMessage?: string }) {
  if (!meetings.length) {
    return <div className="rounded-2xl border border-dashed border-line bg-white px-5 py-10 text-center text-sm text-muted">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-2.5">
      {meetings.map((meeting) => {
        const onlineCount = meeting.participants.filter((participant) => participant.isOnline).length;
        return (
          <Link key={meeting.id} href={`/meeting/${meeting.id}`} className="group flex flex-col gap-4 rounded-2xl border border-line bg-white p-4 transition hover:border-mint/40 hover:shadow-card sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[#f0f6ff] text-mint-dark">
                <span className="text-[10px] font-bold uppercase">{new Date(meeting.startTime).toLocaleDateString("en-US", { month: "short" })}</span>
                <span className="text-lg font-extrabold leading-5">{new Date(meeting.startTime).getDate()}</span>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-bold text-ink sm:text-base">{meeting.title}</h3>
                  <Badge tone={statusTone(meeting.status)}>{statusLabel(meeting.status)}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{formatRelativeMeetingDate(meeting.startTime)}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{formatMeetingRange(meeting.startTime, meeting.endTime)}</span>
                  <span className="hidden items-center gap-1 md:inline-flex"><UsersRound className="h-3.5 w-3.5" aria-hidden="true" />{onlineCount || meeting.participants.length} guests · {formatDuration(meeting.startTime, meeting.endTime)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <div className="flex -space-x-2" aria-label={`${meeting.participants.length} participants`}>
                {meeting.participants.slice(0, 3).map((participant, index) => <Avatar key={participant.id} initials={participant.initials} name={participant.name} size="sm" tone={index % 2 ? "coral" : "mint"} className="ring-2 ring-white" />)}
                {meeting.participants.length > 3 ? <span className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas text-[10px] font-bold text-muted ring-2 ring-white">+{meeting.participants.length - 3}</span> : null}
              </div>
              <ChevronRight className="h-5 w-5 text-muted transition group-hover:translate-x-1 group-hover:text-mint" aria-hidden="true" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

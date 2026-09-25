"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, Clock3, Link2, UsersRound } from "lucide-react";
import { ActionCard } from "@/components/dashboard/action-card";
import { InstantMeetingAction } from "@/components/dashboard/instant-meeting-action";
import { MeetingList } from "@/components/dashboard/meeting-list";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { SectionHeading } from "@/components/ui/section-heading";
import { useMeetings } from "@/hooks/use-meetings";
import { useCurrentUser } from "@/providers/current-user-provider";

export function DashboardView() {
  const { user } = useCurrentUser();
  const { meetings, status, error, refresh } = useMeetings();
  const searchParams = useSearchParams();
  const query = searchParams.get("query")?.trim() ?? "";
  const visibleMeetings = query ? meetings.filter((meeting) => `${meeting.title} ${meeting.description}`.toLowerCase().includes(query.toLowerCase())) : meetings;
  const upcoming = visibleMeetings.filter((meeting) => meeting.status === "upcoming" || meeting.status === "live");
  const recent = visibleMeetings.filter((meeting) => meeting.status === "ended" || meeting.status === "cancelled");
  const firstName = user.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-7xl space-y-7 animate-float-in">
      <SectionHeading
        eyebrow="Your workspace"
        title={`Welcome back, ${firstName}.`}
        description="Keep your next conversation easy to find and your meetings ready to go."
        action={<Link href="/schedule" className="hidden h-10 items-center gap-2 rounded-xl bg-mint px-4 text-sm font-bold text-white shadow-[0_6px_16px_rgba(45,140,255,0.2)] transition hover:bg-mint-dark sm:inline-flex"><CalendarPlus className="h-4 w-4" aria-hidden="true" />New meeting</Link>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr_0.85fr]">
        <InstantMeetingAction />
        <ActionCard href="/join" label="Join with a link" description="Paste an invite and step into the conversation." icon={<Link2 className="h-5 w-5" aria-hidden="true" />} tone="coral" />
        <ActionCard href="/schedule" label="Schedule a meeting" description="Find a time, add people, and send the invite." icon={<CalendarPlus className="h-5 w-5" aria-hidden="true" />} tone="lilac" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-sm text-muted">Next up</span><Clock3 className="h-5 w-5 text-mint" aria-hidden="true" /></div>
          <p className="mt-4 text-2xl font-extrabold tracking-tight text-ink">{upcoming.length}</p>
          <p className="mt-1 text-xs text-muted">conversations on the horizon</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-sm text-muted">People invited</span><UsersRound className="h-5 w-5 text-mint" aria-hidden="true" /></div>
          <p className="mt-4 text-2xl font-extrabold tracking-tight text-ink">{new Set(meetings.flatMap((meeting) => meeting.participants.map((participant) => participant.userId))).size}</p>
          <p className="mt-1 text-xs text-muted">in your meeting circle</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-sm text-muted">Completed</span><span className="h-2.5 w-2.5 rounded-full bg-sun" /></div>
          <p className="mt-4 text-2xl font-extrabold tracking-tight text-ink">{recent.length}</p>
          <p className="mt-1 text-xs text-muted">recent conversations logged</p>
        </div>
      </div>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <section>
          <div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-mint-dark">Your calendar</p><h2 className="mt-1 text-xl font-bold text-ink">Upcoming meetings</h2></div><Link href="/schedule" className="text-xs font-bold text-mint-dark hover:underline">Schedule new</Link></div>
          {status === "loading" ? <LoadingState label="Loading your calendar" /> : status === "error" ? <ErrorState message={error ?? undefined} onRetry={() => void refresh()} /> : upcoming.length ? <MeetingList meetings={upcoming} /> : <EmptyState icon={<CalendarPlus className="h-6 w-6" />} title="Your calendar is clear" description="You have no upcoming meetings. Make space for the next good idea." action={<Link href="/schedule" className="inline-flex h-10 items-center justify-center rounded-xl bg-mint px-4 text-sm font-bold text-white transition hover:bg-mint-dark">Schedule a meeting</Link>} />}
        </section>
        <section>
          <div className="mb-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Meeting history</p><h2 className="mt-1 text-xl font-bold text-ink">Recently completed</h2></div>
          {status === "loading" ? <LoadingState label="Loading history" /> : recent.length ? <MeetingList meetings={recent} emptyMessage="Your completed meetings will live here." /> : <EmptyState icon={<Clock3 className="h-6 w-6" />} title="No recent meetings" description="Completed conversations will stay here for easy reference." />}
        </section>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { CalendarDays, Clock3, UsersRound } from "lucide-react";
import { ScheduleForm } from "@/components/forms/schedule-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { LoadingState } from "@/components/ui/loading";

function ScheduleContent() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-float-in">
      <SectionHeading eyebrow="Plan ahead" title="Schedule a meeting." description="Set the details once, then share one clean invite with everyone who needs to be there." />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-card"><CalendarDays className="h-5 w-5 text-mint" aria-hidden="true" /><p className="mt-3 text-sm font-bold text-ink">Choose a time</p><p className="mt-1 text-xs leading-5 text-muted">Your local time zone is applied automatically.</p></div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-card"><UsersRound className="h-5 w-5 text-mint" aria-hidden="true" /><p className="mt-3 text-sm font-bold text-ink">Add people</p><p className="mt-1 text-xs leading-5 text-muted">Invite guests by email when you’re ready.</p></div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-card"><Clock3 className="h-5 w-5 text-mint" aria-hidden="true" /><p className="mt-3 text-sm font-bold text-ink">Keep it focused</p><p className="mt-1 text-xs leading-5 text-muted">Set a duration so everyone knows the plan.</p></div>
      </div>
      <ScheduleForm />
    </div>
  );
}

export default function SchedulePage() {
  return <Suspense fallback={<LoadingState label="Opening scheduler" />}><ScheduleContent /></Suspense>;
}

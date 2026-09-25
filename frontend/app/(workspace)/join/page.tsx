import { Suspense } from "react";
import { ArrowRight, CheckCircle2, Link2, ShieldCheck, Video } from "lucide-react";
import Link from "next/link";
import { JoinForm } from "@/components/forms/join-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { LoadingState } from "@/components/ui/loading";

function JoinContent() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-float-in">
      <SectionHeading eyebrow="Quick entry" title="Join a meeting." description="Paste your invite and we’ll take you to the right room." />
      <div className="grid items-start gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <JoinForm />
        <div className="rounded-2xl border border-[#283446] bg-ink p-6 text-white shadow-soft sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-mint text-white"><Video className="h-5 w-5" aria-hidden="true" /></div>
          <p className="mt-7 text-xs font-semibold uppercase tracking-[0.14em] text-[#9ccaff]">A smoother start</p>
          <h2 className="mt-2 max-w-sm text-2xl font-bold tracking-[-0.03em]">Everything you need before you enter.</h2>
          <p className="mt-3 max-w-sm text-sm leading-6 text-white/60">Check your camera and microphone, choose how you’ll appear, and join when you’re ready.</p>
          <div className="mt-8 space-y-4 text-sm text-white/75">
            <div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-mint"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /></span>Check your setup</div>
            <div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-mint"><ShieldCheck className="h-4 w-4" aria-hidden="true" /></span>Review meeting details</div>
            <div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-mint"><Link2 className="h-4 w-4" aria-hidden="true" /></span>Join with one click</div>
          </div>
          <Link href="/schedule" className="mt-9 inline-flex items-center gap-2 text-sm font-bold text-[#9ccaff] transition hover:text-white">Need to create a room? <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return <Suspense fallback={<LoadingState label="Opening join" />}><JoinContent /></Suspense>;
}

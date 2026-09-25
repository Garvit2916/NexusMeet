"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Link2, ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { parseMeetingLink } from "@/lib/meeting-utils";

export function JoinForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseMeetingLink(value);
    if (!parsed) {
      setError("Paste a valid NexusMeet link, meeting code, or meeting ID.");
      return;
    }
    const destination = parsed.meetingId ?? parsed.code;
    if (!destination) {
      setError("We could not find a meeting in that link.");
      return;
    }
    router.push(`/meeting/${encodeURIComponent(destination)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7" noValidate>
      <div className="mb-6 flex items-start gap-3 border-b border-line pb-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky text-mint-dark"><Link2 className="h-5 w-5" aria-hidden="true" /></span>
        <div><h2 className="text-base font-bold text-ink">Join a meeting</h2><p className="mt-1 text-xs leading-5 text-muted">Paste the invite link or enter a meeting code.</p></div>
      </div>
      <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="join-link">Meeting link or code</label>
      <div className="relative"><ScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" /><input id="join-link" value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} placeholder="https://nexusmeet.com/meeting/design-sprint" autoComplete="off" className="h-11 w-full rounded-xl border border-line bg-canvas pl-10 pr-4 text-sm text-ink placeholder:text-muted/70 focus:border-mint focus:bg-white focus:outline-none" aria-invalid={Boolean(error)} aria-describedby={error ? "join-error" : "join-help"} /></div>
      {error ? <p id="join-error" className="mt-2 text-xs font-semibold text-coral" role="alert">{error}</p> : <p id="join-help" className="mt-2 text-xs leading-5 text-muted">Try a room link, a code like NM-DESIGN, or a meeting ID.</p>}
      <Button type="submit" size="lg" className="mt-6 w-full">Continue to meeting <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
    </form>
  );
}

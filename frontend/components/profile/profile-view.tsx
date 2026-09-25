"use client";

import { FormEvent, useState } from "react";
import { Bell, Check, Globe2, Lock, ShieldCheck, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { useAuth } from "@/providers/auth-provider";

function initialsFor(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "NM";
}

export function ProfileView() {
  const { user } = useAuth();
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [available, setAvailable] = useState(true);
  const [reminders, setReminders] = useState(true);
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-7 animate-float-in">
      <SectionHeading eyebrow="Your space" title="Profile settings." description="Review the account you sign in with and your meeting preferences." />
      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl bg-ink p-6 text-white shadow-soft">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-mint/20 ring-8 ring-white/5"><Avatar initials={initialsFor(user.name)} name={user.name} size="xl" tone="mint" /></div>
          <h2 className="mt-5 text-xl font-bold">{user.name}</h2>
          <p className="mt-1 text-sm text-white/55">{user.email}</p>
          <div className="mt-7 space-y-3 border-t border-white/10 pt-5 text-xs text-white/65"><div className="flex items-center gap-2.5"><Lock className="h-4 w-4 text-mint" aria-hidden="true" />Signed in with a secure session</div><div className="flex items-center gap-2.5"><ShieldCheck className="h-4 w-4 text-mint" aria-hidden="true" />Password stored as an Argon2id hash</div><div className="flex items-center gap-2.5"><Globe2 className="h-4 w-4 text-mint" aria-hidden="true" />{timezone.replace("_", " ")}</div></div>
        </aside>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <section className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7">
            <div className="mb-6 flex items-center gap-3 border-b border-line pb-5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky text-mint-dark"><UserRound className="h-5 w-5" aria-hidden="true" /></span><div><h2 className="text-base font-bold text-ink">Account details</h2><p className="mt-1 text-xs text-muted">Managed by your NexusMeet account.</p></div></div>
            <div className="grid gap-5 sm:grid-cols-2"><div><span className="mb-2 block text-sm font-semibold text-ink">Display name</span><p className="flex h-11 items-center rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink">{user.name}</p></div><div><span className="mb-2 block text-sm font-semibold text-ink">Email address</span><p className="flex h-11 items-center rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink">{user.email}</p></div></div>
            <div className="mt-5"><label className="mb-2 block text-sm font-semibold text-ink" htmlFor="profile-timezone">Timezone</label><select id="profile-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="h-11 w-full rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink focus:border-mint focus:bg-white focus:outline-none"><option value="America/Los_Angeles">Pacific Time · Los Angeles</option><option value="America/New_York">Eastern Time · New York</option><option value="Europe/London">GMT · London</option><option value="Asia/Kolkata">IST · Mumbai</option><option value="Asia/Singapore">SGT · Singapore</option></select></div>
          </section>
          <section className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7">
            <div className="mb-6 flex items-center gap-3 border-b border-line pb-5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-lilac text-[#5a4eb1]"><Bell className="h-5 w-5" aria-hidden="true" /></span><div><h2 className="text-base font-bold text-ink">Preferences</h2><p className="mt-1 text-xs text-muted">Small signals, only when they help.</p></div></div>
            <div className="divide-y divide-line"><label className="flex cursor-pointer items-center justify-between gap-4 py-4 first:pt-0"><span><span className="block text-sm font-semibold text-ink">Show me as available</span><span className="mt-1 block text-xs leading-5 text-muted">Let guests know you’re open to a conversation.</span></span><input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} className="h-5 w-5 accent-mint" /></label><label className="flex cursor-pointer items-center justify-between gap-4 py-4 last:pb-0"><span><span className="block text-sm font-semibold text-ink">Meeting reminders</span><span className="mt-1 block text-xs leading-5 text-muted">Get a nudge before a meeting starts.</span></span><input type="checkbox" checked={reminders} onChange={(event) => setReminders(event.target.checked)} className="h-5 w-5 accent-mint" /></label></div>
          </section>
          {saved ? <p className="flex items-center gap-2 text-sm font-semibold text-mint-dark" role="status"><Check className="h-4 w-4" aria-hidden="true" />Your preferences are up to date.</p> : null}
          <div className="flex justify-end"><Button type="submit"><Check className="h-4 w-4" aria-hidden="true" />Save preferences</Button></div>
        </form>
      </div>
    </div>
  );
}

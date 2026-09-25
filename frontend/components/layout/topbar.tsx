"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, HelpCircle, LogOut, Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";

export function Topbar() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [query, setQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    router.push(trimmedQuery ? `/dashboard?query=${encodeURIComponent(trimmedQuery)}` : "/dashboard");
  }

  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-line bg-white/95 px-5 backdrop-blur-xl sm:px-8 lg:px-10">
      <form onSubmit={submitSearch} className="hidden max-w-md flex-1 items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-muted md:flex">
        <Search className="h-4 w-4" aria-hidden="true" />
        <label className="sr-only" htmlFor="workspace-search">Search your meetings</label>
        <input id="workspace-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your meetings" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted" />
        <kbd className="rounded-md border border-line bg-white px-1.5 py-0.5 text-[10px] font-bold text-muted">↵</kbd>
      </form>
      <div className="ml-auto flex items-center gap-2">
        <Link href="/join" className="hidden h-9 items-center gap-2 rounded-xl border border-line px-3.5 text-sm font-semibold text-ink transition hover:border-mint/40 hover:bg-sky/40 sm:inline-flex">Join</Link>
        <div className="relative">
          <Button variant="ghost" size="icon" aria-label="Open help" aria-expanded={helpOpen} onClick={() => { setHelpOpen((current) => !current); setNotificationsOpen(false); }} className="hidden sm:inline-flex">
            <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
          </Button>
          {helpOpen ? <div className="absolute right-0 top-12 z-40 w-64 rounded-2xl border border-line bg-white p-4 shadow-float" role="dialog" aria-label="NexusMeet help"><div className="flex items-center justify-between"><p className="text-sm font-bold text-ink">Need a hand?</p><button type="button" onClick={() => setHelpOpen(false)} className="text-muted hover:text-ink" aria-label="Close help"><X className="h-4 w-4" aria-hidden="true" /></button></div><p className="mt-2 text-xs leading-5 text-muted">Paste an invite to join, or create a room when you are ready.</p><div className="mt-3 flex flex-col gap-1"><Link href="/join" onClick={() => setHelpOpen(false)} className="rounded-xl px-2 py-2 text-xs font-bold text-mint-dark hover:bg-sky">Join a meeting</Link><Link href="/schedule" onClick={() => setHelpOpen(false)} className="rounded-xl px-2 py-2 text-xs font-bold text-mint-dark hover:bg-sky">Plan a meeting</Link></div></div> : null}
        </div>
        <div className="relative">
          <Button variant="ghost" size="icon" aria-label="Open notifications" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((current) => !current); setHelpOpen(false); }} className="relative"><Bell className="h-[18px] w-[18px]" aria-hidden="true" /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-coral" aria-hidden="true" /></Button>
          {notificationsOpen ? <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-line bg-white p-4 shadow-float" role="dialog" aria-label="Notifications"><div className="flex items-center justify-between"><p className="text-sm font-bold text-ink">Notifications</p><button type="button" onClick={() => setNotificationsOpen(false)} className="text-muted hover:text-ink" aria-label="Close notifications"><X className="h-4 w-4" aria-hidden="true" /></button></div><div className="mt-4 rounded-xl bg-canvas p-3"><div className="flex gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff4d9] text-[#8a6416]"><Bell className="h-4 w-4" aria-hidden="true" /></span><div><p className="text-xs font-bold text-ink">You’re all caught up</p><p className="mt-1 text-xs leading-5 text-muted">New room activity will show up here.</p></div></div></div></div> : null}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => { setAccountOpen((current) => !current); setHelpOpen(false); setNotificationsOpen(false); }}
            className="ml-1 flex items-center gap-2 rounded-xl p-1.5 pr-2 transition hover:bg-canvas"
            aria-label="Open account menu"
            aria-expanded={accountOpen}
          >
            <Avatar initials={user?.initials ?? "NM"} name={user?.name ?? "Signed out"} size="sm" tone="mint" />
            <span className="hidden text-left sm:block"><span className="block text-xs font-bold leading-4 text-ink">{user?.name ?? "Signed out"}</span><span className="block text-[10px] leading-3 text-muted">Workspace</span></span>
            <ChevronDown className="hidden h-4 w-4 text-muted sm:block" aria-hidden="true" />
          </button>
          {accountOpen ? (
            <div className="absolute right-0 top-12 z-40 w-64 rounded-2xl border border-line bg-white p-2 shadow-float" role="dialog" aria-label="Account menu">
              <Link href="/profile" onClick={() => setAccountOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas">Profile settings</Link>
              <button
                type="button"
                disabled={isSigningOut}
                onClick={async () => {
                  setAccountOpen(false);
                  setIsSigningOut(true);
                  try {
                    await signOut();
                    router.replace("/login");
                  } finally {
                    setIsSigningOut(false);
                  }
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-coral transition hover:bg-[#fff0f0] disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {isSigningOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

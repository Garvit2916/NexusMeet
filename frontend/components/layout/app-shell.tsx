"use client";

import { useState, type ReactNode } from "react";
import { HelpCircle, Menu, X } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { MobileNav, NewMeetingButton, SidebarNav } from "@/components/layout/nav";
import { Topbar } from "@/components/layout/topbar";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/providers/auth-provider";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[240px] flex-col border-r border-line bg-white px-4 py-5 lg:flex">
        <div className="px-2"><Brand /></div>
        <div className="mt-8 px-2"><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Workspace</p><NewMeetingButton /></div>
        <div className="mt-7 flex-1 px-1"><SidebarNav /></div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-line bg-[#fafbfc] p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold text-ink">Free plan</span>
              <span className="rounded-full bg-[#fff4d9] px-2 py-0.5 text-[10px] font-bold text-[#8a6416]">Personal</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full w-2/3 rounded-full bg-mint" /></div>
            <p className="mt-2 text-[11px] leading-4 text-muted">2 of 3 active meeting spaces used</p>
          </div>
          <div className="flex items-center gap-2.5 rounded-2xl border border-line p-2.5">
            <Avatar initials={user?.initials ?? "NM"} name={user?.name ?? "Signed out"} size="sm" tone="mint" />
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-ink">{user?.name ?? "Signed out"}</p><p className="truncate text-[10px] text-muted">{user?.email ?? ""}</p></div>
            <HelpCircle className="h-4 w-4 text-muted" aria-hidden="true" />
          </div>
        </div>
      </aside>

      <div className="lg:pl-[240px]">
        <Topbar />
        <div className="flex items-center justify-between border-b border-line bg-white px-5 py-3 lg:hidden">
          <Brand compact />
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-ink" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {sidebarOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />
            <aside className="relative flex h-full w-[280px] flex-col bg-white px-5 py-6 shadow-float">
              <div className="flex items-center justify-between px-2"><Brand /><button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl bg-canvas text-ink" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X className="h-4 w-4" aria-hidden="true" /></button></div>
              <div className="mt-8"><NewMeetingButton /></div>
              <div className="mt-7"><SidebarNav /></div>
            </aside>
          </div>
        ) : null}
        <main className="min-h-[calc(100vh-72px)] px-5 pb-24 pt-7 sm:px-8 lg:px-10 lg:pb-10">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}

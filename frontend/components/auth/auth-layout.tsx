"use client";

import type { ReactNode } from "react";
import { ShieldCheck, Video, Users, Captions } from "lucide-react";
import { Brand } from "@/components/layout/brand";

const HIGHLIGHTS = [
  { icon: Video, label: "HD video and screen sharing" },
  { icon: Captions, label: "Live captions and chat" },
  { icon: Users, label: "Up to six participants" },
  { icon: ShieldCheck, label: "Encrypted, no recording by default" },
];

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen flex-col bg-canvas lg:flex-row">
      {/* Marketing rail, hidden on small screens so the form owns the viewport. */}
      <aside className="relative hidden overflow-hidden bg-ink px-12 py-14 text-white lg:flex lg:w-[46%] lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 12%, rgba(45,140,255,0.55), transparent 42%), radial-gradient(circle at 82% 78%, rgba(238,234,254,0.35), transparent 46%)",
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <Brand light />
        </div>
        <div className="relative max-w-md">
          <h2 className="text-[2rem] font-extrabold leading-[1.15] tracking-[-0.03em]">
            Meetings that start the moment you do.
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-white/70">
            NexusMeet is a lightweight video room built for teams that would rather talk than install
            something. No downloads, no waiting rooms to configure.
          </p>
          <ul className="mt-9 space-y-3.5">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-white/80">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} NexusMeet</p>
      </aside>

      <section className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className="mb-8 flex justify-center lg:hidden">
            <Brand />
          </div>

          <div className="rounded-2xl border border-line bg-panel p-6 shadow-card sm:p-8">
            <h1 className="text-[1.6rem] font-extrabold tracking-[-0.02em] text-ink">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>
            <div className="mt-7">{children}</div>
          </div>

          <p className="mt-6 text-center text-[13px] text-muted">{footer}</p>
        </div>
      </section>
    </main>
  );
}

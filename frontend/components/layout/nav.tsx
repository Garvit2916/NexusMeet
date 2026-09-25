"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, Home, Link2, UserRound, Video } from "lucide-react";
import { cn } from "@/lib/cn";

const navigation = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/schedule", label: "Schedule", icon: CalendarPlus },
  { href: "/join", label: "Join", icon: Link2 },
  { href: "/profile", label: "Profile", icon: UserRound },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname.startsWith("/meeting");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="space-y-1">
      {navigation.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn("group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", active ? "bg-[#e8f2ff] text-mint-dark" : "text-muted hover:bg-canvas hover:text-ink")}
            aria-current={active ? "page" : undefined}
          >
            <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg transition", active ? "bg-white text-mint" : "text-muted group-hover:text-ink")}>
              <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const items = [navigation[0], navigation[1], navigation[2], navigation[3]];

  return (
    <nav aria-label="Mobile navigation" className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl border border-line bg-white/95 p-2 shadow-float backdrop-blur lg:hidden">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={cn("flex min-w-[64px] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-bold", active ? "bg-sky text-mint-dark" : "text-muted")} aria-current={active ? "page" : undefined}>
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function NewMeetingButton() {
  return (
    <Link href="/schedule" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-mint px-4 text-sm font-bold text-white shadow-[0_6px_16px_rgba(45,140,255,0.2)] transition hover:bg-mint-dark">
      <Video className="h-4 w-4" aria-hidden="true" />
      New meeting
    </Link>
  );
}

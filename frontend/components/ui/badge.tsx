import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type BadgeProps = {
  children: ReactNode;
  tone?: "mint" | "sun" | "coral" | "slate" | "lilac";
  className?: string;
};

const tones = {
  mint: "bg-[#e7f2ff] text-mint-dark",
  sun: "bg-[#fff4d9] text-[#8a6416]",
  coral: "bg-[#ffebec] text-[#b52d34]",
  slate: "bg-[#f0f1f3] text-muted",
  lilac: "bg-lilac text-[#5a4eb1]",
};

export function Badge({ children, tone = "slate", className }: BadgeProps) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", tones[tone], className)}>{children}</span>;
}

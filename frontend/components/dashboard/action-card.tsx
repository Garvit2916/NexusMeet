import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

type ActionCardProps = {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  tone: "mint" | "coral" | "lilac";
  className?: string;
};

const tones = {
  mint: "bg-sky text-mint-dark",
  coral: "bg-[#fff0f0] text-coral",
  lilac: "bg-lilac text-[#5a4eb1]",
};

export function ActionCard({ href, label, description, icon, tone, className }: ActionCardProps) {
  return (
    <Link href={href} className={cn("group relative overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-mint/30 hover:shadow-soft", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", tones[tone])}>{icon}</span>
        <ArrowUpRight className="h-5 w-5 text-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-mint" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-sm font-bold text-ink">{label}</h2>
      <p className="mt-1.5 text-sm leading-5 text-muted">{description}</p>
    </Link>
  );
}

import Link from "next/link";
import { Video } from "lucide-react";
import { cn } from "@/lib/cn";

export function Brand({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", light ? "text-white" : "text-ink")} aria-label="NexusMeet home">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", light ? "bg-white/15 text-white" : "bg-mint text-white")}>
        <Video className="h-[18px] w-[18px]" strokeWidth={2.3} aria-hidden="true" />
      </span>
      {!compact ? <span className="text-[17px] font-bold tracking-[-0.03em]">NexusMeet</span> : null}
    </Link>
  );
}

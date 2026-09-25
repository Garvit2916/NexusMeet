import { cn } from "@/lib/cn";

type AvatarProps = {
  initials: string;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "mint" | "coral" | "lilac" | "sun" | "ink";
  className?: string;
};

const sizes = {
  sm: "h-8 w-8 text-[10px]",
  md: "h-10 w-10 text-xs",
  lg: "h-12 w-12 text-sm",
  xl: "h-16 w-16 text-lg",
};

const tones = {
  mint: "bg-mint text-white",
  coral: "bg-coral text-white",
  lilac: "bg-lilac text-[#5a4eb1]",
  sun: "bg-sun text-[#6e4b0f]",
  ink: "bg-ink text-white",
};

export function Avatar({ initials, name, size = "md", tone = "mint", className }: AvatarProps) {
  return (
    <span aria-label={name} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", sizes[size], tones[tone], className)} role={name ? "img" : undefined}>
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}

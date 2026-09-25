import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dark";
type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-mint text-white shadow-[0_6px_16px_rgba(45,140,255,0.22)] hover:bg-mint-dark",
  secondary: "border border-line bg-white text-ink hover:border-mint/50 hover:bg-sky/40",
  ghost: "text-muted hover:bg-canvas hover:text-ink",
  danger: "bg-coral text-white hover:bg-[#c93a40]",
  dark: "bg-ink text-white hover:bg-[#34373B]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 rounded-xl px-3.5 text-sm",
  md: "h-10 rounded-xl px-4 text-sm",
  lg: "h-12 rounded-xl px-5 text-sm",
  icon: "h-10 w-10 rounded-xl",
};

export function Button({ className, variant = "primary", size = "md", type = "button", children, ...props }: ButtonProps) {
  return (
    <button
      className={cn("inline-flex items-center justify-center gap-2 font-semibold transition duration-200 disabled:pointer-events-none disabled:opacity-50", variantClasses[variant], sizeClasses[size], className)}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

import { LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-sm font-medium text-muted" role="status" aria-live="polite">
      <LoaderCircle className="h-5 w-5 animate-spin text-mint" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function InlineLoading({ label = "Loading" }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin text-mint" aria-hidden="true" />{label}…</span>;
}

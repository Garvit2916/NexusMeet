import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type ErrorStateProps = {
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({ message = "Something went wrong.", onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-coral/20 bg-[#fff8f8] px-6 py-10 text-center" role="alert">
      <AlertCircle className="mb-4 h-7 w-7 text-coral" aria-hidden="true" />
      <h2 className="text-base font-bold text-ink">We hit a snag</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{message}</p>
      {onRetry ? <Button className="mt-5" variant="secondary" size="sm" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button> : null}
    </div>
  );
}

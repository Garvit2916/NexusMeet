"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5"><div className="max-w-md text-center"><p className="text-xs font-bold uppercase tracking-[0.18em] text-coral">Something unexpected</p><h1 className="mt-3 text-3xl font-bold text-ink">Let’s try that again.</h1><p className="mt-3 text-sm leading-6 text-muted">NexusMeet could not finish loading this view. Your meetings are still safe.</p><Button className="mt-6" onClick={() => reset()}>Reload view</Button></div></div>
  );
}

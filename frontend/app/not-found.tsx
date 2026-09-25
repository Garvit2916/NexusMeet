import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5 text-center"><div className="max-w-md"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky text-mint-dark"><Compass className="h-6 w-6" aria-hidden="true" /></span><p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-mint-dark">404</p><h1 className="mt-2 text-3xl font-bold text-ink">That page wandered off.</h1><p className="mt-3 text-sm leading-6 text-muted">The link may be old, or the room may have moved.</p><Link href="/dashboard" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-mint px-5 text-sm font-bold text-white hover:bg-mint-dark">Back to workspace</Link></div></div>
  );
}

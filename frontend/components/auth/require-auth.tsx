"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LoadingState } from "@/components/ui/loading";
import { useAuth } from "@/providers/auth-provider";

function isSafeNextPath(next: string | null) {
  return Boolean(next && next.startsWith("/") && !next.startsWith("//"));
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    const next = encodeURIComponent(pathname ?? "/dashboard");
    router.replace(`/login?next=${next}`);
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <LoadingState label="Checking your session" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
        <p className="text-sm font-semibold text-muted">Taking you to the sign-in page…</p>
      </div>
    );
  }

  return <>{children}</>;
}

export function resolveNextPath(searchParams: URLSearchParams | null) {
  const next = searchParams?.get("next") ?? null;
  return isSafeNextPath(next) ? (next as string) : "/dashboard";
}

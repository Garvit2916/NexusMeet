"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/layout/brand";
import { resolveNextPath } from "@/components/auth/require-auth";
import { useAuth } from "@/providers/auth-provider";
import { ApiError } from "@/services/api";

const DEMO_CREDENTIALS = { email: "demo@nexusmeet.app", password: "demo12345" };

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, error, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      await signIn({ email, password });
      router.replace(resolveNextPath(searchParams));
    } catch (requestError) {
      setFormError(requestError instanceof ApiError ? requestError.message : "We could not sign you in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function fillDemoCredentials() {
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
  }

  const disabled = isSubmitting || isLoading;

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to host, join, and manage your meetings."
      footer={
        <>
          New to NexusMeet?{" "}
          <Link
            href={`/register${searchParams.get("next") ? `?next=${encodeURIComponent(searchParams.get("next") as string)}` : ""}`}
            className="font-bold text-mint-dark hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Field label="Work email" id="signin-email">
          <input
            id="signin-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20"
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" id="signin-password">
          <input
            id="signin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20"
            placeholder="At least 8 characters"
          />
        </Field>
        {formError || error ? (
          <p role="alert" className="rounded-xl bg-[#fff0f0] px-3.5 py-2.5 text-xs font-semibold text-[#b4272d]">
            {formError ?? error}
          </p>
        ) : null}
        <Button type="submit" className="w-full justify-center" disabled={disabled}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
        <button
          type="button"
          onClick={fillDemoCredentials}
          className="w-full rounded-xl border border-dashed border-line px-3.5 py-2.5 text-xs font-semibold text-muted transition hover:border-mint/50 hover:text-ink"
        >
          Use the demo account ({DEMO_CREDENTIALS.email})
        </button>
      </form>
    </AuthCard>
  );
}

export function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

export function AuthCard({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">{title}</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-5 text-center text-xs text-muted">{footer}</p>
      </div>
    </div>
  );
}

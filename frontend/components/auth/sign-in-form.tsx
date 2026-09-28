"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Sparkles } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { PasswordField, TextField } from "@/components/auth/auth-fields";
import { Button } from "@/components/ui/button";
import { resolveNextPath } from "@/components/auth/require-auth";
import { useAuth } from "@/providers/auth-provider";
import { bannerMessageFrom, fieldErrorsFrom, type FieldErrors } from "@/lib/auth-errors";
import { validateEmail, validatePassword } from "@/lib/auth-validation";
import { ApiError } from "@/services/api";

const DEMO_CREDENTIALS = { email: "demo@nexusmeet.app", password: "demo12345" };

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, isLoading, isAuthenticated } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Someone who is already signed in has no business on the sign-in page.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(resolveNextPath(searchParams));
    }
  }, [isLoading, isAuthenticated, router, searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const nextErrors: FieldErrors = {
      ...(validateEmail(email) ? { email: validateEmail(email) as string } : {}),
      ...(validatePassword(password) ? { password: validatePassword(password) as string } : {}),
    };
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      setBannerError("Check the highlighted fields and try again.");
      return;
    }

    setBannerError(null);
    setFieldErrors({});
    setIsSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
      router.replace(resolveNextPath(searchParams));
    } catch (requestError) {
      setFieldErrors(fieldErrorsFrom(requestError));
      setBannerError(
        bannerMessageFrom(requestError, "We could not sign you in. Please try again."),
      );
      if (requestError instanceof ApiError && requestError.status === 401) {
        setPassword("");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function fillDemoCredentials() {
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
    setFieldErrors({});
    setBannerError(null);
  }

  const next = searchParams.get("next");
  const disabled = isSubmitting || isLoading;

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your NexusMeet account to host or join a meeting."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-semibold text-mint-dark underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {bannerError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-coral/25 bg-[#FFF1F1] px-3.5 py-3"
          >
            <AlertCircle className="mt-px h-4 w-4 shrink-0 text-coral" aria-hidden="true" />
            <p className="text-[13px] font-medium leading-5 text-[#B4272D]">{bannerError}</p>
          </div>
        ) : null}

        <TextField
          label="Work email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          required
        />

        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
        />

        <Button type="submit" size="lg" className="w-full justify-center" disabled={disabled}>
          {isSubmitting ? "Signing in…" : "Sign in"}
          {!isSubmitting ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
        </Button>

        <div className="relative py-1">
          <span className="absolute inset-0 flex items-center" aria-hidden="true">
            <span className="w-full border-t border-line" />
          </span>
          <span className="relative mx-auto block w-fit bg-panel px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
            or
          </span>
        </div>

        <button
          type="button"
          onClick={fillDemoCredentials}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-2.5 text-[13px] font-semibold text-muted transition hover:border-mint/50 hover:bg-sky/30 hover:text-ink"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Fill the demo account
        </button>
        <p className="-mt-2 text-center text-[11px] text-muted">
          Demo access for reviewing the app. Creates no real meeting data.
        </p>
      </form>
    </AuthLayout>
  );
}

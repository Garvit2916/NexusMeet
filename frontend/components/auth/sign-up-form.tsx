"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Checkbox, PasswordField, RequirementList, TextField } from "@/components/auth/auth-fields";
import { Button } from "@/components/ui/button";
import { resolveNextPath } from "@/components/auth/require-auth";
import { useAuth } from "@/providers/auth-provider";
import { bannerMessageFrom, fieldErrorsFrom, type FieldErrors } from "@/lib/auth-errors";
import {
  MAX_PASSWORD_LENGTH,
  STRENGTH_LABELS,
  passwordRequirements,
  passwordStrength,
  validateEmail,
  validateName,
  validatePassword,
} from "@/lib/auth-validation";
import { cn } from "@/lib/cn";

const STRENGTH_COLORS = [
  "bg-line",
  "bg-coral",
  "bg-sun",
  "bg-mint",
  "bg-mint-dark",
];

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signUp, isLoading, isAuthenticated } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(resolveNextPath(searchParams));
    }
  }, [isLoading, isAuthenticated, router, searchParams]);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const emailError = validateEmail(form.email);
    const nameError = validateName(form.name);
    const passwordError = validatePassword(form.password);
    const confirmError = form.confirmPassword
      ? form.password === form.confirmPassword
        ? null
        : "Passwords do not match."
      : "Confirm your password.";

    const nextErrors: FieldErrors = {
      ...(nameError ? { name: nameError } : {}),
      ...(emailError ? { email: emailError } : {}),
      ...(passwordError ? { password: passwordError } : {}),
      ...(confirmError ? { confirmPassword: confirmError } : {}),
      ...(acceptedTerms ? {} : { terms: "Please accept the terms to continue." }),
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
      await signUp({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      router.replace(resolveNextPath(searchParams));
    } catch (requestError) {
      setFieldErrors(fieldErrorsFrom(requestError));
      setBannerError(
        bannerMessageFrom(requestError, "We could not create your account. Please try again."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const next = searchParams.get("next");
  const disabled = isSubmitting || isLoading;
  const strength = passwordStrength(form.password);
  const requirements = passwordRequirements(form.password);

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Free to join. You only need a name, a work email, and a password."
      footer={
        <>
          Already registered?{" "}
          <Link
            href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-semibold text-mint-dark underline-offset-4 hover:underline"
          >
            Sign in
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
          label="Full name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={form.name}
          onChange={(event) => updateField("name", event.target.value)}
          error={fieldErrors.name}
          required
        />

        <TextField
          label="Work email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@company.com"
          value={form.email}
          onChange={(event) => updateField("email", event.target.value)}
          error={fieldErrors.email}
          required
        />

        <div className="space-y-2">
          <PasswordField
            label="Password"
            name="password"
            autoComplete="new-password"
            placeholder={`At least ${8} characters`}
            value={form.password}
            maxLength={MAX_PASSWORD_LENGTH}
            onChange={(event) => updateField("password", event.target.value)}
            error={fieldErrors.password}
            required
          />

          {form.password ? (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1" role="img" aria-label={`Password strength: ${STRENGTH_LABELS[strength]}`}>
                  {[0, 1, 2, 3].map((index) => (
                    <span
                      key={index}
                      className={cn(
                        "h-1 flex-1 rounded-full transition-colors",
                        index < strength ? STRENGTH_COLORS[strength] : "bg-line",
                      )}
                    />
                  ))}
                </div>
                <span className="w-16 text-right text-[11px] font-semibold text-muted">
                  {STRENGTH_LABELS[strength]}
                </span>
              </div>
              <RequirementList items={requirements} />
            </div>
          ) : null}
        </div>

        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={form.confirmPassword}
          onChange={(event) => updateField("confirmPassword", event.target.value)}
          error={fieldErrors.confirmPassword}
          required
        />

        <Checkbox
          id="accept-terms"
          checked={acceptedTerms}
          onChange={(checked) => {
            setAcceptedTerms(checked);
            if (checked) {
            setFieldErrors((current) => {
              const rest = { ...current };
              delete rest.terms;
              return rest;
            });
            }
          }}
          error={fieldErrors.terms}
        >
          I agree to the terms of service and privacy policy, and I understand that meetings are not
          recorded by default.
        </Checkbox>

        <Button type="submit" size="lg" className="w-full justify-center" disabled={disabled}>
          {isSubmitting ? "Creating your account…" : "Create account"}
          {!isSubmitting ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
        </Button>
      </form>
    </AuthLayout>
  );
}

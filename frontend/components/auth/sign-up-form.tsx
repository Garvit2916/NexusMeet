"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AuthCard, Field } from "@/components/auth/sign-in-form";
import { resolveNextPath } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signUp, error, isLoading } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      await signUp(form);
      router.replace(resolveNextPath(searchParams));
    } catch {
      setFormError("We could not create your account with those details.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const next = searchParams.get("next");
  const disabled = isSubmitting || isLoading;

  return (
    <AuthCard
      title="Create your account"
      subtitle="Register once, then host or join meetings from any device."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-bold text-mint-dark hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Field label="Full name" id="signup-name">
          <input
            id="signup-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20"
            placeholder="Ada Lovelace"
          />
        </Field>
        <Field label="Work email" id="signup-email">
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20"
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" id="signup-password">
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
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
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}

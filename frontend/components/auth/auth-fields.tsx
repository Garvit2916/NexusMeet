"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff, AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/cn";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  optional?: boolean;
};

export function Field({ label, hint, error, children, optional }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
        {optional ? <span className="text-[11px] font-medium text-muted">Optional</span> : null}
      </div>
      {children({ id, describedBy: error ? errorId : hint ? hintId : undefined, invalid })}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-coral">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASSES =
  "w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 outline-none transition focus:ring-2 disabled:bg-canvas disabled:text-muted";

function controlClasses(invalid: boolean, className?: string) {
  return cn(
    CONTROL_CLASSES,
    invalid
      ? "border-coral focus:border-coral focus:ring-coral/20"
      : "border-line focus:border-mint focus:ring-mint/20",
    className,
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
};

export function TextField({ label, hint, error, optional, className, ...props }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <input
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={controlClasses(invalid, className)}
        />
      )}
    </Field>
  );
}

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
};

export function PasswordField({ label, hint, error, optional, className, ...props }: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input
            {...props}
            id={id}
            type={revealed ? "text" : "password"}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={controlClasses(invalid, cn("pr-11", className))}
          />
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted transition hover:text-ink"
            aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={revealed}
            tabIndex={-1}
          >
            {revealed ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      )}
    </Field>
  );
}

type CheckboxProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  error?: string | null;
};

export function Checkbox({ id, checked, onChange, children, error }: CheckboxProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2.5">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-mint accent-mint"
        />
        <label htmlFor={id} className="text-xs leading-5 text-muted">
          {children}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="pl-6.5 text-xs font-medium text-coral">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type RequirementListProps = {
  items: { id: string; label: string; met: boolean }[];
};

export function RequirementList({ items }: RequirementListProps) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-medium transition",
            item.met ? "text-mint-dark" : "text-muted",
          )}
        >
          <span
            className={cn(
              "flex h-3.5 w-3.5 items-center justify-center rounded-full border transition",
              item.met ? "border-mint bg-mint text-white" : "border-line bg-white",
            )}
            aria-hidden="true"
          >
            {item.met ? <Check className="h-2.5 w-2.5" strokeWidth={3.5} /> : null}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

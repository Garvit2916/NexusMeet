export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 100;

// Deliberately permissive: the backend owns email validation via `EmailStr`, so
// this only catches the obvious typos before a round trip. Anything this accepts
// is still validated server-side.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PasswordRequirement = {
  id: string;
  label: string;
  met: boolean;
};

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Email is required.";
  if (!EMAIL_PATTERN.test(trimmed)) return "Enter a valid email address, for example you@company.com.";
  return null;
}

export function validatePassword(value: string, options?: { allowShort?: boolean }): string | null {
  if (!value) return "Password is required.";
  if (options?.allowShort) return null;
  if (value.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (value.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

export function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Full name is required.";
  if (trimmed.length < MIN_NAME_LENGTH) return `Use at least ${MIN_NAME_LENGTH} characters.`;
  if (trimmed.length > MAX_NAME_LENGTH) return `Use at most ${MAX_NAME_LENGTH} characters.`;
  return null;
}

export function passwordRequirements(value: string): PasswordRequirement[] {
  return [
    { id: "length", label: `${MIN_PASSWORD_LENGTH}+ characters`, met: value.length >= MIN_PASSWORD_LENGTH },
    { id: "letter", label: "Contains a letter", met: /[A-Za-z]/.test(value) },
    { id: "number", label: "Contains a number", met: /\d/.test(value) },
  ];
}

/** 0-4 score used to colour the strength meter. Length alone is enough to pass. */
export function passwordStrength(value: string): number {
  if (!value) return 0;
  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Za-z]/.test(value) && /\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}

export const STRENGTH_LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"] as const;

import { ApiError } from "@/services/api";

export type FieldErrors = Partial<Record<string, string>>;

const FRIENDLY_FIELD_NAMES: Record<string, string> = {
  email: "Email",
  password: "Password",
  name: "Full name",
  confirmPassword: "Password confirmation",
};

const FRIENDLY_MESSAGES: Record<string, string> = {
  string_too_short: "is too short",
  string_too_long: "is too long",
  value_error: "is not valid",
  missing: "is required",
};

/**
 * FastAPI reports the request body as a location prefix, so a short password
 * arrives as `body.password`. Strip that so the form can look errors up by
 * field name alone.
 */
function normalizeFieldPath(path: string): string {
  const parts = path.split(".").filter(Boolean);
  while (parts.length > 1 && (parts[0] === "body" || parts[0] === "query" || parts[0] === "path")) {
    parts.shift();
  }
  return parts.join(".");
}

function friendlyMessage(raw: string, field: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes("at least 8 characters") || lower.includes("at least")) {
    return "Use at least 8 characters.";
  }
  if (lower.includes("@-sign") || lower.includes("valid email address")) {
    return "Enter a valid email address, for example you@company.com.";
  }
  if (lower.includes("at most") || lower.includes("no more than")) {
    return "This value is too long.";
  }
  if (lower.includes("at least 2 characters")) {
    return "Use at least 2 characters.";
  }

  const typeMatch = Object.entries(FRIENDLY_MESSAGES).find(([type]) => lower.includes(type));
  if (typeMatch) {
    const label = FRIENDLY_FIELD_NAMES[field] ?? FRIENDLY_FIELD_NAMES[field.toLowerCase()] ?? "This field";
    return `${label} ${typeMatch[1]}.`;
  }

  // Fall back to the server text, but never show a pydantic error code.
  if (/^[a-z_]+$/.test(raw)) {
    return `${FRIENDLY_FIELD_NAMES[field] ?? "This field"} is not valid.`;
  }
  return raw;
}

function collectDetails(details: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!details || typeof details !== "object") return errors;

  const list = (details as { errors?: unknown }).errors;
  if (!Array.isArray(list)) return errors;

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { field?: unknown; message?: unknown };
    if (typeof record.field !== "string" || typeof record.message !== "string") continue;
    const field = normalizeFieldPath(record.field);
    // Keep the first message per field; FastAPI can report several.
    if (!errors[field]) {
      errors[field] = friendlyMessage(record.message, field);
    }
  }
  return errors;
}

/**
 * Extract per-field messages from a 422 so the form can show "Use at least 8
 * characters" under the password box instead of one generic banner.
 */
export function fieldErrorsFrom(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  if (error.status !== 422 && error.code !== "VALIDATION_ERROR") return {};
  return collectDetails(error.details);
}

/** A short, human summary of a failed submit, suitable for the form banner. */
export function bannerMessageFrom(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 429) {
    return error.message || "Too many attempts. Wait a moment before trying again.";
  }
  const fields = fieldErrorsFrom(error);
  const first = Object.values(fields)[0];
  if (first) return first;
  return error.message || fallback;
}

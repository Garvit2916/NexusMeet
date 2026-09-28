import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/api";
import { bannerMessageFrom, fieldErrorsFrom } from "@/lib/auth-errors";
import {
  MAX_PASSWORD_LENGTH,
  passwordRequirements,
  passwordStrength,
  validateEmail,
  validateName,
  validatePassword,
} from "@/lib/auth-validation";

describe("fieldErrorsFrom", () => {
  it("strips the FastAPI body prefix so the form can match on field name", () => {
    const error = new ApiError("Request validation failed", 422, "VALIDATION_ERROR", {
      errors: [{ field: "body.password", message: "String should have at least 8 characters", type: "string_too_short" }],
    });

    expect(fieldErrorsFrom(error)).toEqual({ password: "Use at least 8 characters." });
  });

  it("rewrites the raw email error into actionable copy", () => {
    const error = new ApiError("Request validation failed", 422, "VALIDATION_ERROR", {
      errors: [
        {
          field: "body.email",
          message: "value is not a valid email address: An email address must have an @-sign.",
          type: "value_error",
        },
      ],
    });

    expect(fieldErrorsFrom(error).email).toMatch(/valid email address/i);
    expect(fieldErrorsFrom(error).email).not.toMatch(/@-sign/);
  });

  it("keeps the first message when a field is reported twice", () => {
    const error = new ApiError("Request validation failed", 422, "VALIDATION_ERROR", {
      errors: [
        { field: "body.password", message: "String should have at least 8 characters", type: "string_too_short" },
        { field: "body.password", message: "some later message", type: "other" },
      ],
    });

    expect(Object.keys(fieldErrorsFrom(error))).toEqual(["password"]);
    expect(fieldErrorsFrom(error).password).toBe("Use at least 8 characters.");
  });

  it("never leaks a raw pydantic error code to the user", () => {
    const error = new ApiError("Request validation failed", 422, "VALIDATION_ERROR", {
      errors: [{ field: "body.name", message: "string_too_short", type: "string_too_short" }],
    });

    // The copy is rewritten into plain English naming the field.
    expect(fieldErrorsFrom(error).name).toBe("Full name is too short.");
    expect(fieldErrorsFrom(error).name).not.toMatch(/string_too_short/);
  });

  it("returns nothing for a non-validation error", () => {
    expect(fieldErrorsFrom(new ApiError("Email or password is incorrect", 401, "INVALID_CREDENTIALS"))).toEqual({});
    expect(fieldErrorsFrom(new Error("network down"))).toEqual({});
    expect(fieldErrorsFrom(null)).toEqual({});
  });

  it("tolerates a malformed details payload", () => {
    const error = new ApiError("Request validation failed", 422, "VALIDATION_ERROR", { errors: "not-a-list" });
    expect(fieldErrorsFrom(error)).toEqual({});
  });
});

describe("bannerMessageFrom", () => {
  it("prefers the first field message over the generic banner", () => {
    const error = new ApiError("Request validation failed", 422, "VALIDATION_ERROR", {
      errors: [{ field: "body.password", message: "String should have at least 8 characters", type: "string_too_short" }],
    });

    expect(bannerMessageFrom(error, "fallback")).toBe("Use at least 8 characters.");
  });

  it("keeps a meaningful server message that carries no field detail", () => {
    const error = new ApiError("An account with this email already exists", 409, "EMAIL_ALREADY_REGISTERED");
    expect(bannerMessageFrom(error, "fallback")).toBe("An account with this email already exists");
  });

  it("falls back when the error is not an ApiError", () => {
    expect(bannerMessageFrom(new Error("boom"), "fallback")).toBe("fallback");
  });
});

describe("validateEmail", () => {
  it("requires a value", () => {
    expect(validateEmail("")).toMatch(/required/i);
    expect(validateEmail("   ")).toMatch(/required/i);
  });

  it("accepts a normal address", () => {
    expect(validateEmail("demo@nexusmeet.app")).toBeNull();
  });

  it("rejects the obvious typos", () => {
    expect(validateEmail("not-an-email")).toMatch(/valid email/i);
    expect(validateEmail("missing@tld")).toMatch(/valid email/i);
    expect(validateEmail("two@@example.com")).toMatch(/valid email/i);
  });
});

describe("validatePassword", () => {
  it("enforces the API minimum of 8 characters", () => {
    expect(validatePassword("short")).toMatch(/at least 8/i);
    expect(validatePassword("longenough")).toBeNull();
  });

  it("enforces the API maximum", () => {
    expect(validatePassword("x".repeat(MAX_PASSWORD_LENGTH + 1))).toMatch(/at most/i);
  });

  it("allows a short value on sign-in, where length is not the problem", () => {
    expect(validatePassword("abc", { allowShort: true })).toBeNull();
  });

  it("still requires a value even when short is allowed", () => {
    expect(validatePassword("", { allowShort: true })).toMatch(/required/i);
  });
});

describe("validateName", () => {
  it("mirrors the API minimum of 2 characters", () => {
    expect(validateName("A")).toMatch(/at least 2/i);
    expect(validateName("Ada Lovelace")).toBeNull();
  });

  it("treats whitespace-only input as missing", () => {
    expect(validateName("   ")).toMatch(/required/i);
  });
});

describe("passwordStrength", () => {
  it("scores an empty password as zero", () => {
    expect(passwordStrength("")).toBe(0);
  });

  it("scores a long mixed passphrase at the top of the scale", () => {
    expect(passwordStrength("Str0ng-Passphrase-2024")).toBe(4);
  });

  it("never exceeds the maximum", () => {
    expect(passwordStrength("aA1!".repeat(20))).toBeLessThanOrEqual(4);
  });
});

describe("passwordRequirements", () => {
  it("reports every requirement as unmet for an empty password", () => {
    expect(passwordRequirements("").every((item) => !item.met)).toBe(true);
  });

  it("marks a compliant password as meeting all requirements", () => {
    expect(passwordRequirements("abcdefgh12").every((item) => item.met)).toBe(true);
  });
});

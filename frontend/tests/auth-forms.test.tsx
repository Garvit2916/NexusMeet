import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { ApiError } from "@/services/api";

const replace = vi.fn();
const signIn = vi.fn();
const signUp = vi.fn();
const isAuthenticated = { value: false };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    signIn,
    signUp,
    error: null,
    isLoading: false,
    isAuthenticated: isAuthenticated.value,
  }),
}));

const VALID_PASSWORD = "smoke-test-123";

async function fillSignUp(user: ReturnType<typeof userEvent.setup>, overrides?: { name?: string; email?: string; password?: string; confirm?: string }) {
  await user.type(screen.getByLabelText("Full name"), overrides?.name ?? "Ada Lovelace");
  await user.type(screen.getByLabelText("Work email"), overrides?.email ?? "ada@nexusmeet.app");
  await user.type(screen.getByLabelText("Password"), overrides?.password ?? VALID_PASSWORD);
  await user.type(
    screen.getByLabelText("Confirm password"),
    overrides?.confirm ?? overrides?.password ?? VALID_PASSWORD,
  );
  await user.click(screen.getByLabelText(/I agree to the terms/i));
}

describe("SignInForm", () => {
  beforeEach(() => {
    replace.mockReset();
    signIn.mockReset();
    isAuthenticated.value = false;
  });

  it("submits credentials and routes to the dashboard", async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(undefined);
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "demo@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), "demo12345");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signIn).toHaveBeenCalledWith({ email: "demo@nexusmeet.app", password: "demo12345" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("trims surrounding whitespace from the email before submitting", async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(undefined);
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "  demo@nexusmeet.app  ");
    await user.type(screen.getByLabelText("Password"), "demo12345");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signIn).toHaveBeenCalledWith({ email: "demo@nexusmeet.app", password: "demo12345" });
  });

  it("fills the demo credentials that match the seeded account", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.click(screen.getByRole("button", { name: /fill the demo account/i }));
    expect(screen.getByLabelText("Work email")).toHaveValue("demo@nexusmeet.app");
    expect(screen.getByLabelText("Password")).toHaveValue("demo12345");
  });

  it("toggles password visibility without losing the value", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    const password = screen.getByLabelText("Password");
    await user.type(password, "demo12345");
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("demo12345");

    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("blocks submit and explains a malformed email without calling the API", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "demo12345");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("blocks submit when the password is shorter than the API minimum", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "demo@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // The banner repeats the first field message, so scope to the alert.
    const passwordError = await screen.findAllByText(/at least 8 characters/i);
    expect(passwordError.length).toBeGreaterThan(0);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("keeps the user on the page and explains a rejected sign in", async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue(new Error("invalid credentials"));
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "demo@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not sign you in. Please try again.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("surfaces the API error message instead of a generic one", async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue(
      new ApiError("The server is taking too long to respond. It may be starting up, so wait a moment and try again.", 408),
    );
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "demo@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), "demo12345");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("It may be starting up");
    expect(replace).not.toHaveBeenCalled();
  });

  it("maps a 422 password error onto the password field instead of a generic banner", async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue(
      new ApiError("Request validation failed", 422, "VALIDATION_ERROR", {
        errors: [
          { field: "body.password", message: "String should have at least 8 characters", type: "string_too_short" },
        ],
      }),
    );
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "demo@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), "demo12345");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const fieldError = await screen.findAllByText("Use at least 8 characters.");
    expect(fieldError.length).toBeGreaterThan(0);
    expect(screen.queryByText("Request validation failed")).not.toBeInTheDocument();
  });

  it("clears the password after a rejected attempt so it can be retyped", async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue(new ApiError("Email or password is incorrect", 401, "INVALID_CREDENTIALS"));
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "demo@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email or password is incorrect")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("redirects a signed-in user away from the sign-in page", async () => {
    isAuthenticated.value = true;
    render(<SignInForm />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
});

describe("SignUpForm", () => {
  beforeEach(() => {
    replace.mockReset();
    signUp.mockReset();
    isAuthenticated.value = false;
  });

  it("registers an account and routes to the dashboard", async () => {
    const user = userEvent.setup();
    signUp.mockResolvedValue(undefined);
    render(<SignUpForm />);

    await fillSignUp(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUp).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@nexusmeet.app",
      password: VALID_PASSWORD,
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("refuses to submit until the terms are accepted", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Work email"), "ada@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Confirm password"), VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/accept the terms/i)).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation before calling the API", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await fillSignUp(user, { confirm: "something-else-123" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("requires a confirmation password", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Work email"), "ada@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), VALID_PASSWORD);
    await user.click(screen.getByLabelText(/I agree to the terms/i));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Confirm your password.")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a one-character name", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await fillSignUp(user, { name: "A" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Use at least 2 characters.")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("surfaces the API error message when registration is rejected", async () => {
    const user = userEvent.setup();
    signUp.mockRejectedValue(new ApiError("An account with this email already exists", 409, "EMAIL_ALREADY_REGISTERED"));
    render(<SignUpForm />);

    await fillSignUp(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists");
    expect(replace).not.toHaveBeenCalled();
  });

  it("maps a duplicate-email 422 onto the email field", async () => {
    const user = userEvent.setup();
    signUp.mockRejectedValue(
      new ApiError("Request validation failed", 422, "VALIDATION_ERROR", {
        errors: [
          {
            field: "body.email",
            message: "value is not a valid email address: An email address must have an @-sign.",
            type: "value_error",
          },
        ],
      }),
    );
    render(<SignUpForm />);

    await fillSignUp(user, { email: "ada@nexusmeet.app" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const matches = await screen.findAllByText(/Enter a valid email address/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows a live strength meter once a password is typed", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    expect(screen.queryByText(/Too weak|Weak|Fair|Good|Strong/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Password"), "abc");
    expect(await screen.findByText("Too weak")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "Str0ng-Passphrase-2024");
    expect(await screen.findByText("Strong")).toBeInTheDocument();
  });

  it("ticks off each password requirement as it is met", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Password"), "abcdefghij1");
    expect(await screen.findByText("Contains a letter")).toBeInTheDocument();
    expect(await screen.findByText("Contains a number")).toBeInTheDocument();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { ApiError } from "@/services/api";

const replace = vi.fn();
const signIn = vi.fn();
const signUp = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ signIn, signUp, error: null, isLoading: false }),
}));

describe("SignInForm", () => {
  beforeEach(() => {
    replace.mockReset();
    signIn.mockReset();
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

  it("fills the demo credentials that match the seeded account", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.click(screen.getByRole("button", { name: /use the demo account/i }));
    expect(screen.getByLabelText("Work email")).toHaveValue("demo@nexusmeet.app");
    expect(screen.getByLabelText("Password")).toHaveValue("demo12345");
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
    signIn.mockRejectedValue(new ApiError("The server is taking too long to respond. It may be starting up, so wait a moment and try again.", 408));
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Work email"), "demo@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), "demo12345");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("It may be starting up");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("SignUpForm", () => {
  beforeEach(() => {
    replace.mockReset();
    signUp.mockReset();
  });

  it("surfaces the API error message when registration is rejected", async () => {
    const user = userEvent.setup();
    signUp.mockRejectedValue(new ApiError("An account with this email already exists", 409, "EMAIL_ALREADY_REGISTERED"));
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Work email"), "ada@nexusmeet.app");
    await user.type(screen.getByLabelText("Password"), "smoke-test-123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists");
    expect(replace).not.toHaveBeenCalled();
  });
});

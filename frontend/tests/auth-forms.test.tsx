import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "@/components/auth/sign-in-form";

const replace = vi.fn();
const signIn = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ signIn, error: null, isLoading: false }),
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

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not sign you in with those details.");
    expect(replace).not.toHaveBeenCalled();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinForm } from "@/components/forms/join-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("JoinForm", () => {
  beforeEach(() => push.mockReset());

  it("routes a valid room link to the meeting", async () => {
    const user = userEvent.setup();
    render(<JoinForm />);
    await user.type(screen.getByLabelText("Meeting link or code"), "https://nexusmeet.dev/meeting/design-sprint");
    await user.click(screen.getByRole("button", { name: "Continue to meeting" }));
    expect(push).toHaveBeenCalledWith("/meeting/design-sprint");
  });

  it("shows an accessible error for an invalid link", async () => {
    const user = userEvent.setup();
    render(<JoinForm />);
    await user.type(screen.getByLabelText("Meeting link or code"), "https://example.com/calendar/event");
    await user.click(screen.getByRole("button", { name: "Continue to meeting" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Paste a valid NexusMeet link");
    expect(push).not.toHaveBeenCalled();
  });
});

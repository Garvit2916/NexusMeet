import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScheduleForm } from "@/components/forms/schedule-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

describe("ScheduleForm", () => {
  it("requires a meeting name before creating a room", async () => {
    const user = userEvent.setup();
    render(<ScheduleForm />);
    await user.click(screen.getByRole("button", { name: "Create meeting" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give your meeting a name");
  });

  it("validates invite email addresses", async () => {
    const user = userEvent.setup();
    render(<ScheduleForm />);
    await user.type(screen.getByLabelText("Meeting name *"), "Design review");
    await user.type(screen.getByLabelText("Invite guests (optional)"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create meeting" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Check the invite emails");
  });
});

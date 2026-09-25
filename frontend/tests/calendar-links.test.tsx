import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarLinks } from "@/components/meetings/calendar-links";
import type { Meeting } from "@/lib/types";

const meeting: Meeting = {
  id: "mtg_0123456789abcdef0123456789abcdef",
  title: "Design, review",
  description: "A short sync",
  startTime: "2026-09-25T10:00:00.000Z",
  endTime: "2026-09-25T10:30:00.000Z",
  timezone: "Asia_Kolkata",
  status: "upcoming",
  meetingCode: "NM-DESIGN",
  joinUrl: "/meeting/mtg_0123456789abcdef0123456789abcdef",
  roomId: "room-1",
  host: { id: "user-1", name: "Avery Stone", email: "avery@nexusmeet.app", initials: "AS", role: "host" },
  participants: [],
  createdAt: "2026-09-20T08:00:00.000Z",
};

const inviteUrl = "https://nexusmeet.app/meeting/mtg_0123456789abcdef0123456789abcdef";

let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;
let clickSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createObjectUrl = vi.fn(() => "blob:nexusmeet");
  revokeObjectUrl = vi.fn();
  clickSpy = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { value: createObjectUrl, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectUrl, configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clickSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CalendarLinks", () => {
  it("links to Google Calendar with the meeting prefilled", () => {
    render(<CalendarLinks meeting={meeting} inviteUrl={inviteUrl} />);
    const link = screen.getByRole("link", { name: /Google/i });
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.host).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Design, review");
    expect(url.searchParams.get("dates")).toBe("20260925T100000Z/20260925T103000Z");
    expect(url.searchParams.get("ctz")).toBe("Asia/Kolkata");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("links to Outlook with ISO start and end times", () => {
    render(<CalendarLinks meeting={meeting} inviteUrl={inviteUrl} />);
    const url = new URL(screen.getByRole("link", { name: /Outlook/i }).getAttribute("href") ?? "");
    expect(url.host).toBe("outlook.live.com");
    expect(url.searchParams.get("startdt")).toBe("2026-09-25T10:00:00.000Z");
    expect(url.searchParams.get("enddt")).toBe("2026-09-25T10:30:00.000Z");
  });

  it("downloads an .ics file and reports it", async () => {
    const onNotice = vi.fn();
    render(<CalendarLinks meeting={meeting} inviteUrl={inviteUrl} onNotice={onNotice} />);
    await userEvent.click(screen.getByRole("button", { name: /Download calendar file/i }));

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:nexusmeet");
    expect(onNotice).toHaveBeenCalledWith("Calendar file downloaded");

    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("design-review.ics");
    expect(anchor.href).toBe("blob:nexusmeet");
  });
});

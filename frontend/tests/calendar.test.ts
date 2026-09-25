import { describe, expect, it } from "vitest";
import { buildCalendarFile, buildGoogleCalendarUrl, buildOutlookCalendarUrl, calendarFileName, normalizeTimeZone } from "@/lib/calendar";

const event = {
  meetingId: "mtg_0123456789abcdef0123456789abcdef",
  title: "Design, review",
  description: "A short sync",
  startTime: "2026-09-25T10:00:00.000Z",
  endTime: "2026-09-25T10:30:00.000Z",
  joinUrl: "https://nexusmeet.app/meeting/mtg_0123456789abcdef0123456789abcdef",
  timezone: "Asia_Kolkata",
  organizerName: "Avery Stone",
  organizerEmail: "avery@nexusmeet.app",
  timestamp: "2026-09-20T08:00:00.000Z",
};

/** Reverses RFC 5545 line folding so logical lines can be asserted. */
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, "");

describe("buildCalendarFile", () => {
  it("creates a valid event with the join link and UTC stamps", () => {
    const calendar = unfold(buildCalendarFile(event));
    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).toContain("VERSION:2.0");
    expect(calendar).toContain("SUMMARY:Design\\, review");
    expect(calendar).toContain("DESCRIPTION:A short sync\\n\\nJoin: https://nexusmeet.app/meeting/mtg_0123456789abcdef0123456789abcdef");
    expect(calendar).toContain("DTSTART:20260925T100000Z");
    expect(calendar).toContain("DTEND:20260925T103000Z");
    expect(calendar).toContain("DTSTAMP:20260920T080000Z");
  });

  it("uses CRLF line endings and a stable UID per meeting", () => {
    const calendar = buildCalendarFile(event);
    expect(calendar.includes("\r\n")).toBe(true);
    expect(unfold(calendar)).toContain("UID:mtg_0123456789abcdef0123456789abcdef@nexusmeet.app");
    expect(buildCalendarFile(event)).toBe(calendar);
  });

  it("escapes backslashes, semicolons, commas, and newlines", () => {
    const calendar = unfold(buildCalendarFile({ ...event, title: "Budget; Q&A", description: "line one\nline two, with a \\ slash" }));
    expect(calendar).toContain("SUMMARY:Budget\\; Q&A");
    expect(calendar).toContain("line one\\nline two\\, with a \\\\ slash");
  });

  it("adds an organizer, status, and a ten minute reminder", () => {
    const calendar = unfold(buildCalendarFile(event));
    expect(calendar).toContain("ORGANIZER;CN=Avery Stone:mailto:avery@nexusmeet.app");
    expect(calendar).toContain("STATUS:CONFIRMED");
    expect(calendar).toContain("BEGIN:VALARM");
    expect(calendar).toContain("TRIGGER:-PT10M");
    expect(calendar).toContain("END:VALARM");
  });

  it("quotes organizer names that contain reserved characters", () => {
    const calendar = unfold(buildCalendarFile({ ...event, organizerName: "Stone, Avery" }));
    expect(calendar).toContain('ORGANIZER;CN="Stone, Avery":mailto:avery@nexusmeet.app');
  });

  it("folds long lines to 75 octets with continuation markers", () => {
    const raw = buildCalendarFile({ ...event, description: "x".repeat(400) });
    const descriptionLines = raw.split("\r\n").filter((line) => line.startsWith("DESCRIPTION") || line.startsWith(" "));
    expect(descriptionLines.length).toBeGreaterThan(1);
    for (const line of descriptionLines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(76);
    }
    expect(unfold(raw)).toContain(`DESCRIPTION:${"x".repeat(400)}`);
  });

  it("keeps the event valid when the end time is not after the start", () => {
    const calendar = unfold(buildCalendarFile({ ...event, endTime: "2026-09-25T10:00:00.000Z" }));
    expect(calendar).toContain("DTSTART:20260925T100000Z");
    expect(calendar).toContain("DTEND:20260925T103000Z");
  });
});

describe("buildGoogleCalendarUrl", () => {
  it("builds a template URL with title, times, details, and timezone", () => {
    const url = new URL(buildGoogleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Design, review");
    expect(url.searchParams.get("dates")).toBe("20260925T100000Z/20260925T103000Z");
    expect(url.searchParams.get("details")).toContain("Join: https://nexusmeet.app/meeting/mtg_0123456789abcdef0123456789abcdef");
    expect(url.searchParams.get("location")).toBe(event.joinUrl);
    expect(url.searchParams.get("ctz")).toBe("Asia/Kolkata");
  });
});

describe("buildOutlookCalendarUrl", () => {
  it("builds a compose deep link with ISO timestamps", () => {
    const url = new URL(buildOutlookCalendarUrl(event));
    expect(url.origin + url.pathname).toBe("https://outlook.live.com/calendar/0/deeplink/compose");
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("subject")).toBe("Design, review");
    expect(url.searchParams.get("startdt")).toBe("2026-09-25T10:00:00.000Z");
    expect(url.searchParams.get("enddt")).toBe("2026-09-25T10:30:00.000Z");
    expect(url.searchParams.get("body")).toContain("Join: https://nexusmeet.app/meeting/mtg_0123456789abcdef0123456789abcdef");
  });
});

describe("helpers", () => {
  it("normalizes API timezone values and rejects unknown zones", () => {
    expect(normalizeTimeZone("Asia_Kolkata")).toBe("Asia/Kolkata");
    expect(normalizeTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(normalizeTimeZone("Not/AZone")).toBeUndefined();
    expect(normalizeTimeZone(undefined)).toBeUndefined();
  });

  it("builds a safe download filename", () => {
    expect(calendarFileName("Design, review")).toBe("design-review.ics");
    expect(calendarFileName("  ***  ")).toBe("nexusmeet-meeting.ics");
  });
});

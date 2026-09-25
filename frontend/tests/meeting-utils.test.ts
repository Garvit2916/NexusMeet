import { describe, expect, it } from "vitest";
import { buildCalendarFile, parseMeetingLink } from "@/lib/meeting-utils";

describe("parseMeetingLink", () => {
  it("extracts a meeting ID from a room URL", () => {
    expect(parseMeetingLink("https://nexusmeet.dev/meeting/design-sprint?ref=invite")).toEqual({ meetingId: "design-sprint", source: "https://nexusmeet.dev/meeting/design-sprint?ref=invite" });
  });

  it("extracts backend meeting IDs from room URLs", () => {
    const meetingId = `mtg_${"a".repeat(32)}`;
    expect(parseMeetingLink(`https://nexusmeet.dev/meeting/${meetingId}?ref=invite`)).toEqual({ meetingId, source: `https://nexusmeet.dev/meeting/${meetingId}?ref=invite` });
  });

  it("normalizes a meeting code", () => {
    expect(parseMeetingLink(" nm-design ")).toEqual({ code: "NM-DESIGN", source: "nm-design" });
  });

  it("rejects values that are not meeting links", () => {
    expect(parseMeetingLink("https://example.com/calendar/event")).toBeNull();
    expect(parseMeetingLink("not a meeting")).toBeNull();
  });
});

describe("buildCalendarFile", () => {
  it("creates a valid calendar event with the join link", () => {
    const calendar = buildCalendarFile({ title: "Design, review", description: "A short sync", startTime: "2026-09-25T10:00:00.000Z", endTime: "2026-09-25T10:30:00.000Z", joinUrl: "https://nexusmeet.dev/meeting/design-review" });
    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).toContain("SUMMARY:Design\\, review");
    expect(calendar).toContain("DESCRIPTION:A short sync\\n\\nJoin: https://nexusmeet.dev/meeting/design-review");
    expect(calendar).toContain("DTSTART:20260925T100000Z");
  });
});

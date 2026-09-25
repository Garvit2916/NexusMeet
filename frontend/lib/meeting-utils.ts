export type ParsedMeetingLink = {
  meetingId?: string;
  code?: string;
  source: string;
};

const meetingPathPattern = /\/meeting\/([^/?#]+)/i;
const shortPathPattern = /\/m\/([^/?#]+)/i;
const validIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/i;
const backendIdPattern = /^mtg_[0-9a-f]{32}$/i;

function normalizeCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function parseMeetingLink(value: string): ParsedMeetingLink | null {
  const source = value.trim();
  if (!source) return null;

  const directCode = normalizeCode(source);
  if (/^NM-[A-Z0-9-]{2,30}$/i.test(source)) {
    return { code: directCode, source };
  }

  if (backendIdPattern.test(source) || validIdPattern.test(source)) {
    return { meetingId: source.toLowerCase(), source };
  }

  try {
    const url = new URL(source);
    const meetingMatch = url.pathname.match(meetingPathPattern);
    if (meetingMatch) {
      return { meetingId: meetingMatch[1].toLowerCase(), source };
    }
    const shortMatch = url.pathname.match(shortPathPattern);
    if (shortMatch) {
      return { code: normalizeCode(shortMatch[1]), source };
    }
  } catch {
    return null;
  }

  return null;
}

export function meetingCodeFromLink(value: string) {
  return parseMeetingLink(value)?.code ?? value.trim().toUpperCase();
}

export function buildJoinUrl(origin: string, meetingId: string) {
  return `${origin.replace(/\/$/, "")}/meeting/${encodeURIComponent(meetingId)}`;
}

export function buildCalendarFile({
  title,
  description,
  startTime,
  endTime,
  joinUrl,
}: {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  joinUrl: string;
}) {
  const format = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const escape = (value: string) => value.replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
  const createId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NexusMeet//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${createId()}@nexusmeet.local`,
    `DTSTAMP:${format(new Date().toISOString())}`,
    `DTSTART:${format(startTime)}`,
    `DTEND:${format(endTime)}`,
    `SUMMARY:${escape(title)}`,
    `DESCRIPTION:${escape(`${description}\n\nJoin: ${joinUrl}`)}`,
    `URL:${joinUrl}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

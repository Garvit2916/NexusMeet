export type CalendarEventInput = {
  meetingId: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  joinUrl: string;
  timezone?: string;
  organizerName?: string;
  organizerEmail?: string;
  timestamp?: string;
};

const PRODID = "-//NexusMeet//Meeting Scheduler//EN";
const CRLF = "\r\n";
const MINIMUM_DURATION_MS = 30 * 60000;
const encoder = new TextEncoder();

function toDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return date;
}

function resolveRange(startTime: string, endTime: string) {
  const start = toDate(startTime);
  const requestedEnd = toDate(endTime);
  const end = requestedEnd.getTime() > start.getTime() ? requestedEnd : new Date(start.getTime() + MINIMUM_DURATION_MS);
  return { start, end };
}

function eventTitle(title: string) {
  return title.trim() || "NexusMeet meeting";
}

export function buildEventDescription({ description, joinUrl }: CalendarEventInput) {
  return [description?.trim(), `Join: ${joinUrl}`].filter(Boolean).join("\n\n");
}

/** RFC 5545 text escaping: backslash first, then the reserved delimiters. */
function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Parameter values containing `,;:"` must be sent as a quoted string. */
function formatParameter(value: string) {
  const cleaned = value.replace(/"/g, "'").trim();
  return /[,;:"\n]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

/** RFC 5545 line folding at 75 octets, continuation lines prefixed with a space. */
function foldLine(line: string) {
  if (encoder.encode(line).length <= 75) return line;

  const chunks: string[] = [];
  let current = "";
  let currentLength = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (currentLength + size > 75) {
      chunks.push(current);
      current = character;
      currentLength = size + 1;
    } else {
      current += character;
      currentLength += size;
    }
  }
  if (current) chunks.push(current);
  return chunks.join(`${CRLF} `);
}

function toUtcStamp(value: string | Date) {
  const date = typeof value === "string" ? toDate(value) : value;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Accepts both `Asia/Kolkata` and the `Asia_Kolkata` form used by older records. */
export function normalizeTimeZone(timezone?: string) {
  const value = timezone?.trim();
  if (!value) return undefined;
  const candidates = value.includes("_") ? [value.replace(/_/g, "/"), value] : [value];
  for (const candidate of candidates) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate });
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function calendarFileName(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "nexusmeet-meeting"}.ics`;
}

/**
 * RFC 5545 calendar file. The UID is derived from the meeting ID, so importing
 * the same meeting twice updates one event instead of creating duplicates.
 */
export function buildCalendarFile(input: CalendarEventInput) {
  const { start, end } = resolveRange(input.startTime, input.endTime);
  const title = eventTitle(input.title);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(`${input.meetingId}@nexusmeet.app`)}`,
    `DTSTAMP:${toUtcStamp(input.timestamp ?? new Date())}`,
    `DTSTART:${toUtcStamp(start)}`,
    `DTEND:${toUtcStamp(end)}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(buildEventDescription(input))}`,
    `URL:${input.joinUrl}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE",
  ];

  if (input.organizerEmail) {
    const name = formatParameter(input.organizerName || input.organizerEmail);
    lines.push(`ORGANIZER;CN=${name}:mailto:${input.organizerEmail}`);
  }

  lines.push("BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(title)}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join(CRLF);
}

/** Opens the Google Calendar "new event" prefilled from a template URL. */
export function buildGoogleCalendarUrl(input: CalendarEventInput) {
  const { start, end } = resolveRange(input.startTime, input.endTime);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventTitle(input.title),
    dates: `${toUtcStamp(start)}/${toUtcStamp(end)}`,
    details: buildEventDescription(input),
    location: input.joinUrl,
  });
  const zone = normalizeTimeZone(input.timezone);
  if (zone) params.set("ctz", zone);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Opens the Outlook web calendar composer with the event prefilled. */
export function buildOutlookCalendarUrl(input: CalendarEventInput) {
  const { start, end } = resolveRange(input.startTime, input.endTime);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: eventTitle(input.title),
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: buildEventDescription(input),
    location: input.joinUrl,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

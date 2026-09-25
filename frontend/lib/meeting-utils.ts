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

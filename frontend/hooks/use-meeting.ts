"use client";

import { useCallback, useEffect, useState } from "react";
import { meetingService } from "@/services/meeting-service";
import type { AsyncStatus, Meeting } from "@/lib/types";

export function useMeeting(meetingId: string) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setStatus("loading");
      setError(null);
    }
    try {
      const nextMeeting = await meetingService.getMeeting(meetingId);
      setMeeting(nextMeeting);
      setStatus(nextMeeting ? "success" : "error");
      if (!nextMeeting) setError("This meeting could not be found.");
    } catch {
      if (!options.silent) {
        setError("We could not load this meeting. Try again in a moment.");
        setStatus("error");
      }
    }
  }, [meetingId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { meeting, status, error, refresh };
}

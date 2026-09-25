"use client";

import { useCallback, useEffect, useState } from "react";
import { meetingService } from "@/services/meeting-service";
import type { AsyncStatus, Meeting } from "@/lib/types";

export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await meetingService.listMeetings();
      setMeetings(response.meetings);
      setStatus("success");
    } catch {
      setError("We could not load your meetings. Try again in a moment.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { meetings, status, error, refresh };
}

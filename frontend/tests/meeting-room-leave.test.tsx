import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/api";
import type { Meeting } from "@/lib/types";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

// A stable user reference, matching how the real auth provider holds it in state.
const authUser = { id: "usr_host", name: "Ada Host", email: "ada@example.com", initials: "AH", role: "host" as const };

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: authUser, signOut: () => {} }),
}));

const endMeeting = vi.fn();
const leaveMeeting = vi.fn();
const joinMeeting = vi.fn();

vi.mock("@/services/meeting-service", () => ({
  meetingService: {
    endMeeting,
    leaveMeeting,
    joinMeeting,
    updateMediaState: vi.fn().mockResolvedValue(undefined),
    removeParticipant: vi.fn(),
  },
}));

let meetingFromHook: Meeting | null = null;

vi.mock("@/hooks/use-meeting", () => ({
  useMeeting: () => ({ meeting: meetingFromHook, status: "success", error: null, refresh: vi.fn() }),
}));

/**
 * Mirrors the real hook's two properties that matter here: the returned media
 * object is a new reference on every render, while its callbacks are stable.
 */
let renderCount = 0;
let stopCount = 0;

vi.mock("@/hooks/use-local-media", async () => {
  const { useCallback, useState } = await import("react");
  return {
    useLocalMedia: () => {
      renderCount += 1;
      const [state, setState] = useState({
        stream: null,
        isStarting: false,
        isSupported: true,
        error: null as string | null,
        micEnabled: false,
        cameraEnabled: false,
        permission: "prompt",
      });
      const stop = useCallback(() => {
        stopCount += 1;
        setState((current) => ({ ...current, stream: null, micEnabled: false, cameraEnabled: false }));
      }, []);
      return {
        ...state,
        start: useCallback(async () => null, []),
        stop,
        toggleMic: useCallback(() => {}, []),
        toggleCamera: useCallback(() => {}, []),
        setMicEnabled: useCallback(() => {}, []),
        refreshPermission: useCallback(async () => "prompt", []),
      };
    },
  };
});

const webrtcState = {
  status: "connected",
  peerCount: 0,
  remoteParticipants: [],
  mutedByHost: false,
  publishMediaState: vi.fn(),
  diagnostics: null,
};

vi.mock("@/hooks/use-webrtc-meeting", () => ({
  useWebRTCMeeting: () => webrtcState,
}));

const liveMeeting: Meeting = {
  id: "mtg_1",
  title: "Design sync",
  description: "",
  startTime: "2026-01-01T10:00:00Z",
  endTime: "2026-01-01T11:00:00Z",
  timezone: "UTC",
  status: "live",
  meetingCode: "ABC123",
  joinUrl: "/meeting/mtg_1",
  roomId: "room_1",
  host: { id: "usr_host", name: "Ada Host", email: "ada@example.com", initials: "AH", role: "host" },
  participants: [],
  createdAt: "2026-01-01T09:00:00Z",
};

const endedMeeting: Meeting = { ...liveMeeting, status: "ended" };

const { MeetingRoom } = await import("@/components/room/meeting-room");

describe("MeetingRoom leave after the meeting ended", () => {
  beforeEach(() => {
    replace.mockReset();
    endMeeting.mockReset();
    leaveMeeting.mockReset();
    joinMeeting.mockReset();
    joinMeeting.mockResolvedValue(liveMeeting);
    endMeeting.mockResolvedValue(endedMeeting);
    leaveMeeting.mockResolvedValue(liveMeeting);
    meetingFromHook = liveMeeting;
    renderCount = 0;
  });

  async function joinRoom(user: ReturnType<typeof userEvent.setup>) {
    render(<MeetingRoom meetingId="mtg_1" />);
    await user.type(await screen.findByLabelText("Your display name"), "Ada");
    await user.click(screen.getByRole("button", { name: /Join meeting/i }));
    await screen.findByRole("button", { name: "Leave" });
  }

  it("navigates away without a stuck error when leaving an ended meeting", async () => {
    const user = userEvent.setup();
    // The backend rejects leave with 409 INVALID_STATUS_TRANSITION once ended.
    leaveMeeting.mockRejectedValue(
      new ApiError("This meeting is no longer live", 409, "INVALID_STATUS_TRANSITION"),
    );

    await joinRoom(user);

    await user.click(screen.getByRole("button", { name: "End for all" }));
    await user.click(await screen.findByRole("button", { name: /^End meeting$/i }));

    await waitFor(() => expect(endMeeting).toHaveBeenCalledWith("mtg_1"));

    await user.click(screen.getByRole("button", { name: "Leave" }));

    // Navigation must happen even though the leave call 409s.
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/meeting/mtg_1"));
  });

  it("does not render an endless stream of state updates once the room is closed", async () => {
    const user = userEvent.setup();
    // Reject only after the leave click has been issued, so the unmount cleanup
    // path still receives a real promise from the mock.
    leaveMeeting.mockImplementation(() => Promise.resolve(liveMeeting));

    await joinRoom(user);
    await user.click(screen.getByRole("button", { name: "End for all" }));
    await user.click(await screen.findByRole("button", { name: /^End meeting$/i }));

    await screen.findByText(/This meeting has ended/i);

    // A render loop pegs the event loop and starves click handling, which is
    // what made "Leave" look dead once the host ended the meeting.
    await waitFor(() => expect(screen.getByRole("button", { name: "Leave" })).toBeEnabled());

    // The room must settle into a stable state rather than re-rendering forever.
    const before = renderCount;
    const stopsBefore = stopCount;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const rendersSettled = renderCount - before;
    expect({ rendersSettled, stopsSettled: stopCount - stopsBefore }).toEqual({
      rendersSettled: 0,
      stopsSettled: 0,
    });
  });

  it("does not surface an error when the ended-room leave call is rejected", async () => {
    const user = userEvent.setup();
    leaveMeeting.mockRejectedValue(
      new ApiError("This meeting is no longer live", 409, "INVALID_STATUS_TRANSITION"),
    );

    await joinRoom(user);
    await user.click(screen.getByRole("button", { name: "End for all" }));
    await user.click(await screen.findByRole("button", { name: /^End meeting$/i }));
    await screen.findByText(/This meeting has ended/i);

    await user.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/meeting/mtg_1"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
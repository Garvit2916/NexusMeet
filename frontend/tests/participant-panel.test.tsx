import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParticipantPanel } from "@/components/room/participant-panel";
import type { Participant } from "@/lib/types";

const host: Participant = {
  id: "1",
  userId: "usr_host",
  name: "Demo User",
  email: "demo@nexusmeet.app",
  initials: "DU",
  role: "host",
  joinedAt: "2026-01-01T10:00:00Z",
  isOnline: true,
  audioEnabled: true,
  videoEnabled: true,
  screenSharing: false,
  isMuted: false,
  mutedByHost: false,
  isRemoved: false,
};

const attendee: Participant = {
  ...host,
  id: "2",
  userId: "usr_guest",
  name: "Alex Guest",
  email: "alex@nexusmeet.app",
  initials: "AG",
  role: "attendee",
  audioEnabled: false,
  isMuted: true,
  mutedByHost: true,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof ParticipantPanel>> = {}) {
  const props = {
    participants: [host, attendee],
    open: true,
    canManageParticipants: false,
    pendingParticipantId: null,
    onClose: vi.fn(),
    onToggleMute: vi.fn(),
    onRemoveParticipant: vi.fn(),
    ...overrides,
  };
  render(<ParticipantPanel {...props} />);
  return props;
}

describe("ParticipantPanel", () => {
  it("hides host controls from guests", () => {
    renderPanel();
    expect(screen.getByTestId("participant-2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mute Alex Guest")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove Alex Guest")).not.toBeInTheDocument();
  });

  it("lets the host mute and remove guests but never the host", () => {
    const props = renderPanel({ canManageParticipants: true });
    expect(screen.getByLabelText("Unmute Alex Guest")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Alex Guest")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Mute Demo User/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Remove Demo User/)).not.toBeInTheDocument();
    expect(props.onToggleMute).not.toHaveBeenCalled();
    expect(props.onRemoveParticipant).not.toHaveBeenCalled();
  });

  it("reports the selected participant to the host", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ canManageParticipants: true });

    await user.click(screen.getByLabelText("Unmute Alex Guest"));
    expect(props.onToggleMute).toHaveBeenCalledWith(attendee);

    await user.click(screen.getByLabelText("Remove Alex Guest"));
    expect(props.onRemoveParticipant).toHaveBeenCalledWith(attendee);
  });

  it("disables controls for the participant with a pending request", () => {
    renderPanel({ canManageParticipants: true, pendingParticipantId: "2" });
    expect(screen.getByLabelText("Unmute Alex Guest")).toBeDisabled();
    expect(screen.getByLabelText("Remove Alex Guest")).toBeDisabled();
  });

  it("explains server-side state to the host", () => {
    renderPanel({ canManageParticipants: true });
    expect(screen.getByText(/stored on the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/synchronized with the room/i)).not.toBeInTheDocument();
  });
});

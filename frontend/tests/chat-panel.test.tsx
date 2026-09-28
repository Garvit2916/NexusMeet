import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/room/chat-panel";
import { CHAT_MAX_LENGTH, type ChatMessage } from "@/lib/signaling";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    userId: "usr_guest",
    participantId: 2,
    senderName: "Alex Guest",
    body: "Hello everyone",
    createdAt: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  const props = {
    open: true,
    messages: [message()],
    localUserId: "usr_host",
    error: null,
    canSend: true,
    onSend: vi.fn(() => true),
    onClearError: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ChatPanel {...props} />);
  return props;
}

describe("ChatPanel", () => {
  it("renders nothing while closed", () => {
    renderPanel({ open: false });
    expect(screen.queryByLabelText("Meeting chat")).not.toBeInTheDocument();
  });

  it("shows incoming messages with their sender", () => {
    renderPanel();
    expect(screen.getByText("Hello everyone")).toBeInTheDocument();
    expect(screen.getByText("Alex Guest")).toBeInTheDocument();
  });

  it("labels the local user's own messages as You", () => {
    renderPanel({ localUserId: "usr_guest" });
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("shows an empty state before anyone has spoken", () => {
    renderPanel({ messages: [] });
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it("sends on Enter and clears the draft", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const input = screen.getByLabelText("Message");

    await user.type(input, "hello room{Enter}");

    expect(props.onSend).toHaveBeenCalledWith("hello room");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("sends from the button", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.type(screen.getByLabelText("Message"), "via button");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(props.onSend).toHaveBeenCalledWith("via button");
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.type(screen.getByLabelText("Message"), "line one{Shift>}{Enter}{/Shift}line two");

    expect(props.onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Message")).toHaveValue("line one\nline two");
  });

  it("refuses a whitespace-only draft without calling the sender", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const input = screen.getByLabelText("Message");

    await user.type(input, "   {Enter}");

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("collapses whitespace the same way the server does", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.type(screen.getByLabelText("Message"), "  too    many  spaces  {Enter}");

    expect(props.onSend).toHaveBeenCalledWith("too many spaces");
  });

  it("keeps the draft when the send is refused", async () => {
    const user = userEvent.setup();
    renderPanel({ onSend: vi.fn(() => false) });

    await user.type(screen.getByLabelText("Message"), "no socket yet{Enter}");

    expect(screen.getByLabelText("Message")).toHaveValue("no socket yet");
  });

  it("disables sending while the media connection is down", async () => {
    const props = renderPanel({ canSend: false });
    const input = screen.getByLabelText("Message");

    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection and lets the user dismiss it", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ error: "That message was too long." });

    expect(screen.getByTestId("chat-error")).toHaveTextContent("That message was too long.");

    await user.type(screen.getByLabelText("Message"), "a");
    expect(props.onClearError).toHaveBeenCalled();
  });

  /**
   * The security-relevant case: a message body is attacker-controlled text from
   * every attendee, so it must reach the DOM as text and never as markup.
   */
  it("renders a script-shaped body as inert text", () => {
    const payload = "<img src=x onerror=\"alert('xss')\"><script>alert(1)</script>";
    const { container } = render(
      <ChatPanel
        open
        messages={[message({ body: payload })]}
        localUserId="usr_host"
        error={null}
        canSend
        onSend={() => true}
        onClearError={() => {}}
        onClose={() => {}}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(payload)).toBeInTheDocument();
  });

  it("refuses an overlong draft before it is sent", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    await user.click(input);
    await user.paste("a".repeat(CHAT_MAX_LENGTH + 1));

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("closes on demand", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByLabelText("Close chat"));

    expect(props.onClose).toHaveBeenCalled();
  });
});

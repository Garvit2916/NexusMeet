"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import {
  chatDraftError,
  CHAT_MAX_LENGTH,
  normalizeChatDraft,
  type ChatMessage,
} from "@/lib/signaling";

type ChatPanelProps = {
  open: boolean;
  messages: ChatMessage[];
  /** Stable identity of the local user, used to align the sender's own messages. */
  localUserId: string;
  error: string | null;
  canSend: boolean;
  onSend: (body: string) => boolean;
  onClearError: () => void;
  onClose: () => void;
};

function formatTime(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The in-meeting chat panel.
 *
 * Message bodies are rendered as React text children, which escape them, so a
 * message can never introduce markup. There is deliberately no
 * `dangerouslySetInnerHTML` anywhere in this component: chat is the one place
 * where attacker-controlled text arrives from every participant, and rendering
 * it as markup would hand any attendee script execution in everyone else's
 * browser.
 */
export function ChatPanel({
  open,
  messages,
  localUserId,
  error,
  canSend,
  onSend,
  onClearError,
  onClose,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Stick to the newest message, but only when the user is already near the
  // bottom, so reading scrollback is not yanked away by new arrivals.
  const pinnedToBottomRef = useRef(true);
  useEffect(() => {
    const log = logRef.current;
    if (!log || !pinnedToBottomRef.current) return;
    log.scrollTop = log.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const normalizedDraft = normalizeChatDraft(draft);
  const remaining = CHAT_MAX_LENGTH - normalizedDraft.length;
  const draftError = useMemo(
    () => chatDraftError(draft, canSend),
    [canSend, draft],
  );

  function handleScroll() {
    const log = logRef.current;
    if (!log) return;
    const distance = log.scrollHeight - log.scrollTop - log.clientHeight;
    pinnedToBottomRef.current = distance < 48;
  }

  function submit() {
    if (draftError) return;
    // The normalised text is what gets sent, not the raw draft: it is the same
    // value the length check approved, so what was validated is exactly what
    // reaches the server.
    const body = normalizeChatDraft(draft);
    if (!body) return;
    // The message returns through the broadcast, so the local list is not
    // appended here; clearing the draft is the only local effect.
    if (onSend(body)) setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      // Enter sends, Shift+Enter is a newline: the convention people expect
      // from every other chat surface.
      event.preventDefault();
      submit();
    }
  }

  if (!open) return null;

  return (
    <aside
      className="flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#2d3136] shadow-2xl lg:w-[320px]"
      aria-label="Meeting chat"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-bold">
          <MessageSquare className="h-4 w-4 text-mint" aria-hidden="true" />
          Chat
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08] text-white/60 transition hover:bg-white/15 hover:text-white"
          aria-label="Close chat"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>

      <ol
        ref={logRef}
        onScroll={handleScroll}
        className="flex min-h-[220px] flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
        aria-live="polite"
        aria-relevant="additions"
        data-testid="chat-log"
      >
        {messages.length === 0 ? (
          <li className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-xs leading-5 text-white/40">
            No messages yet. Anything you send here is shared with everyone in this
            meeting.
          </li>
        ) : null}
        {messages.map((message) => {
          const mine = message.userId === localUserId;
          return (
            <li
              key={message.id}
              className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
            >
              <span className="mb-1 px-1 text-[10px] font-semibold text-white/45">
                {mine ? "You" : message.senderName}
              </span>
              <div
                className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-5 ${
                  mine
                    ? "rounded-br-sm bg-mint text-white"
                    : "rounded-bl-sm bg-white/[0.08] text-white/85"
                }`}
              >
                {message.body}
              </div>
              <span className="mt-1 px-1 text-[10px] text-white/30">
                {formatTime(message.createdAt)}
              </span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <p
          className="mx-3 mb-2 rounded-lg bg-coral/15 px-3 py-2 text-[11px] leading-4 text-[#ffb4b7]"
          role="alert"
          data-testid="chat-error"
        >
          {error}
        </p>
      ) : null}

      <div className="border-t border-white/10 p-3">
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) onClearError();
          }}
          onKeyDown={handleKeyDown}
          rows={2}
          maxLength={CHAT_MAX_LENGTH * 2}
          placeholder={canSend ? "Message everyone" : "Reconnecting…"}
          disabled={!canSend}
          className="w-full resize-none rounded-xl bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-mint disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-white/35">
            {draftError && draftError.startsWith("Messages")
              ? `${remaining} left`
              : "Enter to send · Shift+Enter for a new line"}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!canSend || Boolean(draftError) || !normalizedDraft}
            className="flex items-center gap-1.5 rounded-lg bg-mint px-3 py-1.5 text-xs font-bold text-white transition hover:bg-mint/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}

"use client";

import { Mic, MicOff, MonitorUp, UserMinus, Video, VideoOff, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { Participant } from "@/lib/types";

export function ParticipantPanel({
  participants,
  open,
  canManageParticipants,
  pendingParticipantId,
  onClose,
  onToggleMute,
  onRemoveParticipant,
}: {
  participants: Participant[];
  open: boolean;
  canManageParticipants: boolean;
  pendingParticipantId: string | null;
  onClose: () => void;
  onToggleMute: (participant: Participant) => void;
  onRemoveParticipant: (participant: Participant) => void;
}) {
  if (!open) return null;
  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-line bg-white text-ink shadow-2xl sm:w-80" aria-label="Participants panel">
      <div className="flex items-center justify-between border-b border-line px-5 py-5"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">In this room</p><h2 className="mt-1 text-lg font-bold">Participants <span className="font-normal text-muted">({participants.length})</span></h2></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg bg-canvas text-muted transition hover:bg-sky hover:text-ink" aria-label="Close participants panel"><X className="h-4 w-4" aria-hidden="true" /></button></div>
      <div className="flex-1 space-y-1 overflow-y-auto p-3">
        {participants.length ? participants.map((participant, index) => {
          const isPending = pendingParticipantId === participant.id;
          const isHost = participant.role === "host";
          return (
            <div key={participant.id} className="flex items-center gap-3 rounded-xl p-3 transition hover:bg-canvas" data-testid={`participant-${participant.id}`}>
              <Avatar initials={participant.initials} name={participant.name} size="md" tone={index % 3 === 0 ? "mint" : index % 3 === 1 ? "coral" : "lilac"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{participant.name}</p>
                <p className="truncate text-xs text-muted">
                  {isHost ? "Host" : "Guest"}
                  {participant.mutedByHost ? <span className="ml-1 font-semibold text-coral">Muted by host</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-muted" aria-label={`${participant.name} media status`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${participant.audioEnabled ? "bg-sky text-mint-dark" : "bg-[#fff0f0] text-coral"}`} title={participant.mutedByHost ? "Muted by host" : participant.audioEnabled ? "Microphone on" : "Microphone off"}>{participant.audioEnabled ? <Mic className="h-3.5 w-3.5" aria-hidden="true" /> : <MicOff className="h-3.5 w-3.5" aria-hidden="true" />}</span>
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${participant.videoEnabled ? "bg-sky text-mint-dark" : "bg-[#fff0f0] text-coral"}`} title={participant.videoEnabled ? "Camera on" : "Camera off"}>{participant.videoEnabled ? <Video className="h-3.5 w-3.5" aria-hidden="true" /> : <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />}</span>
                {participant.screenSharing ? <MonitorUp className="h-3.5 w-3.5 text-mint" aria-label="Sharing screen" /> : null}
              </div>
              {canManageParticipants && !isHost ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onToggleMute(participant)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-canvas text-muted transition hover:bg-sky hover:text-ink disabled:opacity-40"
                    aria-label={`${participant.isMuted ? "Unmute" : "Mute"} ${participant.name}`}
                    title={participant.isMuted ? "Unmute participant" : "Mute participant"}
                  >
                    {participant.isMuted ? <Mic className="h-3.5 w-3.5" aria-hidden="true" /> : <MicOff className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onRemoveParticipant(participant)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-canvas text-muted transition hover:bg-[#fff0f0] hover:text-coral disabled:opacity-40"
                    aria-label={`Remove ${participant.name}`}
                    title="Remove participant"
                  >
                    <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              <span className={`h-2 w-2 rounded-full ${participant.isOnline ? "bg-mint" : "bg-line"}`} title={participant.isOnline ? "Online" : "Not in room yet"} />
            </div>
          );
        }) : <div className="px-4 py-12 text-center"><UsersIcon /><p className="mt-3 text-sm font-semibold text-ink">No one else is here yet</p><p className="mt-1 text-xs leading-5 text-muted">Share the meeting link when you’re ready.</p></div>}
      </div>
      <div className="border-t border-line px-5 py-4 text-xs leading-5 text-muted">
        {canManageParticipants
          ? "As host you can mute or remove participants. Muted and removed state is stored on the server."
          : "Participant presence and media state are synchronized with the room."}
      </div>
    </aside>
  );
}

function UsersIcon() {
  return <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-sky text-mint-dark"><span className="text-sm font-bold">+</span></span>;
}

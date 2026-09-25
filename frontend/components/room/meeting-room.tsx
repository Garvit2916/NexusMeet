"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CameraOff, Copy, Mic, MicOff, PhoneOff, ShieldCheck, Square, UsersRound, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ParticipantPanel } from "@/components/room/participant-panel";
import { LocalVideo } from "@/components/room/local-video";
import { VideoTile } from "@/components/room/video-tile";
import { PrejoinScreen } from "@/components/room/prejoin-screen";
import { useLocalMedia } from "@/hooks/use-local-media";
import { useMeeting } from "@/hooks/use-meeting";
import { useWebRTCMeeting } from "@/hooks/use-webrtc-meeting";
import { meetingService } from "@/services/meeting-service";
import { ApiError } from "@/services/api";
import { formatMeetingRange } from "@/lib/date";
import { SIGNALING_STATUS_TEXT, type RemoteParticipant } from "@/lib/signaling";
import { useAuth } from "@/providers/auth-provider";
import type { Meeting, Participant } from "@/lib/types";

function RoomControl({ label, active, danger = false, disabled = false, onClick, children }: { label: string; active: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`group flex min-w-[48px] flex-col items-center gap-1.5 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "text-[#ffb4b7] hover:text-white" : "text-white/60 hover:text-white"}`} aria-label={label} aria-pressed={active}><span className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${danger ? "bg-coral text-white hover:bg-[#c93a40]" : active ? "bg-white/15 text-white" : "bg-white/10 text-white/75 group-hover:bg-white/15"}`}>{children}</span><span className="hidden sm:block">{label}</span></button>;
}

export function MeetingRoom({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { meeting, status, error, refresh } = useMeeting(meetingId);
  const media = useLocalMedia();
  const [phase, setPhase] = useState<"prejoin" | "room">("prejoin");
  const [panelOpen, setPanelOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [roomMeeting, setRoomMeeting] = useState<Meeting | null>(null);
  const [pendingParticipantId, setPendingParticipantId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [endedByHost, setEndedByHost] = useState(false);
  const [removedByHost, setRemovedByHost] = useState(false);
  const joinedRef = useRef(false);
  const leaveSentRef = useRef(false);
  const wasInActiveListRef = useRef(false);
  // Keep the newest signaling state in a ref so the local toggle handlers and
  // the room's REST call can never disagree about what peers were told.
  const publishMediaStateRef = useRef<((state: { audioEnabled: boolean; videoEnabled: boolean; screenSharing?: boolean }) => void) | null>(null);
  const webrtcEnabled = phase === "room" && !endedByHost && !removedByHost && (roomMeeting?.status ?? meeting?.status) !== "ended";
  const webrtc = useWebRTCMeeting({
    meetingId,
    enabled: webrtcEnabled,
    localStream: media.stream,
    onHostMuteChange: (muted) => {
      // The server pushed a host mute over the socket, so mirror it into local
      // state instead of letting the next toggle silently re-enable the track.
      media.setMicEnabled(!muted);
    },
    onRemoved: () => {
      setRemovedByHost(true);
      media.stop();
    },
    onEnded: () => {
      setEndedByHost(true);
      media.stop();
    },
    onError: (message) => setRoomError(message),
  });
  publishMediaStateRef.current = webrtc.publishMediaState;
  const remoteStreams = useMemo(() => {
    const map = new Map<string, RemoteParticipant>();
    for (const remote of webrtc.remoteParticipants) map.set(remote.userId, remote);
    return map;
  }, [webrtc.remoteParticipants]);
  const leaveRoom = useCallback(async () => {
    if (joinedRef.current && !leaveSentRef.current) {
      leaveSentRef.current = true;
      try {
        await meetingService.leaveMeeting(meetingId);
      } catch {
        setRoomError("The room could not be updated, but your local media is stopping.");
      }
    }
    media.stop();
    router.replace(`/meeting/${meetingId}`);
  }, [meetingId, media, router]);

  useEffect(() => {
    if (meeting) setRoomMeeting(meeting);
  }, [meeting]);

  useEffect(() => {
    if (phase !== "room") return;
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "room") return;
    const interval = window.setInterval(() => void refresh({ silent: true }), 10000);
    return () => window.clearInterval(interval);
  }, [phase, refresh]);

  useEffect(() => {
    if (phase !== "room" || !roomMeeting) return;
    if (roomMeeting.status === "ended") {
      setEndedByHost(true);
      media.stop();
      return;
    }
    if (user) {
      const ownParticipant = roomMeeting.participants.find((participant) => participant.userId === user.id);
      if (ownParticipant?.isRemoved) {
        setRemovedByHost(true);
        return;
      }
      if (ownParticipant) {
        wasInActiveListRef.current = true;
      } else if (wasInActiveListRef.current) {
        // The server only drops a joined participant from the active list once the host removes them.
        setRemovedByHost(true);
      }
    }
  }, [phase, roomMeeting, media, user]);

  useEffect(() => () => {
    if (joinedRef.current && !leaveSentRef.current) {
      leaveSentRef.current = true;
      void meetingService.leaveMeeting(meetingId).catch(() => undefined);
    }
  }, [meetingId]);

  function handleRequestError(requestError: unknown, fallback: string) {
    if (requestError instanceof ApiError && requestError.status === 401) {
      void signOut();
      router.replace(`/login?next=${encodeURIComponent(`/meeting/${meetingId}/room`)}`);
      return;
    }
    if (requestError instanceof ApiError && requestError.code === "PARTICIPANT_REMOVED") {
      setRemovedByHost(true);
      return;
    }
    setRoomError(requestError instanceof Error ? requestError.message : fallback);
  }

  async function joinRoom(displayName: string) {
    setJoinError(null);
    setRoomError(null);
    setIsJoining(true);
    try {
      const joinedMeeting = await meetingService.joinMeeting(meetingId, displayName);
      joinedRef.current = true;
      leaveSentRef.current = false;
      setRemovedByHost(false);
      setEndedByHost(false);
      setRoomMeeting(joinedMeeting);
      setElapsed(0);
      setPhase("room");
      try {
        await meetingService.updateMediaState(meetingId, {
          audio_enabled: media.micEnabled,
          video_enabled: media.cameraEnabled,
        });
      } catch {
        setRoomError("You joined the room, but your media status could not be synced.");
      }
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setJoinError("Your session expired. Sign in again to join this meeting.");
        return;
      }
      setJoinError(requestError instanceof Error ? requestError.message : "We could not join this meeting. Please try again.");
    } finally {
      setIsJoining(false);
    }
  }

  function leaveBeforeJoin() {
    media.stop();
    router.replace(`/meeting/${meetingId}`);
  }

  async function startMedia() {
    const stream = await media.start();
    if (joinedRef.current && stream) {
      const audioEnabled = stream.getAudioTracks().some((track) => track.enabled);
      const videoEnabled = stream.getVideoTracks().some((track) => track.enabled);
      // Devices can be granted after the room is joined, so peers need to be
      // told the moment real tracks start flowing.
      publishMediaStateRef.current?.({ audioEnabled, videoEnabled });
      try {
        await meetingService.updateMediaState(meetingId, {
          audio_enabled: audioEnabled,
          video_enabled: videoEnabled,
        });
      } catch {
        setRoomError("Your media started, but its status could not be synced.");
      }
    }
  }

  async function toggleMicrophone() {
    if (removedByHost) return;
    if (webrtc.mutedByHost) {
      setRoomError("The host has muted you. Ask them to unmute you before turning your microphone on.");
      return;
    }
    const nextEnabled = !media.micEnabled;
    media.toggleMic();
    publishMediaStateRef.current?.({
      audioEnabled: nextEnabled,
      videoEnabled: media.cameraEnabled,
    });
    if (!joinedRef.current) return;
    try {
      await meetingService.updateMediaState(meetingId, { audio_enabled: nextEnabled });
    } catch (requestError) {
      media.toggleMic();
      publishMediaStateRef.current?.({
        audioEnabled: !nextEnabled,
        videoEnabled: media.cameraEnabled,
      });
      handleRequestError(requestError, "Your microphone could not be updated for everyone.");
    }
  }

  async function toggleCamera() {
    if (removedByHost) return;
    const nextEnabled = !media.cameraEnabled;
    media.toggleCamera();
    publishMediaStateRef.current?.({
      audioEnabled: media.micEnabled,
      videoEnabled: nextEnabled,
    });
    if (!joinedRef.current) return;
    try {
      await meetingService.updateMediaState(meetingId, { video_enabled: nextEnabled });
    } catch (requestError) {
      media.toggleCamera();
      publishMediaStateRef.current?.({
        audioEnabled: media.micEnabled,
        videoEnabled: !nextEnabled,
      });
      handleRequestError(requestError, "Your camera could not be updated for everyone.");
    }
  }

  async function toggleParticipantMute(participant: Participant) {
    setPendingParticipantId(participant.id);
    setRoomError(null);
    try {
      await meetingService.setParticipantMute(meetingId, participant.id, !participant.isMuted);
      await refresh({ silent: true });
    } catch (requestError) {
      handleRequestError(requestError, `We could not ${participant.isMuted ? "unmute" : "mute"} ${participant.name}.`);
    } finally {
      setPendingParticipantId(null);
    }
  }

  async function confirmRemoveParticipant() {
    if (!removeTarget) return;
    const target = removeTarget;
    setPendingParticipantId(target.id);
    try {
      await meetingService.removeParticipant(meetingId, target.id);
      setRemoveTarget(null);
      setPanelOpen(false);
      await refresh({ silent: true });
    } catch (requestError) {
      handleRequestError(requestError, `We could not remove ${target.name} from this meeting.`);
    } finally {
      setPendingParticipantId(null);
      setRemoveTarget(null);
    }
  }

  async function confirmEndMeeting() {
    setIsEnding(true);
    try {
      const endedMeeting = await meetingService.endMeeting(meetingId);
      setRoomMeeting(endedMeeting);
      setEndDialogOpen(false);
      setEndedByHost(true);
      media.stop();
    } catch (requestError) {
      handleRequestError(requestError, "We could not end this meeting for everyone.");
    } finally {
      setIsEnding(false);
    }
  }

  async function copyLink() {
    const currentMeeting = roomMeeting ?? meeting;
    if (!currentMeeting) return;
    const link = currentMeeting.joinUrl.startsWith("http") ? currentMeeting.joinUrl : `${window.location.origin}${currentMeeting.joinUrl}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = link;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  if (status === "loading") return <div className="min-h-screen bg-[#202124] text-white"><div className="flex min-h-screen items-center justify-center"><LoadingState label="Preparing your room" /></div></div>;
  if (status === "error" || !meeting) return <div className="flex min-h-screen items-center justify-center bg-[#202124] px-5 text-white"><div className="max-w-md text-center"><h1 className="text-2xl font-bold">Room unavailable</h1><p className="mt-3 text-sm leading-6 text-white/60">{error ?? "This meeting could not be loaded."}</p><Button className="mt-6" onClick={() => void refresh()}>Try again</Button></div></div>;
  if (!user) return null;

  const currentMeeting = roomMeeting ?? meeting;
  const isHost = currentMeeting.host.id === user.id;
  const scheduledTimeReached = currentMeeting.status === "upcoming" && new Date(currentMeeting.startTime).getTime() <= Date.now();
  const canJoin = currentMeeting.status === "live" || (currentMeeting.status === "upcoming" && (isHost || scheduledTimeReached));
  if (phase === "prejoin") return <PrejoinScreen meeting={currentMeeting} media={media} defaultDisplayName={user.name} initials={user.initials} onJoin={joinRoom} onLeave={leaveBeforeJoin} joinError={joinError} isJoining={isJoining} canJoin={canJoin} />;

  const activeParticipants = currentMeeting.participants.filter((participant) => !participant.isRemoved);
  const onlineParticipants = activeParticipants.filter((participant) => participant.isOnline || participant.userId === user.id);
  const remoteParticipants = onlineParticipants.filter((participant) => participant.userId !== user.id);
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const seconds = (elapsed % 60).toString().padStart(2, "0");
  const roomIsClosed = endedByHost || currentMeeting.status === "ended";

  return (
    <div className="min-h-screen bg-[#202124] text-white">
      <header className="flex h-16 items-center justify-between border-b border-white/10 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => void leaveRoom()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-white/65 transition hover:bg-white/15 hover:text-white" aria-label="Leave meeting"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></button>
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-mint text-white"><Video className="h-3.5 w-3.5" aria-hidden="true" /></span><span className="truncate text-sm font-bold">{currentMeeting.title}</span></div><p className="mt-0.5 hidden text-[11px] text-white/40 sm:block">{formatMeetingRange(currentMeeting.startTime, currentMeeting.endTime)} · {currentMeeting.timezone}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white/65 sm:inline-flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-coral" />{minutes}:{seconds}</span>
          <button type="button" onClick={() => void copyLink()} className="flex h-9 items-center gap-2 rounded-lg bg-white/[0.08] px-3 text-xs font-semibold text-white/70 transition hover:bg-white/15 hover:text-white" aria-label="Copy meeting link">{copied ? "Copied" : <><Copy className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden sm:inline">Copy link</span></>}</button>
        </div>
      </header>
      <main className="relative flex min-h-[calc(100vh-64px)] flex-col p-3 sm:p-5">
        {roomIsClosed || removedByHost ? (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm text-white/80 sm:flex-row sm:items-center sm:justify-between" role="status">
            <span>
              {removedByHost
                ? "You were removed from this meeting by the host."
                : "This meeting has ended. Local media has been stopped."}
            </span>
            <button
              type="button"
              onClick={() => {
                media.stop();
                router.replace(`/meeting/${meetingId}`);
              }}
              className="self-start font-semibold text-mint underline sm:self-auto"
            >
              Back to meeting details
            </button>
          </div>
        ) : null}
        {webrtc.mutedByHost && !roomIsClosed && !removedByHost ? <div className="mb-4 rounded-xl border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-white/80" role="status">The host has muted your microphone. Ask them to unmute you to speak.</div> : null}
        {roomError && !roomIsClosed && !removedByHost ? <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#f5b544]/30 bg-[#f5b544]/10 px-4 py-3 text-sm text-[#ffe5a0]" role="alert"><span>{roomError}</span><button type="button" className="font-semibold underline" onClick={() => setRoomError(null)}>Dismiss</button></div> : null}
        <div className="relative flex min-h-[480px] flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[#2d3136] p-2 shadow-2xl sm:p-3">
          <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_250px]">
            <div className="relative min-h-[360px] overflow-hidden rounded-xl bg-[#181a1d] sm:min-h-[520px]">
              <LocalVideo stream={media.stream} className="h-full w-full object-cover" ariaLabel="Your video" />
              {!media.stream || !media.cameraEnabled ? <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#181a1d]"><span className="flex h-24 w-24 items-center justify-center rounded-full bg-mint text-3xl font-bold text-white">{user.initials}</span><p className="mt-4 text-sm font-bold text-white/80">{!media.stream ? "Camera unavailable" : "Your camera is off"}</p><p className="mt-1 text-xs text-white/40">{!media.stream ? "You can still stay in the room with audio." : "Turn it back on whenever you’re ready."}</p></div> : null}
              <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 text-xs font-semibold backdrop-blur"><span className="h-1.5 w-1.5 rounded-full bg-mint" />{user.name} <span className="font-normal text-white/50">(you)</span></div>
              <div className="absolute right-4 top-4 flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-[11px] font-semibold text-white/70 backdrop-blur"><ShieldCheck className="h-3.5 w-3.5 text-mint" aria-hidden="true" />Your camera</div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {remoteParticipants.slice(0, 3).map((participant, index) => {
                const remote = remoteStreams.get(participant.userId);
                return (
                  <VideoTile
                    key={participant.id}
                    stream={remote?.stream ?? null}
                    name={participant.name}
                    initials={participant.initials}
                    audioEnabled={remote?.audioEnabled ?? participant.audioEnabled}
                    videoEnabled={remote?.videoEnabled ?? participant.videoEnabled}
                    isHost={participant.role === "host"}
                    labelSuffix={remote ? undefined : "Connecting…"}
                    tone={index % 2 ? "lilac" : "coral"}
                    className="min-h-[140px] w-full"
                  />
                );
              })}
              <div className="col-span-2 flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-center lg:col-span-1"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.08] text-white/45"><UsersRound className="h-5 w-5" aria-hidden="true" /></span><p className="mt-3 text-xs font-semibold text-white/65">{remoteParticipants.length ? "More participants" : "Waiting for others"}</p><p className="mt-1 text-[10px] leading-4 text-white/35">{remoteParticipants.length ? "Open the participants panel to see everyone in this room." : "Share the meeting link. Media connects directly between browsers."}</p></div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-1.5 sm:gap-3">
            {!media.stream && !roomIsClosed && !removedByHost ? <RoomControl label={media.isStarting ? "Connecting" : "Enable media"} active={false} disabled={media.isStarting} onClick={() => void startMedia()}><Camera className="h-5 w-5" aria-hidden="true" /></RoomControl> : null}
            <RoomControl label={media.micEnabled ? "Mute" : "Unmute"} active={media.micEnabled} disabled={!media.stream || roomIsClosed || removedByHost} onClick={() => void toggleMicrophone()}><span className={!media.micEnabled ? "rounded-full bg-coral/20 p-1" : ""}>{media.micEnabled ? <Mic className="h-5 w-5" aria-hidden="true" /> : <MicOff className="h-5 w-5" aria-hidden="true" />}</span></RoomControl>
            <RoomControl label={media.cameraEnabled ? "Camera" : "Camera off"} active={media.cameraEnabled} disabled={!media.stream || roomIsClosed || removedByHost} onClick={() => void toggleCamera()}><span className={!media.cameraEnabled ? "rounded-full bg-coral/20 p-1" : ""}>{media.cameraEnabled ? <Camera className="h-5 w-5" aria-hidden="true" /> : <CameraOff className="h-5 w-5" aria-hidden="true" />}</span></RoomControl>
            <RoomControl label="People" active={panelOpen} onClick={() => setPanelOpen((current) => !current)}><UsersRound className="h-5 w-5" aria-hidden="true" /></RoomControl>
            {isHost && !roomIsClosed ? <RoomControl label="End for all" active={false} danger disabled={isEnding} onClick={() => setEndDialogOpen(true)}><Square className="h-4 w-4" aria-hidden="true" /></RoomControl> : null}
          </div>
          <RoomControl label="Leave" active={false} danger onClick={() => void leaveRoom()}><PhoneOff className="h-5 w-5" aria-hidden="true" /></RoomControl>
          <div className="hidden items-center gap-2 text-xs text-white/40 sm:flex" data-testid="webrtc-status"><span className={`h-1.5 w-1.5 rounded-full ${webrtc.status === "connected" ? "bg-mint" : webrtc.status === "failed" ? "bg-coral" : "bg-[#f5b544]"}`} />{SIGNALING_STATUS_TEXT[webrtc.status]} · {webrtc.peerCount} peer{webrtc.peerCount === 1 ? "" : "s"}</div>
        </div>
        <ParticipantPanel
          participants={onlineParticipants}
          remoteStreams={remoteStreams}
          localStream={media.stream}
          localUserId={user.id}
          localAudioEnabled={media.micEnabled}
          localVideoEnabled={media.cameraEnabled}
          open={panelOpen}
          canManageParticipants={isHost && !roomIsClosed}
          pendingParticipantId={pendingParticipantId}
          onClose={() => setPanelOpen(false)}
          onToggleMute={(participant) => void toggleParticipantMute(participant)}
          onRemoveParticipant={(participant) => setRemoveTarget(participant)}
        />
      </main>
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.name ?? "participant"}?`}
        description="They will be removed from the participant list and can no longer rejoin this meeting. This cannot be undone."
        confirmLabel="Remove participant"
        destructive
        isConfirming={pendingParticipantId === removeTarget?.id}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void confirmRemoveParticipant()}
      />
      <ConfirmDialog
        open={endDialogOpen}
        title="End meeting for everyone?"
        description="The meeting closes for every participant and the room becomes read-only. You can still review the details afterwards."
        confirmLabel="End meeting"
        destructive
        isConfirming={isEnding}
        onCancel={() => setEndDialogOpen(false)}
        onConfirm={() => void confirmEndMeeting()}
      />
    </div>
  );
}

export type RoomConnectionState = "disconnected" | "connecting" | "connected" | "failed";

export type RoomConnection = {
  connect: (meetingId: string) => Promise<RoomConnectionState>;
  disconnect: () => Promise<void>;
  getState: () => RoomConnectionState;
};

export type RemoteVideoTrack = {
  participantId: string;
  track: MediaStreamTrack;
};

export type RoomAdapter = {
  connection: RoomConnection;
  subscribeToTracks: (listener: (track: RemoteVideoTrack) => void) => () => void;
};

import { MeetingRoom } from "@/components/room/meeting-room";

export default async function MeetingRoomPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  return <MeetingRoom meetingId={meetingId} />;
}

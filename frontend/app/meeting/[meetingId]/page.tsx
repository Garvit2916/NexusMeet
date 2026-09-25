import { MeetingDetailsView } from "@/components/meetings/meeting-details-view";

export default async function MeetingPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  return <MeetingDetailsView meetingId={meetingId} />;
}

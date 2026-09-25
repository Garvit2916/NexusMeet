import { LoadingState } from "@/components/ui/loading";

export default function WorkspaceLoading() {
  return <div className="flex min-h-[60vh] items-center justify-center"><LoadingState label="Loading your workspace" /></div>;
}

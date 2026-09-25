import { Suspense } from "react";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { LoadingState } from "@/components/ui/loading";

export default function DashboardPage() {
  return <Suspense fallback={<LoadingState label="Loading your workspace" />}><DashboardView /></Suspense>;
}

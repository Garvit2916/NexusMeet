import { Suspense } from "react";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { LoadingState } from "@/components/ui/loading";

export const metadata = {
  title: "Create account",
  description: "Create a NexusMeet account to host or join meetings.",
};

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-canvas">
          <LoadingState label="Loading registration" />
        </div>
      }
    >
      <SignUpForm />
    </Suspense>
  );
}

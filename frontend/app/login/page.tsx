import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { LoadingState } from "@/components/ui/loading";

export const metadata = {
  title: "Sign in",
  description: "Sign in to host or join a NexusMeet meeting.",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-canvas">
          <LoadingState label="Loading sign in" />
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}

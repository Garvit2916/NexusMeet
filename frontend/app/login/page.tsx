import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { LoadingState } from "@/components/ui/loading";

export const metadata = { title: "Sign in" };

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

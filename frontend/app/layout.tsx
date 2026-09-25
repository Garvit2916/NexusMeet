import type { Metadata } from "next";
import "./globals.css";
import { CurrentUserProvider } from "@/providers/current-user-provider";

export const metadata: Metadata = {
  title: {
    default: "NexusMeet — meetings made simple",
    template: "%s | NexusMeet",
  },
  description: "A focused meeting workspace for teams that want to move ideas forward.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <CurrentUserProvider>{children}</CurrentUserProvider>
      </body>
    </html>
  );
}

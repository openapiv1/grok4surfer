import "@/styles/globals.css";

import { Metadata } from "next";
import { Toaster } from "sonner";
import { Providers } from "../components/providers";
import { ChatProvider } from "@/lib/chat-context";
import { Analytics } from "@vercel/analytics/react";

export const metadata: Metadata = {
  title: "Surf - E2B Computer Use Agent (Powered by Grok-4-fast-non-reasoning)",
  description:
    "AI agent that interacts with a virtual desktop environment through natural language instructions using Grok-4-fast-non-reasoning AI",
  keywords: [
    "AI",
    "desktop",
    "automation",
    "E2B",
    "Grok",
    "Grok-4",
    "xAI",
    "virtual desktop",
    "sandbox",
    "fast-non-reasoning",
  ],
  authors: [{ name: "E2B", url: "https://e2b.dev" }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="font-sans"
        suppressHydrationWarning
      >
        <Providers>
          <ChatProvider>
            <Toaster position="top-center" richColors />
            {children}
            <Analytics />
          </ChatProvider>
        </Providers>
      </body>
    </html>
  );
}

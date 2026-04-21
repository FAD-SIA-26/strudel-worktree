import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";
import "../styles/design-tokens.css";

export const metadata: Metadata = {
  title: "WorkTree Orchestrator",
  description: "AI-powered code generation through parallel worker orchestration"
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToastProvider } from "../components/ui/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

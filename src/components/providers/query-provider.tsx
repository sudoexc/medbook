"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Shared QueryClient for CRM. Defaults: 30s stale-time, 5min gc-time.
 * Designed for Phase 2+ TanStack Query usage (patients/appointments/etc).
 *
 * `refetchOnWindowFocus` is off by default: CRM workstations keep many
 * dashboards mounted and alt-tabbing all day would hammer the API for data
 * the SSE stream already pushes. The Telegram Mini App is the opposite case
 * — it is constantly backgrounded by the Telegram client, its socket dies
 * while frozen, and a patient returning to the app must not be shown data
 * from hours ago. It opts in via `refetchOnFocus`.
 */
export function QueryProvider({
  children,
  refetchOnFocus = false,
}: {
  children: React.ReactNode;
  refetchOnFocus?: boolean;
}) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: refetchOnFocus,
            refetchOnReconnect: refetchOnFocus,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

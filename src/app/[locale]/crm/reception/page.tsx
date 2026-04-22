import { ReceptionPageClient } from "./_components/reception-page-client";

/**
 * `/crm/reception` — Phase 2c live dashboard. TZ §6.1.
 *
 * Thin server shell. Initial data is hydrated by the client via TanStack
 * Query so the reception screen can poll (30 s fallback) until the
 * realtime-engineer wires up the SSE channel in Phase 3a.
 */
export default function ReceptionPage() {
  return <ReceptionPageClient />;
}

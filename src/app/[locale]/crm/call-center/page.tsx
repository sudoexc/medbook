import { CallCenterPageClient } from "./_components/call-center-page-client";

/**
 * /crm/call-center — Phase 3c.
 *
 * Thin server shell. The client owns the 3-column layout, polling
 * (until realtime-engineer replaces it with SSE), and filter state sync.
 * Desktop-only (≥1280px); below that we show the standard "use desktop" hint.
 *
 * See `docs/TZ.md` §6.7 and progress/LOG.md for the full contract.
 */
export default function CallCenterPage() {
  return <CallCenterPageClient />;
}

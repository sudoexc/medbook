import { TelegramPageClient } from "./_components/telegram-page-client";

/**
 * /crm/telegram — Phase 3b.
 *
 * Thin server shell; the client owns 3-column layout, filter state (URL-sync),
 * and TanStack Query. Desktop-only at ≥1280px — mobile shows a polite nudge.
 * See `docs/TZ.md` §6.8 and progress/LOG.md Phase 3b for the full contract.
 */
export default function TelegramInboxPage() {
  return <TelegramPageClient />;
}

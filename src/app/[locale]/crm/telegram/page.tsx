import { notFound } from "next/navigation";

import { getFeatureFlagsForCurrentSession } from "@/server/platform/current-flags";

import { TelegramPageClient } from "./_components/telegram-page-client";

/**
 * /crm/telegram — Phase 3b.
 *
 * Thin server shell; the client owns 3-column layout, filter state (URL-sync),
 * and TanStack Query. Desktop-only at ≥1280px — mobile shows a polite nudge.
 *
 * Phase 9d — gated behind `flags.hasTelegramInbox`. Basic-plan clinics get
 * a 404 (not 403) to avoid disclosing the pro-feature surface.
 *
 * See `docs/TZ.md` §6.8 and progress/LOG.md Phase 3b for the full contract.
 */
export default async function TelegramInboxPage() {
  const flags = await getFeatureFlagsForCurrentSession();
  if (!flags.hasTelegramInbox) notFound();
  return <TelegramPageClient />;
}

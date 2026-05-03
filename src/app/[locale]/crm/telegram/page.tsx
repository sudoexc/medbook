import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
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
 * Self-service onboarding — when the clinic has no `tgBotToken` yet, the
 * client renders an empty-state CTA pointing at /crm/settings/integrations
 * so an admin can run the connect wizard. We resolve the flag here on the
 * server (cheap one-row read) so the empty state shows on first paint
 * without a TanStack query round-trip.
 */
export default async function TelegramInboxPage() {
  const flags = await getFeatureFlagsForCurrentSession();
  if (!flags.hasTelegramInbox) notFound();

  const session = await auth();
  const clinicId = session?.user?.clinicId ?? null;
  let botConfigured = false;
  if (clinicId) {
    const clinic = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { tgBotToken: true },
      }),
    );
    botConfigured = Boolean(clinic?.tgBotToken);
  }

  return <TelegramPageClient botConfigured={botConfigured} />;
}

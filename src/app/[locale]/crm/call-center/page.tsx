import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LockIcon } from "lucide-react";

import { auth } from "@/lib/auth";
import { canUseCallCenter } from "@/lib/calls/roles";
import { EmptyState } from "@/components/atoms/empty-state";
import { getFeatureFlagsForCurrentSession } from "@/server/platform/current-flags";

import { CallCenterPageClient } from "./_components/call-center-page-client";

/**
 * /crm/call-center — Phase 3c.
 *
 * Thin server shell. The client owns the 3-column layout, polling
 * (until realtime-engineer replaces it with SSE), and filter state sync.
 * Desktop-only (≥1280px); below that we show the standard "use desktop" hint.
 *
 * Phase 9d — gated behind `flags.hasCallCenter`. Basic-plan clinics get a
 * 404 (not 403) so we don't disclose the feature's existence; the sidebar
 * already hides the menu link for the same reason.
 *
 * Audit CM-08: a role the calls API refuses (a nurse) is told so here. It
 * used to get the layout with «Сейчас тихо», every list silently empty.
 *
 * See `docs/TZ.md` §6.7 and progress/LOG.md for the full contract.
 */
export default async function CallCenterPage() {
  const flags = await getFeatureFlagsForCurrentSession();
  if (!flags.hasCallCenter) notFound();
  const session = await auth();
  if (!canUseCallCenter(session?.user?.role)) {
    const t = await getTranslations("callCenter.noAccess");
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <EmptyState
          icon={<LockIcon />}
          title={t("title")}
          description={t("description")}
        />
      </div>
    );
  }
  return <CallCenterPageClient />;
}

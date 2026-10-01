import * as React from "react";
import { getTranslations } from "next-intl/server";
import { LockIcon } from "lucide-react";

import { auth } from "@/lib/auth";
import { canWorkActionCenter } from "@/lib/actions/roles";
import { EmptyState } from "@/components/atoms/empty-state";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getFeatureFlagsForCurrentSession } from "@/server/platform/current-flags";

import { ActionCenterClient } from "./_components/action-center-client";

/**
 * `/crm/action-center` — Phase 13 Wave 3 surface. TZ §13.4.
 *
 * Thin server shell that resolves the caller's role once and forwards it to
 * the client. Role gating in the UI (recompute, reopen, assignee filter) is
 * cosmetic — the underlying mutation routes enforce the same gate server-side
 * via `createApiHandler`. Doing the resolve here lets the client render the
 * right buttons without a second round trip.
 *
 * It also resolves which screens the page's links may open (audit AC-14,
 * UX-09): the Call Center and the Telegram inbox are plan features that 404
 * without the flag, and a broadcast needs an admin and a connected bot, the
 * same checks `/crm/telegram` makes.
 */
export default async function ActionCenterPage() {
  const session = await auth();
  const role = session?.user?.role ?? null;
  // Audit AC-16: a role the Action Center API refuses (a nurse) is told so,
  // instead of «Нет приоритетных действий» over a swallowed 403.
  if (!canWorkActionCenter(role)) {
    const t = await getTranslations("actionCenter.noAccess");
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
  const flags = await getFeatureFlagsForCurrentSession();
  const clinicId = session?.user?.clinicId ?? null;
  const isAdmin = role === "ADMIN";
  let botConfigured = false;
  if (flags.hasTelegramInbox && isAdmin && clinicId) {
    const clinic = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { tgBotToken: true },
      }),
    );
    botConfigured = Boolean(clinic?.tgBotToken);
  }
  return (
    <ActionCenterClient
      role={role}
      hasCallCenter={flags.hasCallCenter}
      hasTelegramInbox={flags.hasTelegramInbox}
      canBroadcast={flags.hasTelegramInbox && isAdmin && botConfigured}
    />
  );
}

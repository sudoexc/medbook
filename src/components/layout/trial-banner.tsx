/**
 * Phase 9e — Trial countdown / past-due banner.
 *
 * Server component. Pure render: receives a `subscription` prop already
 * resolved by `getCurrentSubscription()` in the CRM layout. No client-side
 * hooks, no fetch — the banner re-renders on the next layout pass after the
 * scheduler flips TRIAL → PAST_DUE (i.e. the next navigation).
 *
 * Visibility states (see also `computeBannerState`):
 *
 *   - TRIAL with daysLeft >  7  → hidden  (no banner)
 *   - TRIAL with daysLeft 7..3  → "info"  (yellow / neutral warning tone)
 *   - TRIAL with daysLeft 2..0  → "warning" (red — trial is about to end)
 *   - PAST_DUE                  → "expired" (red — grace period messaging)
 *   - ACTIVE / CANCELLED        → hidden
 *   - null subscription         → hidden
 *
 * SUPER_ADMIN sees a deep-link to `/admin/clinics/[id]/billing` so they can
 * extend the trial without leaving the CRM. Regular ADMIN/RECEPTIONIST/etc.
 * have no admin access — the banner shows the message but no action link.
 *
 * i18n contract: `crmShell.trialBanner.*` keys. Both ru.json and uz.json
 * carry the same shape — ICU plural for `daysLeft.body` so RU's "осталось 1
 * день" / "осталось 3 дня" / "осталось 12 дней" all work without
 * splitting strings in code.
 */
import * as React from "react";
import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { AlertTriangleIcon, ClockIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  computeBannerState,
  type CurrentSubscription,
} from "@/components/layout/trial-banner-state";

export type TrialBannerProps = {
  subscription: CurrentSubscription | null;
};

export async function TrialBanner({
  subscription,
}: TrialBannerProps): Promise<React.ReactElement | null> {
  const state = computeBannerState(subscription, new Date());
  if (state.kind === "hidden") return null;

  const t = await getTranslations("crmShell.trialBanner");
  const locale = await getLocale();
  const session = await auth();
  const role = session?.user?.role ?? null;
  const sessionClinicId = session?.user?.clinicId ?? null;
  const isSuperAdmin = role === "SUPER_ADMIN";

  const billingHref =
    isSuperAdmin && sessionClinicId
      ? `/admin/clinics/${sessionClinicId}/billing`
      : null;

  const dateFmt = new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn-UZ" : "ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  let body: React.ReactNode;
  let toneClass: string;
  let Icon: React.ComponentType<{ className?: string }>;

  if (state.kind === "expired") {
    Icon = AlertTriangleIcon;
    toneClass =
      "bg-destructive/10 text-destructive border-destructive/30 dark:bg-destructive/20";
    const graceUntil = state.gracePeriodEndsAt
      ? dateFmt.format(state.gracePeriodEndsAt)
      : null;
    body = (
      <span>
        <strong className="font-semibold">{t("expired.title")}</strong>
        {" — "}
        {graceUntil
          ? t("expired.bodyWithDate", { date: graceUntil })
          : t("expired.body")}
      </span>
    );
  } else if (state.kind === "warning") {
    Icon = AlertTriangleIcon;
    toneClass =
      "bg-destructive/10 text-destructive border-destructive/30 dark:bg-destructive/20";
    body = (
      <span>
        <strong className="font-semibold">{t("daysLeft.title")}</strong>
        {" — "}
        {t("daysLeft.body", { count: state.daysLeft })}
      </span>
    );
  } else {
    // info
    Icon = ClockIcon;
    toneClass =
      "bg-warning/15 text-warning-foreground border-warning/40 dark:bg-warning/20";
    body = (
      <span>
        <strong className="font-semibold">{t("daysLeft.title")}</strong>
        {" — "}
        {t("daysLeft.body", { count: state.daysLeft })}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full items-center gap-3 border-b px-6 py-2 text-sm",
        toneClass,
      )}
    >
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 truncate">{body}</div>
      {billingHref ? (
        <Link
          href={billingHref}
          className="shrink-0 rounded-md border border-current/30 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-current/10"
        >
          {t("cta.openBilling")}
        </Link>
      ) : null}
    </div>
  );
}

"use client";

/**
 * <PatientReferralCard /> — Phase 16 Wave 3.
 *
 * Read-only summary of the patient's refer-a-friend state on the CRM
 * patient overview tab:
 *   - the persistent code + useCount
 *   - pending / applied / expired reward counts
 *   - "referred by …" callout if the patient came in through somebody
 *     else's code
 *
 * No mutations — the receptionist just sees the same numbers the patient
 * sees in the Mini App refer screen.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { GiftIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type ReferralRow = {
  id: string;
  status: "PENDING" | "APPLIED" | "EXPIRED";
  rewardPercent: number;
  createdAt: string;
  appliedAt: string | null;
  expiresAt: string;
  friend: { id: string; fullName: string } | null;
};

type ReferralResponse = {
  code: string | null;
  useCount: number;
  createdAt: string | null;
  pendingCount: number;
  appliedCount: number;
  expiredCount: number;
  rewards: ReferralRow[];
  referredBy: { id: string; fullName: string } | null;
};

export function PatientReferralCard({
  patientId,
  className,
}: {
  patientId: string;
  className?: string;
}) {
  const t = useTranslations("patientCard.referral");
  const { data, isLoading, isError } = useQuery<ReferralResponse>({
    queryKey: ["patient", patientId, "referral"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/patients/${patientId}/referral`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ReferralResponse;
    },
    staleTime: 30_000,
  });

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-sm",
        className,
      )}
    >
      <header className="mb-3 flex items-center gap-2">
        <GiftIcon className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t("title")}</h3>
      </header>

      {isLoading && (
        <p className="text-xs text-muted-foreground">{t("loading")}</p>
      )}
      {isError && (
        <p className="text-xs text-destructive">{t("error")}</p>
      )}

      {data && (
        <div className="space-y-3">
          {data.code ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
              <span className="font-mono text-base font-bold tracking-widest">
                {data.code}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("useCount", { n: data.useCount })}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("noCode")}</p>
          )}

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Stat label={t("pendingLabel")} value={data.pendingCount} />
            <Stat label={t("appliedLabel")} value={data.appliedCount} />
            <Stat label={t("expiredLabel")} value={data.expiredCount} />
          </div>

          {data.referredBy && (
            <p className="text-xs text-muted-foreground">
              {t("referredBy", { name: data.referredBy.fullName })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

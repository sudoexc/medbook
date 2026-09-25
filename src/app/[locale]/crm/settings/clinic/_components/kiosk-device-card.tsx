"use client";

/**
 * «Киоск» — pair the lobby tablet (audit SEC-01).
 *
 * The kiosk APIs answer only to a tablet holding the clinic's device token.
 * Here the ADMIN issues it: the kiosk link is shown ONCE, to be opened on
 * the tablet; issuing a new link switches the old tablet off, and «Отключить»
 * switches every tablet off.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, MonitorSmartphoneIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatClinicDateTime } from "@/lib/format";
import type { Locale } from "@/types";

import { settingsFetch } from "../../_hooks/use-settings-api";

type KioskState = { paired: boolean; issuedAt: string | null; url?: string };

const KEY = ["settings", "kiosk-token"] as const;

export function KioskDeviceCard() {
  const t = useTranslations("settings.kiosk");
  const locale = useLocale() as Locale;
  const qc = useQueryClient();
  const [freshUrl, setFreshUrl] = React.useState<string | null>(null);
  const [confirmOff, setConfirmOff] = React.useState(false);

  const state = useQuery({
    queryKey: KEY,
    queryFn: () => settingsFetch<KioskState>("/api/crm/clinic/kiosk-token"),
  });
  const issue = useMutation({
    mutationFn: () =>
      settingsFetch<KioskState>("/api/crm/clinic/kiosk-token", { method: "POST" }),
    onSuccess: (res) => {
      setFreshUrl(res.url ?? null);
      qc.setQueryData(KEY, { paired: true, issuedAt: res.issuedAt });
    },
    onError: () => toast.error(t("error")),
  });
  const revoke = useMutation({
    mutationFn: () =>
      settingsFetch<KioskState>("/api/crm/clinic/kiosk-token", { method: "DELETE" }),
    onSuccess: () => {
      setFreshUrl(null);
      setConfirmOff(false);
      qc.setQueryData(KEY, { paired: false, issuedAt: null });
      toast.success(t("revoked"));
    },
    onError: () => toast.error(t("error")),
  });

  const paired = state.data?.paired ?? false;
  const issuedAt = state.data?.issuedAt ?? null;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
      <div className="flex items-center gap-2">
        <MonitorSmartphoneIcon className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t("title")}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>

      <p className="text-sm">
        {paired && issuedAt
          ? t("pairedSince", { date: formatClinicDateTime(issuedAt, locale) })
          : t("notPaired")}
      </p>

      {freshUrl && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-medium">{t("linkOnce")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">
              {freshUrl}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(freshUrl)
                  .then(() => toast.success(t("copied")))
                  .catch(() => undefined);
              }}
            >
              <CopyIcon className="size-3.5" />
              {t("copy")}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => issue.mutate()}
          disabled={issue.isPending}
        >
          {paired ? t("reissue") : t("issue")}
        </Button>
        {paired &&
          (confirmOff ? (
            <>
              <span className="text-sm text-muted-foreground">{t("confirmOff")}</span>
              <Button
                type="button"
                variant="destructive"
                onClick={() => revoke.mutate()}
                disabled={revoke.isPending}
              >
                {t("revokeYes")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmOff(false)}>
                {t("cancel")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => setConfirmOff(true)}>
              {t("revoke")}
            </Button>
          ))}
      </div>
      {paired && <p className="text-xs text-muted-foreground">{t("reissueHint")}</p>}
    </section>
  );
}

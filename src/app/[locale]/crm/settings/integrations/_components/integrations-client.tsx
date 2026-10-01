"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { intlLocale } from "@/lib/format";
import {
  CheckCircle2Icon,
  CopyIcon,
  CreditCardIcon,
  PhoneIcon,
  PlugZapIcon,
  RefreshCwIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { settingsFetch } from "../../_hooks/use-settings-api";
import { TgConnectWizard } from "./tg-connect-wizard";

type ProviderKind =
  | "TELEGRAM"
  | "PAYME"
  | "CLICK"
  | "UZUM"
  | "OPENAI"
  | "OTHER";

type ProviderConn = {
  id: string;
  kind: ProviderKind;
  label: string | null;
  hasSecret: boolean;
  secretMasked: string | null;
  config: Record<string, unknown> | null;
  active: boolean;
};

type TgStatus =
  | {
      notConfigured: true;
      botUsername: string | null;
    }
  | {
      notConfigured: false;
      botUsername: string | null;
      webhook?: {
        url: string | null;
        pending_update_count: number;
        last_error_date: number | null;
        last_error_message: string | null;
      };
      hasSecret?: boolean;
      error?: string;
    };

export function IntegrationsClient() {
  const t = useTranslations("settings");
  const qc = useQueryClient();

  const connsQuery = useQuery({
    queryKey: ["settings", "integrations"],
    queryFn: () =>
      settingsFetch<{ rows: ProviderConn[]; sipWebhookUrl: string | null }>(
        "/api/crm/integrations",
      ),
  });

  const [telephonyOpen, setTelephonyOpen] = React.useState(false);
  const [tgWizardOpen, setTgWizardOpen] = React.useState(false);

  const tgStatusQuery = useQuery({
    queryKey: ["settings", "tg-webhook-status"],
    queryFn: () =>
      settingsFetch<TgStatus>("/api/crm/integrations/tg/webhook-status"),
  });
  const tgConfigured = tgStatusQuery.data
    ? !tgStatusQuery.data.notConfigured
    : false;

  // UX-08 — the telephony card is green only once calls really arrived
  // (src/server/telephony/status.ts); saved credentials alone connect
  // nothing, no PBX adapter exists yet.
  const telephonyQuery = useQuery({
    queryKey: ["telephony", "status"],
    queryFn: () =>
      settingsFetch<{ connected: boolean; configured: boolean }>(
        "/api/crm/telephony/status",
      ),
  });
  const telephonyConnected = telephonyQuery.data?.connected === true;

  // The row the SIP webhook authenticates against (kind OTHER, label "sip").
  const sipConn =
    (connsQuery.data?.rows ?? []).find(
      (r) => r.kind === "OTHER" && r.label === "sip",
    ) ?? null;

  return (
    <PageContainer>
      <SectionHeader
        title={t("integrations.title")}
        subtitle={t("integrations.subtitle")}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <IntegrationCard
          kind="TELEGRAM"
          icon={<SendIcon className="size-5" />}
          title={t("integrations.cards.tg.title")}
          description={t("integrations.cards.tg.description")}
          conn={null}
          configured={tgConfigured}
          // The bot is the wizard's job, connected or not: a token typed
          // anywhere else changed nothing (audit ST-05).
          onSetup={() => setTgWizardOpen(true)}
          ctaKey={tgConfigured ? "tgReconnect" : "tgConnect"}
          extra={
            tgConfigured ? (
              <>
                <TgWebhookPanel />
                <TgDisconnectButton
                  onDisconnected={() => {
                    qc.invalidateQueries({
                      queryKey: ["settings", "tg-webhook-status"],
                    });
                    qc.invalidateQueries({
                      queryKey: ["settings", "integrations"],
                    });
                  }}
                />
              </>
            ) : null
          }
        />

        {/* No online payment integration exists: nothing reads Payme, Click
            or Uzum keys, so there is nothing to set up (audit ST-05). */}
        <IntegrationCard
          kind="PAYME"
          icon={<CreditCardIcon className="size-5" />}
          title={t("integrations.cards.payment.title")}
          description={t("integrations.cards.payment.description")}
          conn={null}
          stateOverride="unavailable"
          hint={t("integrations.paymentUnavailableHint")}
        />

        <IntegrationCard
          kind="OTHER"
          icon={<PhoneIcon className="size-5" />}
          title={t("integrations.cards.telephony.title")}
          description={t("integrations.cards.telephony.description")}
          conn={sipConn}
          stateOverride={telephonyConnected ? "ok" : "notConnected"}
          hint={
            telephonyConnected
              ? undefined
              : t("integrations.telephonyNotConnectedHint")
          }
          onSetup={() => setTelephonyOpen(true)}
        />
      </div>

      {telephonyOpen ? (
        <TelephonyWebhookDialog
          conn={sipConn}
          webhookUrl={connsQuery.data?.sipWebhookUrl ?? null}
          onClose={() => setTelephonyOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["settings", "integrations"] });
            qc.invalidateQueries({ queryKey: ["telephony", "status"] });
          }}
        />
      ) : null}

      <TgConnectWizard
        open={tgWizardOpen}
        onOpenChange={setTgWizardOpen}
        onConnected={() => {
          qc.invalidateQueries({
            queryKey: ["settings", "tg-webhook-status"],
          });
          qc.invalidateQueries({ queryKey: ["settings", "integrations"] });
        }}
      />
    </PageContainer>
  );
}

function IntegrationCard({
  icon,
  title,
  description,
  conn,
  configured,
  stateOverride,
  hint,
  onSetup,
  ctaKey,
  extra,
}: {
  kind: ProviderKind;
  icon: React.ReactNode;
  title: string;
  description: string;
  conn: ProviderConn | null;
  /** Optional override: if true, the card shows "ok" state regardless of `conn`. */
  configured?: boolean;
  /**
   * A verdict from the server that beats the saved row: telephony is
   * «Подключено» only once calls arrived, whatever was saved (UX-08), and
   * an integration that does not exist yet is «Недоступно» (ST-05).
   */
  stateOverride?: "ok" | "notConnected" | "unavailable";
  /** A line under the description explaining the state. */
  hint?: string;
  /** No handler → no setup button (nothing can be set up). */
  onSetup?: () => void;
  ctaKey?: "setup" | "tgConnect" | "tgReconnect";
  extra?: React.ReactNode;
}) {
  const t = useTranslations("settings");
  const state: "ok" | "warning" | "missing" | "notConnected" | "unavailable" =
    stateOverride ??
    (configured
      ? "ok"
      : !conn
        ? "missing"
        : conn.active && conn.hasSecret
          ? "ok"
          : "warning");
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
            {hint ? (
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            ) : null}
          </div>
        </div>
        {state === "ok" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
            <CheckCircle2Icon className="size-3" />
            {t("integrations.state.ok")}
          </span>
        ) : state === "warning" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
            <TriangleAlertIcon className="size-3" />
            {t("integrations.state.incomplete")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <PlugZapIcon className="size-3" />
            {state === "notConnected"
              ? t("integrations.state.notConnected")
              : state === "unavailable"
                ? t("integrations.state.unavailable")
                : t("integrations.state.missing")}
          </span>
        )}
      </div>
      {onSetup || extra ? (
        <div className="flex flex-wrap gap-2">
          {onSetup ? (
            <Button onClick={onSetup} variant="outline" size="sm">
              <PlugZapIcon className="size-4" />
              {ctaKey === "tgConnect"
                ? t("integrations.tgConnect")
                : ctaKey === "tgReconnect"
                  ? t("integrations.tgReconnect")
                  : t("integrations.setup")}
            </Button>
          ) : null}
          {extra}
        </div>
      ) : null}
    </section>
  );
}

function TgDisconnectButton({
  onDisconnected,
}: {
  onDisconnected: () => void;
}) {
  const t = useTranslations("settings");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const mut = useMutation({
    mutationFn: () =>
      settingsFetch("/api/crm/integrations/tg/disconnect", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      toast.success(t("integrations.tgDisconnected"));
      setConfirmOpen(false);
      onDisconnected();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        className="text-destructive hover:text-destructive"
      >
        {t("integrations.tgDisconnect")}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("integrations.tgDisconnectTitle")}</DialogTitle>
            <DialogDescription>
              {t("integrations.tgDisconnectHint")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => mut.mutate()}
              disabled={mut.isPending}
            >
              {mut.isPending
                ? t("common.saving")
                : t("integrations.tgDisconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Telephony: the address and the secret a PBX needs to post call events to
 * `/api/calls/sip/event` (audit ST-05). The old dialog saved a server, a
 * login and a password nothing read, and never the `webhookSecret` the
 * webhook checks, so every event was refused. The card turns «Подключено»
 * only once a call really arrives (UX-08).
 */
function TelephonyWebhookDialog({
  conn,
  webhookUrl,
  onClose,
  onSaved,
}: {
  conn: ProviderConn | null;
  webhookUrl: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("settings");
  const raw = conn?.active ? conn.config?.webhookSecret : null;
  const secret = typeof raw === "string" && raw.length > 0 ? raw : null;

  const mut = useMutation({
    mutationFn: (rotate: boolean) =>
      settingsFetch<ProviderConn>("/api/crm/integrations", {
        method: "POST",
        body: JSON.stringify({
          kind: "OTHER",
          label: "sip",
          active: true,
          rotateWebhookSecret: rotate,
        }),
      }),
    onSuccess: () => {
      toast.success(t("integrations.telephony.saved"));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("integrations.telephony.copied"));
    } catch {
      toast.error(t("integrations.telephony.copyFailed"));
    }
  };

  const row = (label: string, value: string) => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input value={value} readOnly className="font-mono text-xs" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void copy(value)}
          aria-label={t("integrations.telephony.copy")}
        >
          <CopyIcon className="size-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(v: boolean) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("integrations.telephony.title")}</DialogTitle>
          <DialogDescription>{t("integrations.telephony.hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {webhookUrl ? row(t("integrations.telephony.url"), webhookUrl) : null}
          {secret ? (
            <>
              {row(t("integrations.telephony.header"), "x-sip-secret")}
              {row(t("integrations.telephony.secret"), secret)}
              <p className="text-xs text-muted-foreground">
                {t("integrations.telephony.rotateHint")}
              </p>
            </>
          ) : (
            <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
              {t("integrations.telephony.noSecret")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button onClick={() => mut.mutate(Boolean(secret))} disabled={mut.isPending}>
            {mut.isPending
              ? t("common.saving")
              : secret
                ? t("integrations.telephony.rotate")
                : t("integrations.telephony.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TgWebhookPanel() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const statusQuery = useQuery({
    enabled: open,
    queryKey: ["settings", "tg-webhook-status"],
    queryFn: () =>
      settingsFetch<TgStatus>("/api/crm/integrations/tg/webhook-status"),
  });

  const setMut = useMutation({
    mutationFn: () =>
      settingsFetch("/api/crm/integrations/tg/set-webhook", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      toast.success(t("integrations.tgWebhookSaved"));
      statusQuery.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <RefreshCwIcon className="size-4" />
        {t("integrations.tgCheck")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("integrations.tgWebhook")}</DialogTitle>
            <DialogDescription>
              {t("integrations.tgWebhookHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            {statusQuery.isLoading ? (
              <div className="text-muted-foreground">{t("common.loading")}</div>
            ) : statusQuery.data?.notConfigured ? (
              <div className="rounded-md border border-border bg-muted p-3 text-muted-foreground">
                {t("integrations.tgNotConfigured")}
              </div>
            ) : statusQuery.data && "webhook" in statusQuery.data ? (
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("integrations.tgFields.url")}
                  </dt>
                  <dd className="break-all font-mono text-xs">
                    {statusQuery.data.webhook?.url ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("integrations.tgFields.pending")}
                  </dt>
                  <dd>
                    {statusQuery.data.webhook?.pending_update_count ?? 0}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("integrations.tgFields.lastError")}
                  </dt>
                  <dd>
                    {statusQuery.data.webhook?.last_error_message ?? "—"}
                    {statusQuery.data.webhook?.last_error_date
                      ? ` (${new Date(
                          statusQuery.data.webhook.last_error_date * 1000,
                        ).toLocaleString(intlLocale(locale))})`
                      : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("integrations.tgFields.hasSecret")}
                  </dt>
                  <dd>
                    {statusQuery.data.hasSecret
                      ? t("common.yes")
                      : t("common.no")}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="text-muted-foreground">—</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.close")}
            </Button>
            <Button
              onClick={() => statusQuery.refetch()}
              variant="outline"
              disabled={statusQuery.isFetching}
            >
              <RefreshCwIcon className="size-4" />
              {t("integrations.tgRefresh")}
            </Button>
            <Button
              onClick={() => setMut.mutate()}
              disabled={setMut.isPending}
            >
              {setMut.isPending
                ? t("common.saving")
                : t("integrations.tgSetWebhook")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

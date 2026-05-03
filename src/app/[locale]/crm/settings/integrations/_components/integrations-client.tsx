"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CreditCardIcon,
  MessageSquareIcon,
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
import { Switch } from "@/components/ui/switch";

import { settingsFetch } from "../../_hooks/use-settings-api";
import { PasswordReentryDialog } from "../../_components/password-reentry-dialog";
import { TgConnectWizard } from "./tg-connect-wizard";

type ProviderKind =
  | "TELEGRAM"
  | "SMS"
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
      settingsFetch<{ rows: ProviderConn[] }>("/api/crm/integrations"),
  });

  const [editKind, setEditKind] = React.useState<ProviderKind | null>(null);
  const [tgWizardOpen, setTgWizardOpen] = React.useState(false);

  const tgStatusQuery = useQuery({
    queryKey: ["settings", "tg-webhook-status"],
    queryFn: () =>
      settingsFetch<TgStatus>("/api/crm/integrations/tg/webhook-status"),
  });
  const tgConfigured = tgStatusQuery.data
    ? !tgStatusQuery.data.notConfigured
    : false;

  const connsByKind = React.useMemo(() => {
    const byKind: Partial<Record<ProviderKind, ProviderConn>> = {};
    for (const r of connsQuery.data?.rows ?? []) {
      // Take first (latest) active per kind.
      if (!byKind[r.kind]) byKind[r.kind] = r;
    }
    return byKind;
  }, [connsQuery.data]);

  return (
    <PageContainer>
      <SectionHeader
        title={t("integrations.title")}
        subtitle={t("integrations.subtitle")}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <IntegrationCard
          kind="SMS"
          icon={<MessageSquareIcon className="size-5" />}
          title={t("integrations.cards.sms.title")}
          description={t("integrations.cards.sms.description")}
          conn={connsByKind.SMS ?? null}
          onSetup={() => setEditKind("SMS")}
          extra={<SmsTestButton />}
        />

        <IntegrationCard
          kind="TELEGRAM"
          icon={<SendIcon className="size-5" />}
          title={t("integrations.cards.tg.title")}
          description={t("integrations.cards.tg.description")}
          conn={connsByKind.TELEGRAM ?? null}
          configured={tgConfigured}
          onSetup={() => {
            if (tgConfigured) setEditKind("TELEGRAM");
            else setTgWizardOpen(true);
          }}
          ctaKey={tgConfigured ? "setup" : "tgConnect"}
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

        <IntegrationCard
          kind="PAYME"
          icon={<CreditCardIcon className="size-5" />}
          title={t("integrations.cards.payment.title")}
          description={t("integrations.cards.payment.description")}
          conn={
            connsByKind.PAYME ??
            connsByKind.CLICK ??
            connsByKind.UZUM ??
            null
          }
          onSetup={() => setEditKind("PAYME")}
        />

        <IntegrationCard
          kind="OTHER"
          icon={<PhoneIcon className="size-5" />}
          title={t("integrations.cards.telephony.title")}
          description={t("integrations.cards.telephony.description")}
          conn={connsByKind.OTHER ?? null}
          onSetup={() => setEditKind("OTHER")}
        />
      </div>

      {editKind ? (
        <ProviderEditDialog
          kind={editKind}
          existing={connsByKind[editKind] ?? null}
          onClose={() => setEditKind(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["settings", "integrations"] });
            setEditKind(null);
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
  onSetup: () => void;
  ctaKey?: "setup" | "tgConnect";
  extra?: React.ReactNode;
}) {
  const t = useTranslations("settings");
  const state = configured
    ? "ok"
    : !conn
      ? "missing"
      : conn.active && conn.hasSecret
        ? "ok"
        : "warning";
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
            {t("integrations.state.missing")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSetup} variant="outline" size="sm">
          <PlugZapIcon className="size-4" />
          {ctaKey === "tgConnect"
            ? t("integrations.tgConnect")
            : t("integrations.setup")}
        </Button>
        {extra}
      </div>
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

function ProviderEditDialog({
  kind,
  existing,
  onClose,
  onSaved,
}: {
  kind: ProviderKind;
  existing: ProviderConn | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("settings");
  const [form, setForm] = React.useState({
    label: existing?.label ?? "",
    secret: "",
    active: existing?.active ?? true,
    config: existing?.config ? JSON.stringify(existing.config, null, 2) : "{}",
  });
  const [pwOpen, setPwOpen] = React.useState(false);

  const mut = useMutation({
    mutationFn: (currentPassword: string | undefined) => {
      let configParsed: Record<string, unknown> = {};
      try {
        configParsed = form.config ? JSON.parse(form.config) : {};
      } catch {
        throw new Error("Invalid JSON config");
      }
      const body: Record<string, unknown> = {
        kind,
        label: form.label || null,
        active: form.active,
        config: configParsed,
      };
      if (form.secret) {
        body.secret = form.secret;
        body.currentPassword = currentPassword;
      }
      return settingsFetch<ProviderConn>("/api/crm/integrations", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast.success(t("common.saved"));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const needsPassword = form.secret.length > 0;

  return (
    <>
      <Dialog open onOpenChange={(v: boolean) => !v && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("integrations.editTitle", { kind })}
            </DialogTitle>
            <DialogDescription>
              {t("integrations.editHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{t("integrations.fields.label")}</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder={t("integrations.fields.labelPlaceholder")}
              />
            </div>
            <div>
              <Label>{t("integrations.fields.secret")}</Label>
              <Input
                type="password"
                value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                placeholder={
                  existing?.hasSecret
                    ? t("integrations.fields.secretKeepBlank")
                    : ""
                }
                autoComplete="off"
              />
              {existing?.hasSecret ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("integrations.fields.currentSecretIndicator", {
                    mask: existing.secretMasked ?? "••••",
                  })}
                </p>
              ) : null}
            </div>
            <div>
              <Label>{t("integrations.fields.config")}</Label>
              <textarea
                className="flex h-32 w-full rounded-md border border-input bg-transparent px-3 py-1 font-mono text-xs"
                value={form.config}
                onChange={(e) => setForm({ ...form, config: e.target.value })}
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("integrations.fields.configHint")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.active}
                onCheckedChange={(v: boolean) => setForm({ ...form, active: v })}
                id="prov-active"
              />
              <Label htmlFor="prov-active">
                {form.active
                  ? t("integrations.active")
                  : t("integrations.inactive")}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (needsPassword) setPwOpen(true);
                else mut.mutate(undefined);
              }}
              disabled={mut.isPending}
            >
              {mut.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PasswordReentryDialog
        open={pwOpen}
        onOpenChange={setPwOpen}
        onConfirm={async (password) => {
          await mut.mutateAsync(password);
          setPwOpen(false);
        }}
      />
    </>
  );
}

function SmsTestButton() {
  const t = useTranslations("settings");
  const [open, setOpen] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [body, setBody] = React.useState(t("integrations.smsTestDefault"));
  const mut = useMutation({
    mutationFn: () =>
      settingsFetch("/api/crm/integrations/sms/test", {
        method: "POST",
        body: JSON.stringify({ phone, body }),
      }),
    onSuccess: () => {
      toast.success(t("integrations.smsTestSent"));
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <MessageSquareIcon className="size-4" />
        {t("integrations.smsTest")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("integrations.smsTest")}</DialogTitle>
            <DialogDescription>
              {t("integrations.smsTestHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{t("integrations.smsPhone")}</Label>
              <Input
                placeholder="+998 90 123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <Label>{t("integrations.smsBody")}</Label>
              <Input value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => mut.mutate()}
              disabled={!phone || !body || mut.isPending}
            >
              {mut.isPending ? t("common.saving") : t("integrations.smsSend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TgWebhookPanel() {
  const t = useTranslations("settings");
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
                        ).toLocaleString()})`
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

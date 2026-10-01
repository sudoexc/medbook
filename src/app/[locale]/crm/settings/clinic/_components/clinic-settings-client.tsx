"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileTextIcon,
  Loader2Icon,
  SaveIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDate, type Locale } from "@/lib/format";

import { SettingsApiError, settingsFetch } from "../../_hooks/use-settings-api";
import { KioskDeviceCard } from "./kiosk-device-card";
import { PasswordReentryDialog } from "../../_components/password-reentry-dialog";

type ClinicRow = {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  addressRu: string | null;
  addressUz: string | null;
  phone: string | null;
  email: string | null;
  brandColor: string;
  timezone: string;
  currency: "UZS" | "USD";
  secondaryCurrency: "UZS" | "USD" | null;
  workdayStart: string;
  workdayEnd: string;
  slotMin: number;
  tgBotUsername: string | null;
  tgBotToken: string | null; // "***" when set
  tgWebhookSecret: string | null; // "***" when set
  // Phase 16 Patient Experience surface — exposed in the "Опыт пациента"
  // section. Stored as flat clinic columns; the API accepts each as an
  // independent optional in `UpdateClinicSettingsSchema`.
  npsAlertThreshold: number;
  referralRewardPercent: number;
  medicationRemindersEnabled: boolean;
  // Phase 17 Wave 2 — Security toggles. `planSlug` is appended by the GET
  // handler so the UI can disable `require2faForAll` on Basic.
  require2faForAll: boolean;
  sessionIdleTimeoutMinutes: number;
  planSlug: "basic" | "pro" | "enterprise" | string;
  // Ф0 (TZ-smart-constructor) — printed-document settings.
  letterheadUrl: string | null;
  documentNumberPrefix: string | null;
  // Audit PT-08 — when «Учёт оплат в CRM» was turned on; null = off.
  paymentsTrackedSince: string | null;
};

/**
 * The form: the clinic row plus the «Учёт оплат» switch, which the API takes
 * as a boolean and turns into `paymentsTrackedSince` itself. Undefined until
 * the admin touches it, so a save never sends it by accident.
 */
type ClinicForm = Partial<ClinicRow> & { tracksPayments?: boolean };

const TIMEZONES = ["Asia/Tashkent", "Asia/Samarkand"];

/** API error code / reason of /api/crm/clinic/secrets → message key. */
const SECRET_ERROR_KEYS: Record<string, string> = {
  invalid_token: "invalidToken",
  token_format: "invalidToken",
  tg_error: "invalidToken",
  bot_in_use: "botInUse",
  https_required: "httpsRequired",
  webhook_failed: "webhookFailed",
  network_error: "network",
  RateLimited: "rateLimited",
};

export function ClinicSettingsClient() {
  const t = useTranslations("settings");
  const tSec = useTranslations("clinicSecurity");
  const locale = useLocale() as Locale;
  const qc = useQueryClient();

  const clinicQuery = useQuery({
    queryKey: ["settings", "clinic"],
    queryFn: () => settingsFetch<ClinicRow>("/api/crm/clinic"),
  });

  const [form, setForm] = React.useState<ClinicForm | null>(null);
  // What the form was loaded from (then: what the last save returned). A
  // save sends only the fields that differ from it, so a tab opened hours
  // ago does not put back what a colleague changed since (audit ST-07).
  const [baseline, setBaseline] = React.useState<ClinicForm | null>(null);
  React.useEffect(() => {
    if (clinicQuery.data && !form) {
      setForm({ ...clinicQuery.data });
      setBaseline({ ...clinicQuery.data });
    }
  }, [clinicQuery.data, form]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      settingsFetch<ClinicRow>("/api/crm/clinic", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (saved) => {
      toast.success(t("common.saved"));
      setBaseline((b) => ({ ...(b ?? {}), ...saved }));
      qc.invalidateQueries({ queryKey: ["settings", "clinic"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const secretsMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      settingsFetch<{ updated: boolean; botUsername?: string }>(
        "/api/crm/clinic/secrets",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
    onSuccess: (res) => {
      toast.success(
        res.botUsername
          ? t("clinic.secretsSaved", { username: res.botUsername })
          : t("common.saved"),
      );
      if (res.botUsername) {
        setForm((f) => (f ? { ...f, tgBotUsername: res.botUsername } : f));
      }
      qc.invalidateQueries({ queryKey: ["settings", "clinic"] });
      qc.invalidateQueries({ queryKey: ["settings", "tg-webhook-status"] });
    },
  });

  // Only the token is typed (audit ST-02): the bot's username comes from
  // Telegram and the webhook secret is generated on the server, so a stray
  // edit can no longer blank either of them. Empty means "keep".
  const [tokenDraft, setTokenDraft] = React.useState("");
  const [pwOpen, setPwOpen] = React.useState(false);

  // Ф0 — letterhead travels as multipart, so raw fetch (the browser must set
  // the boundary; settingsFetch pins content-type to JSON).
  const letterheadUpload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("letterhead", file);
      const res = await fetch("/api/crm/settings/letterhead", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { letterheadUrl: string };
    },
    onSuccess: ({ letterheadUrl }) => {
      setForm((f) => (f ? { ...f, letterheadUrl } : f));
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["settings", "clinic"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const letterheadRemove = useMutation({
    mutationFn: () =>
      settingsFetch<{ letterheadUrl: null }>("/api/crm/settings/letterhead", {
        method: "DELETE",
      }),
    onSuccess: () => {
      setForm((f) => (f ? { ...f, letterheadUrl: null } : f));
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["settings", "clinic"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (clinicQuery.isLoading || !form) {
    return (
      <PageContainer>
        <SectionHeader title={t("clinic.title")} subtitle={t("clinic.subtitle")} />
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      </PageContainer>
    );
  }

  if (clinicQuery.isError || !clinicQuery.data) {
    return (
      <PageContainer>
        <SectionHeader title={t("clinic.title")} />
        <div className="text-sm text-destructive">{t("common.error")}</div>
      </PageContainer>
    );
  }

  // Off unless an admin turned it on: debt is shown only while it is on.
  const tracksPayments =
    form.tracksPayments ?? form.paymentsTrackedSince != null;

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    const keys = [
      "nameRu",
      "nameUz",
      "addressRu",
      "addressUz",
      "phone",
      "email",
      "brandColor",
      "timezone",
      "workdayStart",
      "workdayEnd",
      "slotMin",
      // Phase 16 Patient Experience.
      "npsAlertThreshold",
      "referralRewardPercent",
      "medicationRemindersEnabled",
      // Phase 17 Wave 2 — Security.
      "require2faForAll",
      "sessionIdleTimeoutMinutes",
    ] as const;
    for (const k of keys) {
      const v = form[k];
      if (v !== undefined && v !== baseline?.[k]) payload[k] = v;
    }
    if (form.tracksPayments !== undefined) {
      payload.tracksPayments = form.tracksPayments;
    }
    // Currency is UZS-only for now — pin both fields so any stale USD value
    // gets cleared on the next save without touching the schema (the server
    // writes them only when they differ).
    payload.currency = "UZS";
    payload.secondaryCurrency = null;
    // Ф0 — empty prefix means "derive from slug"; the schema regex rejects
    // "", so normalise to null here.
    const prefix = (form.documentNumberPrefix ?? "").trim();
    const nextPrefix = prefix === "" ? null : prefix;
    if (nextPrefix !== (baseline?.documentNumberPrefix ?? null)) {
      payload.documentNumberPrefix = nextPrefix;
    }
    saveMutation.mutate(payload);
  };

  return (
    <PageContainer>
      <SectionHeader
        title={t("clinic.title")}
        subtitle={t("clinic.subtitle")}
        actions={
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            <SaveIcon className="size-4" />
            {saveMutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">{t("clinic.sections.info")}</h3>
          <div className="space-y-3">
            <div>
              <Label htmlFor="slug">{t("clinic.fields.slug")}</Label>
              <Input id="slug" value={form.slug ?? ""} readOnly disabled />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("clinic.fields.slugHint")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nameRu">{t("clinic.fields.nameRu")}</Label>
                <Input
                  id="nameRu"
                  value={form.nameRu ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, nameRu: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="nameUz">{t("clinic.fields.nameUz")}</Label>
                <Input
                  id="nameUz"
                  value={form.nameUz ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, nameUz: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="phone">{t("clinic.fields.phone")}</Label>
                <Input
                  id="phone"
                  value={form.phone ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, phone: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="email">{t("clinic.fields.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, email: e.target.value })
                  }
                />
              </div>
            </div>
            <div>
              <Label htmlFor="addressRu">
                {t("clinic.fields.addressRu")}
              </Label>
              <Input
                id="addressRu"
                value={form.addressRu ?? ""}
                onChange={(e) =>
                  setForm({ ...form, addressRu: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="addressUz">
                {t("clinic.fields.addressUz")}
              </Label>
              <Input
                id="addressUz"
                value={form.addressUz ?? ""}
                onChange={(e) =>
                  setForm({ ...form, addressUz: e.target.value })
                }
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">{t("clinic.sections.locale")}</h3>
          <div className="space-y-3">
            <div>
              <Label htmlFor="timezone">{t("clinic.fields.timezone")}</Label>
              <select
                id="timezone"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={form.timezone ?? "Asia/Tashkent"}
                onChange={(e) =>
                  setForm({ ...form, timezone: e.target.value })
                }
              >
                {(form.timezone && !TIMEZONES.includes(form.timezone)
                  ? [form.timezone, ...TIMEZONES]
                  : TIMEZONES
                ).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="currency">
                {t("clinic.fields.currencyPrimary")}
              </Label>
              <Input
                id="currency"
                value="UZS"
                readOnly
                className="text-muted-foreground"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="workdayStart">
                  {t("clinic.fields.workdayStart")}
                </Label>
                <Input
                  id="workdayStart"
                  type="time"
                  value={form.workdayStart ?? "09:00"}
                  onChange={(e) =>
                    setForm({ ...form, workdayStart: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="workdayEnd">
                  {t("clinic.fields.workdayEnd")}
                </Label>
                <Input
                  id="workdayEnd"
                  type="time"
                  value={form.workdayEnd ?? "19:00"}
                  onChange={(e) =>
                    setForm({ ...form, workdayEnd: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="slotMin">{t("clinic.fields.slotMin")}</Label>
                <Input
                  id="slotMin"
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={form.slotMin ?? 30}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      slotMin: Number(e.target.value) || 30,
                    })
                  }
                />
              </div>
            </div>
            <div>
              <Label htmlFor="brandColor">
                {t("clinic.fields.brandColor")}
              </Label>
              <Input
                id="brandColor"
                value={form.brandColor ?? "#3DD5C0"}
                onChange={(e) =>
                  setForm({ ...form, brandColor: e.target.value })
                }
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <FileTextIcon className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">
              {t("clinic.sections.documents")}
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="documentNumberPrefix">
                {t("clinic.fields.documentNumberPrefix")}
              </Label>
              <Input
                id="documentNumberPrefix"
                placeholder="NF"
                maxLength={12}
                value={form.documentNumberPrefix ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    documentNumberPrefix: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9-]/g, ""),
                  })
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("clinic.fields.documentNumberPrefixHint")}
              </p>
            </div>
            <div>
              <Label htmlFor="letterhead">
                {t("clinic.fields.letterhead")}
              </Label>
              {form.letterheadUrl ? (
                <div className="mt-2 space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.letterheadUrl}
                    alt={t("clinic.fields.letterhead")}
                    className="max-h-24 w-full rounded-md border border-border bg-white object-contain p-2"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={letterheadRemove.isPending}
                    onClick={() => letterheadRemove.mutate()}
                  >
                    {letterheadRemove.isPending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-4" />
                    )}
                    {t("clinic.fields.letterheadRemove")}
                  </Button>
                </div>
              ) : null}
              <Input
                id="letterhead"
                type="file"
                accept="image/png,image/jpeg"
                className="mt-2"
                disabled={letterheadUpload.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) letterheadUpload.mutate(file);
                  e.target.value = "";
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("clinic.fields.letterheadHint")}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold">
            {t("clinic.sections.patientExperience")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("clinic.patientExperienceHint")}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="npsAlertThreshold">
                {t("clinic.fields.npsAlertThreshold")}
              </Label>
              <Input
                id="npsAlertThreshold"
                type="number"
                min={1}
                max={10}
                step={1}
                value={form.npsAlertThreshold ?? 7}
                onChange={(e) =>
                  setForm({
                    ...form,
                    npsAlertThreshold: Math.min(
                      10,
                      Math.max(1, Number(e.target.value) || 7),
                    ),
                  })
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("clinic.fields.npsAlertThresholdHint")}
              </p>
            </div>
            <div>
              <Label htmlFor="referralRewardPercent">
                {t("clinic.fields.referralRewardPercent")}
              </Label>
              <Input
                id="referralRewardPercent"
                type="number"
                min={0}
                max={50}
                step={1}
                value={form.referralRewardPercent ?? 15}
                onChange={(e) =>
                  setForm({
                    ...form,
                    referralRewardPercent: Math.min(
                      50,
                      Math.max(0, Number(e.target.value) || 0),
                    ),
                  })
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("clinic.fields.referralRewardPercentHint")}
              </p>
            </div>
            <div className="flex flex-col">
              <Label htmlFor="medicationRemindersEnabled">
                {t("clinic.fields.medicationRemindersEnabled")}
              </Label>
              <div className="mt-2 flex items-center gap-2">
                <Switch
                  id="medicationRemindersEnabled"
                  checked={form.medicationRemindersEnabled ?? true}
                  onCheckedChange={(v: boolean) =>
                    setForm({ ...form, medicationRemindersEnabled: v })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {form.medicationRemindersEnabled
                    ? t("common.on")
                    : t("common.off")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("clinic.fields.medicationRemindersEnabledHint")}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold">
            {t("clinic.sections.payments")}
          </h3>
          <div className="flex flex-col">
            <Label htmlFor="tracksPayments">
              {t("clinic.fields.tracksPayments")}
            </Label>
            <div className="mt-2 flex items-center gap-2">
              <Switch
                id="tracksPayments"
                checked={tracksPayments}
                onCheckedChange={(v: boolean) =>
                  setForm({ ...form, tracksPayments: v })
                }
              />
              <span className="text-xs text-muted-foreground">
                {tracksPayments ? t("common.on") : t("common.off")}
              </span>
            </div>
            {tracksPayments && form.paymentsTrackedSince ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("clinic.fields.tracksPaymentsSince", {
                  date: formatDate(form.paymentsTrackedSince, locale, "short"),
                })}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {t("clinic.fields.tracksPaymentsHint")}
            </p>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">
              {tSec("sectionTitle")}
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col">
              <Label htmlFor="require2faForAll">
                {tSec("require2faTitle")}
              </Label>
              <div className="mt-2 flex items-center gap-2">
                <Switch
                  id="require2faForAll"
                  // Plan-gate the toggle in the UI: Basic plans cannot enable
                  // it (the API also rejects, but the UI signal is clearer).
                  // We still allow flipping OFF on any plan so a downgraded
                  // clinic can disable an inherited requirement.
                  disabled={
                    form.planSlug !== "pro" &&
                    form.planSlug !== "enterprise" &&
                    !form.require2faForAll
                  }
                  checked={form.require2faForAll ?? false}
                  onCheckedChange={(v: boolean) =>
                    setForm({ ...form, require2faForAll: v })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {form.require2faForAll ? t("common.on") : t("common.off")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {tSec("require2faHint")}
              </p>
              {form.planSlug !== "pro" && form.planSlug !== "enterprise" ? (
                <p className="mt-1 text-xs text-amber-600">
                  {tSec("require2faPlanLock")}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="sessionIdleTimeoutMinutes">
                {tSec("idleTimeoutTitle")}
              </Label>
              <Input
                id="sessionIdleTimeoutMinutes"
                type="number"
                min={5}
                max={240}
                step={5}
                value={form.sessionIdleTimeoutMinutes ?? 30}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sessionIdleTimeoutMinutes: Math.min(
                      240,
                      Math.max(5, Number(e.target.value) || 30),
                    ),
                  })
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {tSec("idleTimeoutHint")}
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">
              {t("clinic.sections.secrets")}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("clinic.secretsHint")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tgBotUsername">
                {t("clinic.fields.tgBotUsername")}
              </Label>
              <Input
                id="tgBotUsername"
                value={
                  form.tgBotUsername
                    ? `@${form.tgBotUsername}`
                    : t("clinic.fields.tgBotNone")
                }
                readOnly
                disabled
              />
            </div>
            <div>
              <Label htmlFor="tgBotToken">
                {t("clinic.fields.tgBotTokenNew")}
                {form.tgBotToken ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({t("clinic.fields.configured")})
                  </span>
                ) : null}
              </Label>
              <Input
                id="tgBotToken"
                type="password"
                placeholder="123456:ABC-..."
                autoComplete="off"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!tokenDraft.trim() || secretsMutation.isPending}
              onClick={() => setPwOpen(true)}
            >
              <SaveIcon className="size-4" />
              {t("clinic.saveSecrets")}
            </Button>
          </div>
        </section>
        <KioskDeviceCard />
      </div>

      <PasswordReentryDialog
        open={pwOpen}
        onOpenChange={setPwOpen}
        title={t("clinic.confirmSecretTitle")}
        description={t("clinic.confirmSecretDescription")}
        onConfirm={async (password) => {
          const token = tokenDraft.trim();
          if (!token) return;
          try {
            await secretsMutation.mutateAsync({
              tgBotToken: token,
              currentPassword: password,
            });
          } catch (e) {
            // Shown under the password field; nothing was saved.
            const reason = e instanceof SettingsApiError ? e.reason : undefined;
            const code = e instanceof SettingsApiError ? e.message : "";
            if (reason === "wrong_password") {
              throw new Error(t("passwordReentry.wrong"));
            }
            const key = SECRET_ERROR_KEYS[reason ?? code];
            if (key) throw new Error(t(`clinic.secretsErrors.${key}`));
            throw e;
          }
          setPwOpen(false);
          setTokenDraft("");
        }}
      />
    </PageContainer>
  );
}

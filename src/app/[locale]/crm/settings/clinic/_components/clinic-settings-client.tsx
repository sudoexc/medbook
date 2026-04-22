"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SaveIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { settingsFetch } from "../../_hooks/use-settings-api";
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
  smsSenderName: string | null;
  active: boolean;
};

const TIMEZONES = [
  "Asia/Tashkent",
  "Asia/Samarkand",
  "UTC",
  "Europe/Moscow",
];

export function ClinicSettingsClient() {
  const t = useTranslations("settings");
  const qc = useQueryClient();

  const clinicQuery = useQuery({
    queryKey: ["settings", "clinic"],
    queryFn: () => settingsFetch<ClinicRow>("/api/crm/clinic"),
  });

  const [form, setForm] = React.useState<Partial<ClinicRow> | null>(null);
  React.useEffect(() => {
    if (clinicQuery.data && !form) {
      setForm({ ...clinicQuery.data });
    }
  }, [clinicQuery.data, form]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      settingsFetch<ClinicRow>("/api/crm/clinic", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["settings", "clinic"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const secretsMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      settingsFetch<{ updated: boolean }>("/api/crm/clinic/secrets", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["settings", "clinic"] });
    },
  });

  const [secretDraft, setSecretDraft] = React.useState<{
    tgBotToken?: string;
    tgBotUsername?: string;
    tgWebhookSecret?: string;
    smsSenderName?: string;
  } | null>(null);
  const [pwOpen, setPwOpen] = React.useState(false);

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
      "currency",
      "secondaryCurrency",
      "workdayStart",
      "workdayEnd",
      "slotMin",
      "active",
    ] as const;
    for (const k of keys) {
      const v = form[k];
      if (v !== undefined) payload[k] = v;
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
            <div className="flex items-center gap-2 pt-2">
              <Switch
                id="active"
                checked={form.active ?? true}
                onCheckedChange={(v: boolean) =>
                  setForm({ ...form, active: v })
                }
              />
              <Label htmlFor="active">{t("clinic.fields.active")}</Label>
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
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="currency">
                  {t("clinic.fields.currencyPrimary")}
                </Label>
                <select
                  id="currency"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={form.currency ?? "UZS"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      currency: e.target.value as "UZS" | "USD",
                    })
                  }
                >
                  <option value="UZS">UZS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <Label htmlFor="secondaryCurrency">
                  {t("clinic.fields.currencySecondary")}
                </Label>
                <select
                  id="secondaryCurrency"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={form.secondaryCurrency ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      secondaryCurrency: (e.target.value || null) as
                        | "UZS"
                        | "USD"
                        | null,
                    })
                  }
                >
                  <option value="">{t("common.none")}</option>
                  <option value="UZS">UZS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
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
                placeholder="@neurofax_bot"
                defaultValue={form.tgBotUsername ?? ""}
                onChange={(e) =>
                  setSecretDraft({
                    ...(secretDraft ?? {}),
                    tgBotUsername: e.target.value,
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="tgBotToken">
                {t("clinic.fields.tgBotToken")}
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
                onChange={(e) =>
                  setSecretDraft({
                    ...(secretDraft ?? {}),
                    tgBotToken: e.target.value,
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="tgWebhookSecret">
                {t("clinic.fields.tgWebhookSecret")}
                {form.tgWebhookSecret ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({t("clinic.fields.configured")})
                  </span>
                ) : null}
              </Label>
              <Input
                id="tgWebhookSecret"
                type="password"
                autoComplete="off"
                onChange={(e) =>
                  setSecretDraft({
                    ...(secretDraft ?? {}),
                    tgWebhookSecret: e.target.value,
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="smsSenderName">
                {t("clinic.fields.smsSenderName")}
              </Label>
              <Input
                id="smsSenderName"
                placeholder="NEUROFAX"
                defaultValue={form.smsSenderName ?? ""}
                onChange={(e) =>
                  setSecretDraft({
                    ...(secretDraft ?? {}),
                    smsSenderName: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!secretDraft || secretsMutation.isPending}
              onClick={() => setPwOpen(true)}
            >
              <SaveIcon className="size-4" />
              {t("clinic.saveSecrets")}
            </Button>
          </div>
        </section>
      </div>

      <PasswordReentryDialog
        open={pwOpen}
        onOpenChange={setPwOpen}
        title={t("clinic.confirmSecretTitle")}
        description={t("clinic.confirmSecretDescription")}
        onConfirm={async (password) => {
          if (!secretDraft) return;
          await secretsMutation.mutateAsync({
            ...secretDraft,
            currentPassword: password,
          });
          setPwOpen(false);
          setSecretDraft(null);
        }}
      />
    </PageContainer>
  );
}

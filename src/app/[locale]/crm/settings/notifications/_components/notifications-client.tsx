"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRingIcon,
  ClockIcon,
  MessageSquareIcon,
  SaveIcon,
  SendIcon,
} from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { LogicalTriggerKey } from "@/server/notifications/rules";

import { settingsFetch } from "../../_hooks/use-settings-api";

import { previewContextFor } from "./preview-context";

type TemplateRow = {
  id: string;
  key: string;
  nameRu: string;
  nameUz: string;
  channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT";
  category: "REMINDER" | "MARKETING" | "TRANSACTIONAL";
  trigger: string;
  triggerConfig:
    | {
        offsetMin?: number | null;
        channels?: Array<"TG" | "SMS"> | null;
        enabled?: boolean | null;
        days?: number | null;
      }
    | null;
  bodyRu: string;
  bodyUz: string;
  isActive: boolean;
  updatedAt: string;
};

const CATEGORY_ORDER: Array<TemplateRow["category"]> = [
  "TRANSACTIONAL",
  "REMINDER",
  "MARKETING",
];

// Mirrors logicalTriggerKey() server-side for preview / placeholder list.
const ALLOWED_KEYS_BY_TRIGGER: Record<LogicalTriggerKey, string[]> = {
  "appointment.created": [
    "patient.name",
    "patient.phone",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "appointment.service",
    "appointment.cabinet",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  "appointment.reminder-24h": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "appointment.service",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  "appointment.reminder-2h": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  "appointment.cancelled": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
  ],
  birthday: ["patient.name", "patient.firstName", "clinic.name", "clinic.phone"],
  "no-show": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
  ],
  "payment.due": [
    "patient.name",
    "patient.firstName",
    "payment.amount",
    "payment.currency",
    "appointment.date",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
  ],
  manual: [
    "patient.name",
    "patient.firstName",
    "patient.phone",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "appointment.service",
    "appointment.cabinet",
    "payment.amount",
    "payment.currency",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
};

function logicalTriggerKey(row: TemplateRow): LogicalTriggerKey {
  if (row.key === "appointment.cancelled") return "appointment.cancelled";
  if (row.key === "payment.due") return "payment.due";
  switch (row.trigger) {
    case "APPOINTMENT_CREATED":
      return "appointment.created";
    case "APPOINTMENT_BEFORE": {
      const off = row.triggerConfig?.offsetMin ?? null;
      if (typeof off === "number" && off > -180 && off <= -60) {
        return "appointment.reminder-2h";
      }
      return "appointment.reminder-24h";
    }
    case "APPOINTMENT_MISSED":
      return "no-show";
    case "PATIENT_BIRTHDAY":
      return "birthday";
    default:
      return "manual";
  }
}

function PLACEHOLDER_RE() {
  return /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
}

function get(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function renderPreview(template: string, ctx: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER_RE(), (_full, key: string) => {
    const v = get(ctx, key);
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
  });
}

function findUnknownPlaceholders(template: string, allowed: string[]): string[] {
  const set = new Set(allowed);
  const seen = new Set<string>();
  const re = PLACEHOLDER_RE();
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    const key = m[1];
    if (key && !set.has(key)) seen.add(key);
  }
  return [...seen];
}

export function NotificationsSettingsClient() {
  const t = useTranslations("settings");
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["settings", "notifications", "templates"],
    queryFn: () =>
      settingsFetch<{ rows: TemplateRow[] }>(
        "/api/crm/settings/notifications/templates",
      ),
  });

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const rows = listQuery.data?.rows;
    if (!rows || rows.length === 0) return;
    if (selectedId && rows.some((r) => r.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [listQuery.data, selectedId]);

  const grouped = React.useMemo(() => {
    const out: Record<TemplateRow["category"], TemplateRow[]> = {
      TRANSACTIONAL: [],
      REMINDER: [],
      MARKETING: [],
    };
    for (const r of listQuery.data?.rows ?? []) {
      out[r.category]?.push(r);
    }
    return out;
  }, [listQuery.data]);

  const selected = React.useMemo(
    () => listQuery.data?.rows.find((r) => r.id === selectedId) ?? null,
    [listQuery.data, selectedId],
  );

  return (
    <PageContainer>
      <SectionHeader
        title={t("notifications.title")}
        subtitle={t("notifications.subtitle")}
      />

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("notifications.listTitle")}
          </div>
          {listQuery.isLoading ? (
            <div className="px-3 py-6 text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : (
            <div className="flex flex-col gap-3 px-2 py-3">
              {CATEGORY_ORDER.map((cat) => {
                const rows = grouped[cat];
                if (!rows || rows.length === 0) return null;
                return (
                  <div key={cat} className="space-y-1">
                    <div className="px-2 text-[11px] font-semibold uppercase text-muted-foreground">
                      {t(`notifications.categories.${cat}`)}
                    </div>
                    <ul className="space-y-0.5">
                      {rows.map((r) => {
                        const active = r.id === selectedId;
                        return (
                          <li key={r.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(r.id)}
                              className={cn(
                                "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                                active
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-muted",
                              )}
                              data-testid={`tpl-row-${r.key}`}
                            >
                              <span className="truncate font-medium">
                                {r.nameRu}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {r.key}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <main className="min-w-0">
          {selected ? (
            <TemplateEditorPane
              key={selected.id}
              row={selected}
              onSaved={() => {
                qc.invalidateQueries({
                  queryKey: ["settings", "notifications", "templates"],
                });
              }}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
              {t("notifications.empty")}
            </div>
          )}
        </main>
      </div>
    </PageContainer>
  );
}

function TemplateEditorPane({
  row,
  onSaved,
}: {
  row: TemplateRow;
  onSaved: () => void;
}) {
  const t = useTranslations("settings");
  const logical = logicalTriggerKey(row);
  const allowed = ALLOWED_KEYS_BY_TRIGGER[logical] ?? [];

  const [bodyRu, setBodyRu] = React.useState(row.bodyRu);
  const [bodyUz, setBodyUz] = React.useState(row.bodyUz);
  const [activeLangTab, setActiveLangTab] = React.useState<"ru" | "uz">("ru");
  const ruRef = React.useRef<HTMLTextAreaElement | null>(null);
  const uzRef = React.useRef<HTMLTextAreaElement | null>(null);

  const dirty = bodyRu !== row.bodyRu || bodyUz !== row.bodyUz;
  const unknownRu = findUnknownPlaceholders(bodyRu, allowed);
  const unknownUz = findUnknownPlaceholders(bodyUz, allowed);
  const emptyRu = bodyRu.trim().length === 0;
  const emptyUz = bodyUz.trim().length === 0;
  const canSave =
    dirty &&
    !emptyRu &&
    !emptyUz &&
    unknownRu.length === 0 &&
    unknownUz.length === 0;

  const saveMut = useMutation({
    mutationFn: () =>
      settingsFetch<TemplateRow>(
        `/api/crm/settings/notifications/templates/${row.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ bodyRu, bodyUz }),
        },
      ),
    onSuccess: () => {
      toast.success(t("common.saved"));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const insertAtCursor = (placeholder: string) => {
    const target =
      activeLangTab === "ru" ? ruRef.current : uzRef.current;
    const setter = activeLangTab === "ru" ? setBodyRu : setBodyUz;
    const current = activeLangTab === "ru" ? bodyRu : bodyUz;
    const token = `{{${placeholder}}}`;
    if (!target) {
      setter(current + token);
      return;
    }
    const start = target.selectionStart ?? current.length;
    const end = target.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setter(next);
    requestAnimationFrame(() => {
      target.focus();
      const pos = start + token.length;
      target.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">{row.key}</div>
            <h3 className="text-base font-semibold">{row.nameRu}</h3>
            <p className="text-xs text-muted-foreground">{row.nameUz}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-md bg-muted px-2 py-0.5">
              {t(`notifications.categories.${row.category}`)}
            </span>
            <span className="rounded-md bg-muted px-2 py-0.5">
              {row.trigger}
            </span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="body" className="flex flex-col gap-3">
        <TabsList>
          <TabsTrigger value="body">
            <MessageSquareIcon className="size-4" />
            {t("notifications.tabs.body")}
          </TabsTrigger>
          <TabsTrigger value="rules">
            <ClockIcon className="size-4" />
            {t("notifications.tabs.rules")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="body">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex flex-col gap-3">
              <Tabs
                value={activeLangTab}
                onValueChange={(v: string) =>
                  setActiveLangTab(v === "uz" ? "uz" : "ru")
                }
              >
                <TabsList>
                  <TabsTrigger value="ru">
                    {t("notifications.langs.ru")}
                  </TabsTrigger>
                  <TabsTrigger value="uz">
                    {t("notifications.langs.uz")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="ru" className="mt-3 space-y-2">
                  <Textarea
                    ref={ruRef}
                    value={bodyRu}
                    onChange={(e) => setBodyRu(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    className="font-mono text-sm"
                    data-testid="tpl-body-ru"
                  />
                  {emptyRu ? (
                    <p className="text-xs text-destructive">
                      {t("notifications.errors.empty")}
                    </p>
                  ) : null}
                  {unknownRu.length > 0 ? (
                    <p className="text-xs text-destructive">
                      {t("notifications.errors.unknown", {
                        keys: unknownRu.join(", "),
                      })}
                    </p>
                  ) : null}
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                    <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
                      {t("notifications.previewTitle")}
                    </div>
                    <div
                      className="whitespace-pre-wrap break-words"
                      data-testid="tpl-preview-ru"
                    >
                      {renderPreview(bodyRu, previewContextFor(logical, "ru"))}
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="uz" className="mt-3 space-y-2">
                  <Textarea
                    ref={uzRef}
                    value={bodyUz}
                    onChange={(e) => setBodyUz(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    className="font-mono text-sm"
                    data-testid="tpl-body-uz"
                  />
                  {emptyUz ? (
                    <p className="text-xs text-destructive">
                      {t("notifications.errors.empty")}
                    </p>
                  ) : null}
                  {unknownUz.length > 0 ? (
                    <p className="text-xs text-destructive">
                      {t("notifications.errors.unknown", {
                        keys: unknownUz.join(", "),
                      })}
                    </p>
                  ) : null}
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                    <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
                      {t("notifications.previewTitle")}
                    </div>
                    <div
                      className="whitespace-pre-wrap break-words"
                      data-testid="tpl-preview-uz"
                    >
                      {renderPreview(bodyUz, previewContextFor(logical, "uz"))}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex items-center justify-end gap-2">
                <Button
                  onClick={() => saveMut.mutate()}
                  disabled={!canSave || saveMut.isPending}
                  data-testid="tpl-save"
                >
                  <SaveIcon className="size-4" />
                  {saveMut.isPending
                    ? t("common.saving")
                    : t("common.save")}
                </Button>
              </div>
            </div>

            <aside className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t("notifications.varsTitle")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("notifications.varsHint")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allowed.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => insertAtCursor(k)}
                    className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] hover:bg-muted hover:text-foreground"
                    data-testid={`tpl-chip-${k}`}
                  >
                    {`{{${k}}}`}
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="rules">
          <RulesEditorPane row={row} onSaved={onSaved} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RulesEditorPane({
  row,
  onSaved,
}: {
  row: TemplateRow;
  onSaved: () => void;
}) {
  const t = useTranslations("settings");

  // Defaults for a fresh editor session.
  const initialOffsetMin = row.triggerConfig?.offsetMin ?? null;
  const initialChannels = (row.triggerConfig?.channels ?? null) as
    | Array<"TG" | "SMS">
    | null;
  const initialEnabled =
    row.triggerConfig?.enabled === false ? false : row.isActive;

  const [offsetMin, setOffsetMin] = React.useState<number | null>(
    initialOffsetMin,
  );
  const [channels, setChannels] = React.useState<Array<"TG" | "SMS"> | null>(
    initialChannels,
  );
  const [enabled, setEnabled] = React.useState<boolean>(initialEnabled);

  const isBefore = row.trigger === "APPOINTMENT_BEFORE";
  const dirty =
    enabled !== initialEnabled ||
    offsetMin !== initialOffsetMin ||
    JSON.stringify(channels) !== JSON.stringify(initialChannels);

  const saveMut = useMutation({
    mutationFn: () => {
      const triggerConfig: Record<string, unknown> = {
        ...(row.triggerConfig ?? {}),
        enabled,
      };
      if (isBefore && offsetMin !== null) {
        triggerConfig.offsetMin = offsetMin;
      }
      if (channels !== null) {
        triggerConfig.channels = channels;
      }
      return settingsFetch<TemplateRow>(
        `/api/crm/settings/notifications/templates/${row.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            triggerConfig,
            isActive: enabled,
          }),
        },
      );
    },
    onSuccess: () => {
      toast.success(t("common.saved"));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Hours-based offset slider. Step 0.5h → 30 minutes. Range 1..72 hours.
  const hours =
    typeof offsetMin === "number" ? Math.abs(offsetMin) / 60 : isBefore ? 24 : 0;

  const setHours = (h: number) => {
    const clamped = Math.max(1, Math.min(72, h));
    const stepped = Math.round(clamped * 2) / 2;
    setOffsetMin(-Math.round(stepped * 60));
  };

  const toggleChannel = (c: "TG" | "SMS") => {
    setChannels((prev) => {
      const cur = prev ? [...prev] : [];
      const idx = cur.indexOf(c);
      if (idx >= 0) cur.splice(idx, 1);
      else cur.push(c);
      return cur.length === 0 ? null : (cur as Array<"TG" | "SMS">);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">
              {t("notifications.rules.enabledTitle")}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("notifications.rules.enabledHint")}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            data-testid="rules-enabled"
          />
        </div>

        {isBefore ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {t("notifications.rules.offsetTitle")}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("notifications.rules.offsetHint")}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHours(hours - 0.5)}
                disabled={hours <= 1}
              >
                −
              </Button>
              <div
                className="flex h-9 min-w-[6rem] items-center justify-center rounded-md border border-input bg-transparent px-3 text-sm font-mono"
                data-testid="rules-hours"
              >
                {hours.toFixed(1)} {t("notifications.rules.hourSuffix")}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHours(hours + 0.5)}
                disabled={hours >= 72}
              >
                +
              </Button>
              <span className="text-xs text-muted-foreground">
                {t("notifications.rules.offsetMinLabel", {
                  minutes: -Math.round(hours * 60),
                })}
              </span>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="text-sm font-medium">
            {t("notifications.rules.channelsTitle")}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("notifications.rules.channelsHint")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["TG", "SMS"] as const).map((c) => {
              const checked = channels?.includes(c) ?? false;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleChannel(c)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                    checked
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-muted",
                  )}
                  data-testid={`rules-ch-${c}`}
                >
                  {c === "TG" ? (
                    <SendIcon className="size-3" />
                  ) : (
                    <MessageSquareIcon className="size-3" />
                  )}
                  {c}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {channels === null || channels.length === 0
              ? t("notifications.rules.channelsDefault")
              : t("notifications.rules.channelsSelected", {
                  list: channels.join(" → "),
                })}
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!dirty || saveMut.isPending}
            data-testid="rules-save"
          >
            <SaveIcon className="size-4" />
            {saveMut.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
        <div className="flex items-center gap-2 text-foreground">
          <BellRingIcon className="size-4 text-primary" />
          <span className="font-medium">
            {t("notifications.rules.summaryTitle")}
          </span>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            <strong className="text-foreground">{t("notifications.rules.triggerLabel")}:</strong>{" "}
            {row.trigger}
          </li>
          {isBefore ? (
            <li>
              <strong className="text-foreground">
                {t("notifications.rules.fireAt")}:
              </strong>{" "}
              {hours.toFixed(1)} {t("notifications.rules.hourSuffix")}
            </li>
          ) : null}
          <li>
            <strong className="text-foreground">
              {t("notifications.rules.channelsLabel")}:
            </strong>{" "}
            {channels && channels.length > 0
              ? channels.join(" → ")
              : t("notifications.rules.channelsDefaultShort")}
          </li>
          <li>
            <strong className="text-foreground">
              {t("notifications.rules.statusLabel")}:
            </strong>{" "}
            {enabled
              ? t("notifications.rules.statusOn")
              : t("notifications.rules.statusOff")}
          </li>
        </ul>
      </section>
    </div>
  );
}

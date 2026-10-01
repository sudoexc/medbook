"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  EyeIcon,
  RocketIcon,
  SaveIcon,
  Trash2Icon,
  VariableIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import type { Template } from "../_hooks/use-templates";
import {
  useCreateTemplate,
  useDeleteTemplate,
  useUpdateTemplate,
} from "../_hooks/use-templates";
import type { TemplateCategory, TemplateChannel } from "../_hooks/types";
import { ALLOWED_KEYS_BY_TRIGGER, render } from "@/server/notifications/template";
import {
  TEMPLATE_EVENTS,
  eventOfTemplate,
  templateEventById,
} from "@/server/notifications/template-events";
import { toTelegramHtml } from "@/server/notifications/telegram-html";
import { AiCopySuggest } from "./ai-copy-suggest";

type Props = {
  templates: Template[];
  selectedId: string | null;
  onSelectCreated: (id: string) => void;
};

type FormState = {
  key: string;
  nameRu: string;
  nameUz: string;
  channel: TemplateChannel;
  category: TemplateCategory;
  bodyRu: string;
  bodyUz: string;
  isActive: boolean;
  /**
   * What sends the template (audit TG-25): "manual", a `TEMPLATE_EVENTS` id,
   * or, for a template bound outside this editor, "custom" (an admin offset
   * from the notification settings) / "system" (a worker's own schedule).
   */
  event: string;
};

const EMPTY: FormState = {
  key: "",
  nameRu: "",
  nameUz: "",
  channel: "TG",
  category: "REMINDER",
  bodyRu: "",
  bodyUz: "",
  isActive: true,
  event: "manual",
};

/** The editor's event choice for a stored template. */
function eventChoiceOf(tpl: { key: string; trigger: string; triggerConfig: unknown }): string {
  const event = eventOfTemplate(tpl);
  if (event) return event.id;
  if (tpl.trigger === "MANUAL") return "manual";
  return tpl.trigger === "APPOINTMENT_BEFORE" ? "custom" : "system";
}

function extractVars(template: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) out.push(m[1]);
  return out;
}

/**
 * The preview as the patient sees it in Telegram (audit TG-24): the same
 * `render` as the materialisers, then the same HTML safety pass as the
 * sender. A stray «<14» shows as typed, «<b>» shows bold.
 */
function telegramPreview(template: string, sample: Record<string, unknown>): string {
  return toTelegramHtml(render(template, sample));
}

/** Simple handlebars-style preview. Keeps the client lean — no server round-trip. */
function previewRender(template: string, sample: Record<string, unknown>): string {
  const get = (path: string): unknown => {
    let cur: unknown = sample;
    for (const p of path.split(".")) {
      if (cur && typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[p];
      } else return undefined;
    }
    return cur;
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => {
    const raw = get(key);
    if (raw === null || raw === undefined) return "";
    return String(raw);
  });
}

function buildSample(
  t: (key: string) => string,
): Record<string, unknown> {
  return {
    patient: {
      name: t("editor.samplePatientName"),
      firstName: t("editor.samplePatientFirst"),
      phone: "+998 90 123-45-67",
    },
    appointment: {
      date: t("editor.sampleAppointmentDate"),
      time: "10:00",
      doctor: t("editor.sampleDoctor"),
      service: t("editor.sampleService"),
      cabinet: "12",
    },
    payment: { amount: "250 000", currency: "UZS" },
    clinic: {
      name: "Neurofax",
      phone: "+998 71 123-45-67",
      address: t("editor.sampleClinicAddress"),
    },
  };
}

export function TemplateEditor({ templates, selectedId, onSelectCreated }: Props) {
  const t = useTranslations("notifications");
  const sample = React.useMemo(() => buildSample(t), [t]);
  const selected = selectedId ? templates.find((tpl) => tpl.id === selectedId) ?? null : null;
  const [form, setForm] = React.useState<FormState>(EMPTY);
  // Only an event the admin picked is written back: an edited text must not
  // unbind a template from the schedule it was given elsewhere.
  const [eventTouched, setEventTouched] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (selected) {
      setForm({
        key: selected.key,
        nameRu: selected.nameRu,
        nameUz: selected.nameUz,
        channel: selected.channel,
        category: selected.category,
        bodyRu: selected.bodyRu,
        bodyUz: selected.bodyUz,
        isActive: selected.isActive,
        event: eventChoiceOf(selected),
      });
    } else {
      setForm(EMPTY);
    }
    setEventTouched(false);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const createMut = useCreateTemplate();
  const updateMut = useUpdateTemplate();
  const deleteMut = useDeleteTemplate();

  const isCreate = !selected;
  const saving = createMut.isPending || updateMut.isPending;

  const triggerFields = (event: string) => {
    const e = templateEventById(event);
    return e
      ? { trigger: e.trigger, triggerConfig: e.triggerConfig }
      : { trigger: "MANUAL", triggerConfig: null };
  };

  const onSave = async () => {
    const { event, ...fields } = form;
    try {
      if (isCreate) {
        const created = await createMut.mutateAsync({ ...fields, ...triggerFields(event) });
        toast.success(t("editor.saved"));
        onSelectCreated(created.id);
      } else {
        const bind =
          eventTouched && event !== "custom" && event !== "system" ? triggerFields(event) : {};
        await updateMut.mutateAsync({ id: selected.id, patch: { ...fields, ...bind } });
        setEventTouched(false);
        toast.success(t("editor.saved"));
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onDelete = async () => {
    if (!selected) return;
    try {
      await deleteMut.mutateAsync(selected.id);
      toast.success(t("editor.deleted"));
      setConfirmDelete(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onTestSend = async () => {
    if (!selected) {
      toast.info(t("editor.saveBeforeTest"));
      return;
    }
    try {
      const res = await fetch("/api/crm/notifications/sends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          templateId: selected.id,
          patientId: "dev-fake-patient",
          channel: selected.channel,
          recipient: "+998000000000",
          body: previewRender(selected.bodyRu, sample),
          scheduledFor: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("editor.testSent"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // The placeholders the chosen event's materialiser fills.
  const chosenEvent = templateEventById(form.event);
  const placeholderKey = chosenEvent?.placeholders ?? form.key;
  const allowedForKey =
    placeholderKey in ALLOWED_KEYS_BY_TRIGGER
      ? ALLOWED_KEYS_BY_TRIGGER[placeholderKey]
      : Array.from(
          new Set(
            Object.values(ALLOWED_KEYS_BY_TRIGGER).flat(),
          ),
        );

  const allowedSet = React.useMemo(
    () => new Set(allowedForKey),
    [allowedForKey],
  );
  const unknownVarsRu = React.useMemo(
    () => extractVars(form.bodyRu).filter((v) => !allowedSet.has(v)),
    [form.bodyRu, allowedSet],
  );

  const insertPlaceholder = (key: string) => {
    update("bodyRu", form.bodyRu + `{{${key}}}`);
  };

  return (
    <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {isCreate ? t("editor.newTitle") : t("editor.editTitle")}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("editor.active")}
          </span>
          <Switch
            checked={form.isActive}
            onCheckedChange={(v) => update("isActive", v)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tpl-key">{t("editor.key")}</Label>
          <Input
            id="tpl-key"
            value={form.key}
            onChange={(e) => update("key", e.currentTarget.value)}
            placeholder="appointment.reminder-24h"
          />
        </div>

        <div className="space-y-1">
          <Label>{t("editor.event")}</Label>
          <Select
            value={form.event}
            onValueChange={(v) => {
              update("event", v);
              setEventTouched(true);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{t("editor.eventManual")}</SelectItem>
              {TEMPLATE_EVENTS.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {t(`triggers.events.${e.label}`)}
                </SelectItem>
              ))}
              {form.event === "custom" || form.event === "system" ? (
                <SelectItem value={form.event} disabled>
                  {t(form.event === "custom" ? "editor.eventCustom" : "editor.eventSystem")}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t("editor.eventHint")}</p>
        </div>

        <div className="space-y-1">
          <Label>{t("editor.channel")}</Label>
          {/* Telegram is the only channel with an adapter (audit TG-25):
              Email used to be offered and every row it made FAILED. A
              legacy row keeps showing its channel, marked as not sent. */}
          <Select
            value={form.channel}
            onValueChange={(v) => update("channel", v as TemplateChannel)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TG">Telegram</SelectItem>
              {form.channel !== "TG" ? (
                <SelectItem value={form.channel} disabled>
                  {t("editor.channelUnavailable", { channel: form.channel })}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="tpl-name-ru">{t("editor.nameRu")}</Label>
          <Input
            id="tpl-name-ru"
            value={form.nameRu}
            onChange={(e) => update("nameRu", e.currentTarget.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="tpl-name-uz">{t("editor.nameUz")}</Label>
          <Input
            id="tpl-name-uz"
            value={form.nameUz}
            onChange={(e) => update("nameUz", e.currentTarget.value)}
          />
        </div>

        <div className="space-y-1">
          <Label>{t("editor.category")}</Label>
          <Select
            value={form.category}
            onValueChange={(v) => update("category", v as TemplateCategory)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REMINDER">{t("categories.REMINDER")}</SelectItem>
              <SelectItem value="MARKETING">{t("categories.MARKETING")}</SelectItem>
              <SelectItem value="TRANSACTIONAL">{t("categories.TRANSACTIONAL")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="tpl-body-ru">{t("editor.bodyRu")}</Label>
          <div className="flex items-center gap-2">
            <AiCopySuggest
              channel={form.channel}
              locale="ru"
              triggerKey={chosenEvent?.id ?? (form.key || null)}
              onUse={(text) => update("bodyRu", text)}
            />
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <VariableIcon className="size-3.5" />
              {t("editor.placeholders")}
            </div>
          </div>
        </div>
        <Textarea
          id="tpl-body-ru"
          value={form.bodyRu}
          onChange={(e) => update("bodyRu", e.currentTarget.value)}
          rows={5}
          placeholder={t("editor.bodyPlaceholder")}
        />
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span />
          {unknownVarsRu.length > 0 ? (
            <span className="text-destructive">
              {t("editor.unknownVar", { var: unknownVarsRu[0] })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {allowedForKey.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => insertPlaceholder(k)}
              className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-mono text-primary hover:bg-primary/20"
            >
              {"{{"}
              {k}
              {"}}"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="tpl-body-uz">{t("editor.bodyUz")}</Label>
          <AiCopySuggest
            channel={form.channel}
            locale="uz"
            triggerKey={chosenEvent?.id ?? (form.key || null)}
            onUse={(text) => update("bodyUz", text)}
          />
        </div>
        <Textarea
          id="tpl-body-uz"
          value={form.bodyUz}
          onChange={(e) => update("bodyUz", e.currentTarget.value)}
          rows={5}
        />
      </div>

      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <EyeIcon className="size-3.5" />
          {t("editor.preview")}
          <Badge variant="muted">{form.channel}</Badge>
        </div>
        {form.bodyRu.trim() ? (
          <div
            className="whitespace-pre-wrap font-sans text-sm text-foreground [&_a]:text-primary [&_a]:underline [&_code]:font-mono [&_pre]:font-mono"
            // Safe: `toTelegramHtml` emits only Telegram's formatting tags,
            // attribute-free except an http(s)/tg:// href, and entities.
            dangerouslySetInnerHTML={{ __html: telegramPreview(form.bodyRu, sample) }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("editor.previewEmpty")}</p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">{t("editor.previewHint")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-2">
          <Button onClick={onSave} disabled={saving}>
            <SaveIcon className="size-4" />
            {saving ? t("editor.saving") : t("editor.save")}
          </Button>
          {!isCreate ? (
            <Button
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMut.isPending}
            >
              <Trash2Icon className="size-4" />
              {deleteMut.isPending ? t("editor.deleting") : t("editor.delete")}
            </Button>
          ) : null}
        </div>
        <Button variant="outline" onClick={onTestSend} disabled={!selected}>
          <RocketIcon className="size-4" />
          {t("editor.testSend")}
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("editor.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("editor.deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("editor.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>
              {t("editor.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

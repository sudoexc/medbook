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
import {
  ALLOWED_KEYS_BY_TRIGGER,
  TRIGGER_KEYS,
} from "@/server/notifications/template";

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
};

const EMPTY: FormState = {
  key: "",
  nameRu: "",
  nameUz: "",
  channel: "SMS",
  category: "REMINDER",
  bodyRu: "",
  bodyUz: "",
  isActive: true,
};

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
      });
    } else {
      setForm(EMPTY);
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const createMut = useCreateTemplate();
  const updateMut = useUpdateTemplate();
  const deleteMut = useDeleteTemplate();

  const isCreate = !selected;
  const saving = createMut.isPending || updateMut.isPending;

  const onSave = async () => {
    try {
      if (isCreate) {
        const created = await createMut.mutateAsync(form);
        toast.success(t("editor.saved"));
        onSelectCreated(created.id);
      } else {
        await updateMut.mutateAsync({ id: selected.id, patch: form });
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

  const allowedForKey =
    form.key in ALLOWED_KEYS_BY_TRIGGER
      ? ALLOWED_KEYS_BY_TRIGGER[form.key]
      : Array.from(
          new Set(
            Object.values(ALLOWED_KEYS_BY_TRIGGER).flat(),
          ),
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
          <div className="flex flex-wrap gap-1 pt-1">
            {TRIGGER_KEYS.map((tk) => (
              <button
                key={tk}
                type="button"
                onClick={() => update("key", tk)}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/80"
              >
                {tk}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label>{t("editor.channel")}</Label>
          <Select
            value={form.channel}
            onValueChange={(v) => update("channel", v as TemplateChannel)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SMS">SMS</SelectItem>
              <SelectItem value="TG">Telegram</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
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
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <VariableIcon className="size-3.5" />
            {t("editor.placeholders")}
          </div>
        </div>
        <Textarea
          id="tpl-body-ru"
          value={form.bodyRu}
          onChange={(e) => update("bodyRu", e.currentTarget.value)}
          rows={5}
          placeholder={t("editor.bodyPlaceholder")}
        />
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
        <Label htmlFor="tpl-body-uz">{t("editor.bodyUz")}</Label>
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
        <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">
          {previewRender(form.bodyRu, sample) || t("editor.previewEmpty")}
        </pre>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-2">
          <Button onClick={onSave} disabled={saving}>
            <SaveIcon className="size-4" />
            {t("editor.save")}
          </Button>
          {!isCreate ? (
            <Button
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMut.isPending}
            >
              <Trash2Icon className="size-4" />
              {t("editor.delete")}
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

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDownIcon,
  ClipboardListIcon,
  Loader2Icon,
  PencilIcon,
  PillIcon,
  PlusIcon,
  SaveIcon,
  ScrollTextIcon,
  StethoscopeIcon,
  Trash2Icon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";

import {
  useCreatePreset,
  useDeletePreset,
  useDoctorPresets,
  useUpdatePreset,
  type DoctorPresetRow,
  type PresetField,
} from "../../reception/_hooks/use-doctor-presets";

type FieldDef = {
  key: PresetField;
  Icon: LucideIcon;
};

const FIELDS: FieldDef[] = [
  { key: "COMPLAINTS", Icon: ClipboardListIcon },
  { key: "ANAMNESIS", Icon: ScrollTextIcon },
  { key: "EXAMINATION", Icon: StethoscopeIcon },
  { key: "PRESCRIPTIONS", Icon: PillIcon },
  { key: "ADVICE", Icon: WandSparklesIcon },
];

export function PresetsTab() {
  const t = useTranslations("doctor.settings");
  const presetsQuery = useDoctorPresets();
  const rows = presetsQuery.data ?? [];

  const grouped = React.useMemo(() => {
    const map: Record<PresetField, DoctorPresetRow[]> = {
      COMPLAINTS: [],
      ANAMNESIS: [],
      EXAMINATION: [],
      PRESCRIPTIONS: [],
      ADVICE: [],
    };
    for (const r of rows) map[r.field].push(r);
    return map;
  }, [rows]);

  if (presetsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        {t("presets.intro")}
      </div>

      {FIELDS.map((f) => (
        <FieldSection key={f.key} def={f} rows={grouped[f.key]} />
      ))}
    </div>
  );
}

function FieldSection({
  def,
  rows,
}: {
  def: FieldDef;
  rows: DoctorPresetRow[];
}) {
  const t = useTranslations("doctor.settings");
  const [open, setOpen] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const Icon = def.Icon;

  return (
    <section className="rounded-2xl border border-border bg-card">
      <header
        className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">
              {t(`presets.fields.${def.key}.label`)}
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {rows.length}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t(`presets.fields.${def.key}.hint`)}
            </div>
          </div>
        </div>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
              setAdding(true);
            }}
            className="motion-press inline-flex h-8 items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            <PlusIcon className="size-3.5" />
            {t("presets.add")}
          </button>
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
        </div>
      </header>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          {adding && (
            <PresetEditor
              field={def.key}
              onClose={() => setAdding(false)}
            />
          )}
          {rows.length === 0 && !adding ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              {t("presets.empty")}
            </p>
          ) : (
            rows.map((r) => <PresetRow key={r.id} row={r} />)
          )}
        </div>
      )}
    </section>
  );
}

function PresetRow({ row }: { row: DoctorPresetRow }) {
  const t = useTranslations("doctor.settings");
  const [editing, setEditing] = React.useState(false);
  const del = useDeletePreset();

  if (editing) {
    return (
      <PresetEditor
        field={row.field}
        initial={row}
        onClose={() => setEditing(false)}
      />
    );
  }

  const handleDelete = () => {
    if (!confirm(t("presets.deleteConfirm", { label: row.label }))) return;
    del.mutate(row.id, {
      onSuccess: () => toast.success(t("presets.deleted")),
      onError: () => toast.error(t("presets.deleteError")),
    });
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-md border border-primary/20 bg-primary/10 px-2 text-xs font-semibold text-primary">
            {row.label}
          </span>
          {row.fieldValue !== row.label && (
            <span className="truncate text-xs text-muted-foreground">
              → «{row.fieldValue}»
            </span>
          )}
          {row.noteTemplate && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              <WandSparklesIcon className="size-2.5 text-primary/70" />
              {t("presets.templateBadge")}
            </span>
          )}
        </div>
        {row.noteTemplate && (
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
            {row.noteTemplate}
          </p>
        )}
      </div>
      <div className="inline-flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t("actions.edit")}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PencilIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={del.isPending}
          aria-label={t("actions.delete")}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {del.isPending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <Trash2Icon className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function PresetEditor({
  field,
  initial,
  onClose,
}: {
  field: PresetField;
  initial?: DoctorPresetRow;
  onClose: () => void;
}) {
  const t = useTranslations("doctor.settings");
  const [label, setLabel] = React.useState(initial?.label ?? "");
  const [fieldValue, setFieldValue] = React.useState(
    initial?.fieldValue ?? initial?.label ?? "",
  );
  const [noteTemplate, setNoteTemplate] = React.useState(
    initial?.noteTemplate ?? "",
  );
  const [valueLinked, setValueLinked] = React.useState(
    !initial || initial.label === initial.fieldValue,
  );

  const create = useCreatePreset();
  const update = useUpdatePreset(initial?.id ?? null);
  const isPending = create.isPending || update.isPending;

  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (valueLinked) setFieldValue(v);
  };

  const handleSave = () => {
    const l = label.trim();
    const v = (valueLinked ? l : fieldValue.trim()) || l;
    if (!l || !v) {
      toast.error(t("presets.editor.nameRequired"));
      return;
    }
    const payload = {
      label: l,
      fieldValue: v,
      noteTemplate: noteTemplate.trim() || null,
    };
    if (initial) {
      update.mutate(payload, {
        onSuccess: () => {
          toast.success(t("presets.saved"));
          onClose();
        },
        onError: () => toast.error(t("actions.saveError")),
      });
    } else {
      create.mutate(
        { field, ...payload },
        {
          onSuccess: () => {
            toast.success(t("presets.added"));
            onClose();
          },
          onError: () => toast.error(t("presets.addError")),
        },
      );
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("presets.editor.chipNameLabel")}
          </span>
          <input
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder={t("presets.editor.chipNamePlaceholder")}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{t("presets.editor.fieldValueLabel")}</span>
            <button
              type="button"
              onClick={() => {
                setValueLinked((v) => {
                  const next = !v;
                  if (next) setFieldValue(label);
                  return next;
                });
              }}
              className="font-normal normal-case tracking-normal text-primary hover:underline"
            >
              {valueLinked ? t("presets.editor.unlink") : t("presets.editor.sameAsName")}
            </button>
          </span>
          <input
            value={fieldValue}
            onChange={(e) => setFieldValue(e.target.value)}
            disabled={valueLinked}
            placeholder={t("presets.editor.fieldValuePlaceholder")}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t.rich("presets.editor.noteTemplateLabel", {
            optional: (chunks) => (
              <span className="font-normal normal-case tracking-normal text-muted-foreground">
                {chunks}
              </span>
            ),
          })}
        </span>
        <textarea
          value={noteTemplate}
          onChange={(e) => setNoteTemplate(e.target.value)}
          placeholder={t("presets.editor.noteTemplatePlaceholder")}
          rows={3}
          className="resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" />
          {t("actions.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <SaveIcon className="size-3.5" />
          )}
          {t("actions.save")}
        </button>
      </div>
    </div>
  );
}

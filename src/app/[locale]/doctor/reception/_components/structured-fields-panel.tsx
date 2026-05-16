"use client";

import * as React from "react";
import {
  ClipboardListIcon,
  FileTextIcon,
  Loader2Icon,
  PillIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  StethoscopeIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  useDoctorPresets,
  type DoctorPresetRow,
  type PresetField,
} from "../_hooks/use-doctor-presets";
import { useIcd10Search } from "../_hooks/use-icd10";
import {
  usePatchVisitNote,
  useVisitNote,
  type VisitNotePatch,
  type VisitNoteRow,
} from "../_hooks/use-visit-note";
import { DosageBuilderDialog } from "./dosage-builder-dialog";

type ArrayKey =
  | "complaints"
  | "anamnesis"
  | "examination"
  | "prescriptions"
  | "advice";

type FieldDef = {
  key: ArrayKey;
  label: string;
  Icon: LucideIcon;
  placeholder: string;
  presetField: PresetField;
};

const FIELDS: FieldDef[] = [
  {
    key: "complaints",
    label: "Жалобы",
    Icon: ClipboardListIcon,
    placeholder: "Например: головная боль",
    presetField: "COMPLAINTS",
  },
  {
    key: "anamnesis",
    label: "Анамнез",
    Icon: ScrollTextIcon,
    placeholder: "Например: стресс, нарушение сна",
    presetField: "ANAMNESIS",
  },
  {
    key: "examination",
    label: "Осмотр",
    Icon: StethoscopeIcon,
    placeholder: "Например: сознание ясное",
    presetField: "EXAMINATION",
  },
  {
    key: "prescriptions",
    label: "Назначения",
    Icon: PillIcon,
    placeholder: "Например: Мексидол 125 мг",
    presetField: "PRESCRIPTIONS",
  },
  {
    key: "advice",
    label: "Рекомендации",
    Icon: WandSparklesIcon,
    placeholder: "Например: режим сна",
    presetField: "ADVICE",
  },
];

export function StructuredFieldsPanel() {
  const { visitNoteId, requestBodyAppend, requestBodyRemove } =
    useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const presetsQuery = useDoctorPresets();
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";
  const [builderOpen, setBuilderOpen] = React.useState(false);

  const applyPatch = React.useCallback(
    (p: VisitNotePatch) => {
      if (!note || isFinalized) return;
      patch.mutate(p);
    },
    [note, isFinalized, patch],
  );

  const presetsByField = React.useMemo(() => {
    const map: Partial<Record<PresetField, DoctorPresetRow[]>> = {};
    for (const p of presetsQuery.data ?? []) {
      (map[p.field] ??= []).push(p);
    }
    return map;
  }, [presetsQuery.data]);

  const handleAddPrescription = React.useCallback(
    (line: string) => {
      if (!note || isFinalized) return;
      const current = note.prescriptions ?? [];
      if (current.includes(line)) return;
      applyPatch({ prescriptions: [...current, line] });
    },
    [note, isFinalized, applyPatch],
  );

  const handlePresetClick = React.useCallback(
    (def: FieldDef, preset: DoctorPresetRow) => {
      if (!note || isFinalized) return;
      const arr = note[def.key] ?? [];
      if (!arr.includes(preset.fieldValue)) {
        applyPatch({ [def.key]: [...arr, preset.fieldValue] } as VisitNotePatch);
      }
      if (preset.noteTemplate && preset.noteTemplate.trim()) {
        requestBodyAppend(preset.noteTemplate);
      }
    },
    [note, isFinalized, applyPatch, requestBodyAppend],
  );

  const handleRemoveChip = React.useCallback(
    (def: FieldDef, chip: string) => {
      if (!note || isFinalized) return;
      const arr = note[def.key] ?? [];
      applyPatch({
        [def.key]: arr.filter((c) => c !== chip),
      } as VisitNotePatch);
      // If the removed chip matches a preset with a template, strip the
      // template from the conclusion editor too. Match on fieldValue (what
      // got stored) so user-edited / manual chips don't accidentally remove
      // anything.
      const preset = (presetsByField[def.presetField] ?? []).find(
        (p) => p.fieldValue === chip && p.noteTemplate,
      );
      if (preset?.noteTemplate) {
        requestBodyRemove(preset.noteTemplate);
      }
    },
    [note, isFinalized, applyPatch, presetsByField, requestBodyRemove],
  );

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Структурированные поля
        </h2>
        {patch.isPending && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            Сохраняем…
          </span>
        )}
      </div>

      {!note ? (
        <p className="text-xs text-muted-foreground">
          Откройте активный приём, чтобы начать заполнение.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {FIELDS.map((f) => (
            <ChipFieldCard
              key={f.key}
              def={f}
              value={note[f.key] ?? []}
              presets={presetsByField[f.presetField] ?? []}
              disabled={isFinalized}
              onChange={(next) => applyPatch({ [f.key]: next } as VisitNotePatch)}
              onPresetClick={(preset) => handlePresetClick(f, preset)}
              onRemoveChip={(chip) => handleRemoveChip(f, chip)}
              onOpenBuilder={
                f.key === "prescriptions" ? () => setBuilderOpen(true) : undefined
              }
            />
          ))}
          <DiagnosisCard
            note={note}
            disabled={isFinalized}
            onChange={(code, name) =>
              applyPatch({ diagnosisCode: code, diagnosisName: name })
            }
          />
        </div>
      )}

      <DosageBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        onAdd={handleAddPrescription}
      />
    </section>
  );
}

function ChipFieldCard({
  def,
  value,
  presets,
  disabled,
  onChange,
  onPresetClick,
  onRemoveChip,
  onOpenBuilder,
}: {
  def: FieldDef;
  value: string[];
  presets: DoctorPresetRow[];
  disabled: boolean;
  onChange: (next: string[]) => void;
  onPresetClick: (preset: DoctorPresetRow) => void;
  onRemoveChip: (chip: string) => void;
  /**
   * When provided, renders a "Конструктор" button next to the "+" — used by
   * the prescriptions field to open the structured dosage builder modal.
   */
  onOpenBuilder?: () => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      setDraft("");
      return;
    }
    if (!value.includes(v)) {
      onChange([...value, v]);
    }
    setDraft("");
    setAdding(false);
  };

  const Icon = def.Icon;
  // Hide preset chips that are already in the value list — keeps the row
  // shorter and avoids the "click does nothing" feel.
  const availablePresets = presets.filter((p) => !value.includes(p.fieldValue));

  return (
    <div className="rounded-xl border border-border bg-background px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex size-5 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-3" />
          </span>
          <span className="text-xs font-semibold text-foreground">{def.label}</span>
          {value.length > 0 && (
            <span className="rounded-md bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {value.length}
            </span>
          )}
        </div>
        <div className="inline-flex items-center gap-1">
          {onOpenBuilder && (
            <button
              type="button"
              disabled={disabled}
              onClick={onOpenBuilder}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              <SlidersHorizontalIcon className="size-3" />
              Конструктор
            </button>
          )}
          <button
            type="button"
            aria-label="Добавить"
            disabled={disabled || adding}
            onClick={() => setAdding(true)}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {!disabled && availablePresets.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {availablePresets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPresetClick(p)}
              title={
                p.noteTemplate
                  ? `Добавить + дописать в заключение`
                  : "Добавить в поле"
              }
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              {p.noteTemplate && (
                <WandSparklesIcon className="size-2.5 text-primary/70" />
              )}
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap gap-1">
        {value.map((chip) => (
          <Chip
            key={chip}
            label={chip}
            onRemove={disabled ? undefined : () => onRemoveChip(chip)}
          />
        ))}
        {adding ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            placeholder={def.placeholder}
            className="inline-flex h-6 min-w-[160px] items-center rounded-md border border-primary/40 bg-background px-2 text-[11px] text-foreground outline-none focus:ring-2 focus:ring-primary/20"
          />
        ) : (
          !disabled &&
          value.length === 0 &&
          availablePresets.length === 0 && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PlusIcon className="size-3" />
              Добавить
            </button>
          )
        )}
      </div>
    </div>
  );
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-0.5 rounded-md border border-primary/20 bg-primary/10 px-1.5 text-[11px] font-medium text-primary",
      )}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          aria-label="Удалить"
          onClick={onRemove}
          className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded-sm text-primary/60 transition-colors hover:bg-primary/15 hover:text-primary"
        >
          <XIcon className="size-2.5" />
        </button>
      )}
    </span>
  );
}

function DiagnosisCard({
  note,
  disabled,
  onChange,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onChange: (code: string | null, name: string | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const hits = useIcd10Search(query);

  const rows = hits.data ?? [];

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileTextIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">Диагноз</span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            disabled={disabled}
            placeholder="Поиск по МКБ-10 (код или название)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
          {focused && rows.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
              {rows.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(r.code, r.nameRu);
                      setQuery("");
                      setFocused(false);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span className="font-mono font-semibold text-primary">
                      {r.code}
                    </span>
                    <span className="text-foreground">{r.nameRu}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {note.diagnosisCode && note.diagnosisName && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-sm">
            <span className="font-mono font-semibold text-primary">
              {note.diagnosisCode}
            </span>
            <span className="text-foreground">{note.diagnosisName}</span>
            {!disabled && (
              <button
                type="button"
                aria-label="Сбросить диагноз"
                onClick={() => onChange(null, null)}
                className="ml-auto inline-flex size-5 items-center justify-center rounded-full text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

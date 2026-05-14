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
  StethoscopeIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { useReceptionContext } from "../_hooks/reception-context";
import { useIcd10Search } from "../_hooks/use-icd10";
import {
  usePatchVisitNote,
  useVisitNote,
  type VisitNotePatch,
  type VisitNoteRow,
} from "../_hooks/use-visit-note";

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
};

const FIELDS: FieldDef[] = [
  {
    key: "complaints",
    label: "Жалобы",
    Icon: ClipboardListIcon,
    placeholder: "Например: головная боль",
  },
  {
    key: "anamnesis",
    label: "Анамнез",
    Icon: ScrollTextIcon,
    placeholder: "Например: стресс, нарушение сна",
  },
  {
    key: "examination",
    label: "Осмотр",
    Icon: StethoscopeIcon,
    placeholder: "Например: сознание ясное",
  },
  {
    key: "prescriptions",
    label: "Назначения",
    Icon: PillIcon,
    placeholder: "Например: Мексидол 125 мг",
  },
  {
    key: "advice",
    label: "Рекомендации",
    Icon: WandSparklesIcon,
    placeholder: "Например: режим сна",
  },
];

export function StructuredFieldsPanel() {
  const { visitNoteId } = useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";

  const applyPatch = React.useCallback(
    (p: VisitNotePatch) => {
      if (!note || isFinalized) return;
      patch.mutate(p);
    },
    [note, isFinalized, patch],
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
        <div className="flex flex-col gap-3">
          {FIELDS.map((f) => (
            <ChipFieldCard
              key={f.key}
              def={f}
              value={note[f.key] ?? []}
              disabled={isFinalized}
              onChange={(next) => applyPatch({ [f.key]: next } as VisitNotePatch)}
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
    </section>
  );
}

function ChipFieldCard({
  def,
  value,
  disabled,
  onChange,
}: {
  def: FieldDef;
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
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

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">{def.label}</span>
        </div>
        <button
          type="button"
          aria-label="Добавить"
          disabled={disabled || adding}
          onClick={() => setAdding(true)}
          className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {value.map((chip) => (
          <Chip
            key={chip}
            label={chip}
            onRemove={
              disabled
                ? undefined
                : () => onChange(value.filter((c) => c !== chip))
            }
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
            className="inline-flex h-7 min-w-[160px] items-center rounded-full border border-primary/40 bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/20"
          />
        ) : (
          !disabled && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
        "inline-flex h-7 items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 text-xs font-medium text-primary",
      )}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          aria-label="Удалить"
          onClick={onRemove}
          className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <XIcon className="size-3" />
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

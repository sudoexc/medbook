"use client";

/**
 * «Мой арсенал» — the doctor's constant set, managed with the mouse (owner
 * request 03.10.2026: «чтобы им максимально было удобно работать с их
 * постоянным арсеналом, мышкой, с кайфом»).
 *
 * Two tabs, «Препараты» and «Диагнозы». Left, his arsenal in the order «Мои»
 * shows it on the visit screen: drag a row by its handle to move it, the
 * bin removes it, and a drug's «Схема» opens his usual schema in place with
 * big controls (form and strength, dose, times of day, meal, days, how to
 * take). Right, where to add from: his own top 30 not pinned yet (one click
 * «В арсенал»), the clinic's core list, the catalog search, and the
 * catalog walked by clicks (ATC groups, ICD-10 chapters and blocks).
 *
 * The same editor serves the doctor on /doctor/arsenal and the clinic's
 * ADMIN on the CRM doctor page (`doctorId`), who prepares it for him.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  Loader2Icon,
  PillIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  StethoscopeIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  EMPTY_DRUG_SCHEMA,
  FREQUENT_LIMITS,
  isEmptyDrugSchema,
  parseDrugArsenalSchema,
  type ArsenalKind,
  type DrugArsenalSchema,
  type FrequentLimit,
} from "@/lib/arsenal";
import { normalizeForms, type DrugFormOption } from "@/lib/catalogs/drug-forms";
import {
  formatPrescriptionSchedule,
  type PrescriptionLocale,
  type PrescriptionMealRelation,
  type PrescriptionTimeOfDay,
} from "@/lib/catalogs/prescription-format";
import { quickDoseOptions } from "@/lib/catalogs/quick-doses";
import { atcGroupLabel, atcSubgroupLabel } from "@/lib/catalogs/atc-groups";
import { ICD10_CHAPTERS } from "@/lib/icd10-chapters";
import { useFormLabel } from "@/app/[locale]/doctor/_components/drug-detail";
import { useDrugFacets } from "@/app/[locale]/doctor/references/_hooks/use-drug-catalog";
import {
  atcSubgroups,
  catalogRootGroups,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-columns";
import { groupNodeRows } from "@/app/[locale]/doctor/reception/_hooks/diagnosis-columns";
import { useAtcDrugs } from "@/app/[locale]/doctor/reception/_hooks/use-atc-drugs";
import { useIcd10Node } from "@/app/[locale]/doctor/reception/_hooks/use-icd10-tree";
import { useDrugSearch, type DrugSearchHit } from "@/app/[locale]/doctor/reception/_hooks/use-drug-search";
import { useIcd10Search } from "@/app/[locale]/doctor/reception/_hooks/use-icd10";
import type {
  DiagnosisShortItem,
  DrugShortItem,
} from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";

import {
  useArsenal,
  useArsenalMutations,
  type ArsenalDiagnosisPin,
  type ArsenalDrugPin,
} from "./use-arsenal";

const TIMES: PrescriptionTimeOfDay[] = ["MORNING", "NOON", "EVENING", "NIGHT"];
const MEALS: PrescriptionMealRelation[] = [
  "BEFORE_MEAL",
  "WITH_MEAL",
  "AFTER_MEAL",
  "EMPTY_STOMACH",
  "NO_MATTER",
];
const DAY_PICKS = [5, 7, 10, 14, 30];

export function ArsenalEditor({
  doctorId,
  initialKind = "DRUG",
}: {
  doctorId?: string;
  /** The tab it opens on. */
  initialKind?: ArsenalKind;
}) {
  const t = useTranslations("doctor.arsenal");
  const [kind, setKind] = React.useState<ArsenalKind>(initialKind);
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t("tabs.label")}
        className="grid w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:inline-grid sm:w-auto sm:self-start"
      >
        {(["DRUG", "ICD10"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-semibold transition-colors",
              kind === k
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k === "DRUG" ? (
              <PillIcon className="size-4" />
            ) : (
              <StethoscopeIcon className="size-4" />
            )}
            {k === "DRUG" ? t("tabs.drugs") : t("tabs.diagnoses")}
          </button>
        ))}
      </div>
      {kind === "DRUG" ? (
        <DrugArsenalPanel doctorId={doctorId} />
      ) : (
        <DiagnosisArsenalPanel doctorId={doctorId} />
      )}
    </div>
  );
}

// ── Panels ──────────────────────────────────────────────────────────────

function PanelState({ error, loading }: { error: { status: number; reason: string | null } | null; loading: boolean }) {
  const t = useTranslations("doctor.arsenal");
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-border bg-card">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const text =
    error?.reason === "doctor_has_no_login" || error?.reason === "doctor_login_elsewhere"
      ? t("noLogin")
      : error?.status === 403
        ? t("forbidden")
        : t("loadFailed");
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center text-[15px] text-muted-foreground">
      {text}
    </div>
  );
}

function DrugArsenalPanel({ doctorId }: { doctorId?: string }) {
  const t = useTranslations("doctor.arsenal");
  const rawLocale = useLocale();
  const locale: PrescriptionLocale = rawLocale === "uz" ? "uz" : "ru";
  const q = useArsenal("DRUG", doctorId);
  const m = useArsenalMutations("DRUG", doctorId);
  const [open, setOpen] = React.useState<string | null>(null);

  if (!q.data) return <PanelState loading={q.isLoading} error={q.error ?? null} />;
  const data = q.data;
  const full = data.items.length >= data.max;
  const pinned = new Set(data.items.map((i) => i.code));

  const addItem = (code: string, item: unknown) => {
    if (full || pinned.has(code)) return;
    m.add.mutate({ code, item });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <ArsenalCard
        title={t("mine.title")}
        count={data.items.length}
        max={data.max}
        hint={t("mine.hintDrugs")}
        limit={data.frequentLimit}
        onLimit={(n) => m.setLimit.mutate(n)}
      >
        {data.items.length === 0 ? (
          <EmptyNote>{t("mine.emptyDrugs")}</EmptyNote>
        ) : (
          <SortableList
            codes={data.items.map((i) => i.code)}
            onReorder={(codes) => m.reorder.mutate({ codes })}
            renderRow={(code, index, handle) => {
              const pin = data.items.find((i) => i.code === code)!;
              return (
                <DrugPinRow
                  pin={pin}
                  index={index}
                  handle={handle}
                  locale={locale}
                  open={open === code}
                  onToggle={() => setOpen((cur) => (cur === code ? null : code))}
                  onRemove={() => {
                    if (open === code) setOpen(null);
                    m.remove.mutate({ code });
                  }}
                  onSave={(schema) => {
                    m.setSchema.mutate({ code, schema });
                    setOpen(null);
                  }}
                />
              );
            }}
          />
        )}
      </ArsenalCard>

      <AddCard full={full} max={data.max}>
        <DrugSearchSource
          pinned={pinned}
          full={full}
          onAdd={(hit) => addItem(hit.id, drugItemFromHit(hit))}
        />
        <SourceSection title={t("add.yourTop")} empty={t("add.yourTopEmptyDrugs")}>
          {data.top.map((item) => (
            <SourceRow
              key={`t-${item.key}`}
              title={item.label}
              sub={drugSub(item, locale)}
              count={item.count}
              countTitle={t("countDrugs", { n: item.count })}
              disabled={full}
              onAdd={() => item.drugId && addItem(item.drugId, item)}
            />
          ))}
        </SourceSection>
        {data.core.length > 0 ? (
          <SourceSection title={t("add.clinicCore")}>
            {data.core.map((item) => (
              <SourceRow
                key={`c-${item.key}`}
                title={item.label}
                sub={item.strengths.slice(0, 3).join(" / ")}
                disabled={full}
                onAdd={() => item.drugId && addItem(item.drugId, item)}
              />
            ))}
          </SourceSection>
        ) : null}
        <DrugCatalogBrowse
          locale={locale}
          pinned={pinned}
          full={full}
          onAdd={(hit) => addItem(hit.id, drugItemFromHit(hit))}
        />
      </AddCard>
    </div>
  );
}

function DiagnosisArsenalPanel({ doctorId }: { doctorId?: string }) {
  const t = useTranslations("doctor.arsenal");
  const q = useArsenal("ICD10", doctorId);
  const m = useArsenalMutations("ICD10", doctorId);

  if (!q.data) return <PanelState loading={q.isLoading} error={q.error ?? null} />;
  const data = q.data;
  const full = data.items.length >= data.max;
  const pinned = new Set(data.items.map((i) => i.code));

  const addItem = (code: string, item: { code: string; name: string; count?: number }) => {
    const c = code.toUpperCase();
    if (full || pinned.has(c)) return;
    m.add.mutate({ code: c, item });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <ArsenalCard
        title={t("mine.title")}
        count={data.items.length}
        max={data.max}
        hint={t("mine.hintDiagnoses")}
        limit={data.frequentLimit}
        onLimit={(n) => m.setLimit.mutate(n)}
      >
        {data.items.length === 0 ? (
          <EmptyNote>{t("mine.emptyDiagnoses")}</EmptyNote>
        ) : (
          <SortableList
            codes={data.items.map((i) => i.code)}
            onReorder={(codes) => m.reorder.mutate({ codes })}
            renderRow={(code, index, handle) => {
              const pin = data.items.find((i) => i.code === code)!;
              return (
                <DiagnosisPinRow
                  pin={pin}
                  index={index}
                  handle={handle}
                  onRemove={() => m.remove.mutate({ code })}
                />
              );
            }}
          />
        )}
      </ArsenalCard>

      <AddCard full={full} max={data.max}>
        <DiagnosisSearchSource
          pinned={pinned}
          full={full}
          onAdd={(hit) => addItem(hit.code, { code: hit.code, name: hit.nameRu })}
        />
        <SourceSection
          title={data.topSource === "clinic" ? t("add.clinicTop") : t("add.yourTop")}
          empty={t("add.yourTopEmptyDiagnoses")}
        >
          {(data.top as DiagnosisShortItem[]).map((d) =>
            d.code ? (
              <SourceRow
                key={`t-${d.code}`}
                code={d.code}
                title={d.name}
                count={d.count}
                countTitle={
                  data.topSource === "clinic"
                    ? t("countClinicDiagnoses", { n: d.count })
                    : t("countDiagnoses", { n: d.count })
                }
                disabled={full}
                onAdd={() => addItem(d.code!, { code: d.code!, name: d.name, count: d.count })}
              />
            ) : null,
          )}
        </SourceSection>
        <DiagnosisCatalogBrowse
          pinned={pinned}
          full={full}
          onAdd={(row) => addItem(row.code, { code: row.code, name: row.nameRu })}
        />
      </AddCard>
    </div>
  );
}

// ── The arsenal list ────────────────────────────────────────────────────

function ArsenalCard({
  title,
  count,
  max,
  hint,
  limit,
  onLimit,
  children,
}: {
  title: string;
  count: number;
  max: number;
  hint: string;
  limit: FrequentLimit;
  onLimit: (n: FrequentLimit) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("doctor.arsenal");
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <span className="text-sm font-medium tabular-nums text-muted-foreground">
          {t("mine.counter", { n: count, max })}
        </span>
      </div>
      <p className="text-sm leading-snug text-muted-foreground">{hint}</p>
      {children}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-3">
        <span className="text-sm font-medium text-foreground">{t("limit.label")}</span>
        <div
          role="radiogroup"
          aria-label={t("limit.label")}
          className="inline-flex items-center gap-1 rounded-xl bg-muted p-1"
        >
          {FREQUENT_LIMITS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={limit === n}
              onClick={() => n !== limit && onLimit(n)}
              className={cn(
                "inline-flex h-10 min-w-12 items-center justify-center rounded-lg px-3 text-[15px] font-semibold tabular-nums transition-colors",
                limit === n
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

type DragHandle = {
  attributes: React.HTMLAttributes<HTMLElement>;
  listeners: Record<string, unknown> | undefined;
};

/**
 * The arsenal in order, rows dragged by their handle. Pointer and keyboard
 * sensors: the mouse drags, a keyboard user lifts a row with space and
 * moves it with the arrows. The order shown is the dragged one at once;
 * the server's answer (or its refusal) then replaces it.
 */
function SortableList({
  codes,
  onReorder,
  renderRow,
}: {
  codes: string[];
  onReorder: (codes: string[]) => void;
  renderRow: (code: string, index: number, handle: DragHandle) => React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // dnd-kit numbers its aria ids with a module counter, which differs
  // between the server render and the browser: a React id keeps them equal
  // and the page hydrates without a mismatch.
  const dndId = React.useId();
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = codes.indexOf(String(active.id));
    const to = codes.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(codes, from, to));
  };
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={codes} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-1.5">
          {codes.map((code, index) => (
            <SortableItem key={code} id={code}>
              {(handle) => renderRow(code, index, handle)}
            </SortableItem>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn("relative list-none", isDragging && "opacity-90 shadow-lg")}
    >
      {children({ attributes: attributes as React.HTMLAttributes<HTMLElement>, listeners })}
    </li>
  );
}

function GripButton({ handle, label }: { handle: DragHandle; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...handle.attributes}
      {...(handle.listeners as React.HTMLAttributes<HTMLButtonElement>)}
      className="inline-flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
    >
      <GripVerticalIcon className="size-5" />
    </button>
  );
}

function Position({ index }: { index: number }) {
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-[13px] font-semibold tabular-nums text-muted-foreground">
      {index + 1}
    </span>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2Icon className="size-4" />
    </button>
  );
}

function DiagnosisPinRow({
  pin,
  index,
  handle,
  onRemove,
}: {
  pin: ArsenalDiagnosisPin;
  index: number;
  handle: DragHandle;
  onRemove: () => void;
}) {
  const t = useTranslations("doctor.arsenal");
  return (
    <div className="flex min-h-14 items-center gap-2 rounded-xl border border-border bg-background px-1.5 py-1.5">
      <GripButton handle={handle} label={t("mine.drag")} />
      <Position index={index} />
      <div className="min-w-0 flex-1">
        <span className="block font-mono text-sm font-semibold text-primary">{pin.code}</span>
        <span className="block break-words text-[15px] leading-snug text-foreground">
          {pin.name ?? t("mine.unnamed")}
        </span>
      </div>
      <RemoveButton onClick={onRemove} label={t("mine.remove")} />
    </div>
  );
}

function DrugPinRow({
  pin,
  index,
  handle,
  locale,
  open,
  onToggle,
  onRemove,
  onSave,
}: {
  pin: ArsenalDrugPin;
  index: number;
  handle: DragHandle;
  locale: PrescriptionLocale;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onSave: (schema: DrugArsenalSchema | null) => void;
}) {
  const t = useTranslations("doctor.arsenal");
  const formLabel = useFormLabel();
  const entry = pin.entry;
  const summary = pin.schema ? schemaLine(pin.schema, locale, formLabel) : "";
  return (
    <div
      className={cn(
        "rounded-xl border bg-background",
        open ? "border-primary/40" : "border-border",
      )}
    >
      <div className="flex min-h-14 items-center gap-2 px-1.5 py-1.5">
        <GripButton handle={handle} label={t("mine.drag")} />
        <Position index={index} />
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "block break-words text-[15px] font-medium leading-snug",
              entry ? "text-foreground" : "text-muted-foreground line-through",
            )}
          >
            {entry?.label ?? pin.code}
          </span>
          <span className="mt-0.5 block break-words text-[13px] leading-snug text-muted-foreground">
            {!entry
              ? t("mine.unavailable")
              : summary || t("mine.noSchema")}
          </span>
        </div>
        {entry?.drug ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
              open
                ? "border-primary bg-primary text-primary-foreground"
                : summary
                  ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                  : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            <SlidersHorizontalIcon className="size-4" />
            {t("schema.button")}
          </button>
        ) : null}
        <RemoveButton onClick={onRemove} label={t("mine.remove")} />
      </div>
      {open && entry?.drug ? (
        <DrugSchemaEditor
          drugForms={normalizeForms(entry.drug.forms)}
          initial={pin.schema ?? schemaFromUsual(entry)}
          hasSaved={!!pin.schema}
          locale={locale}
          onSave={onSave}
          onCancel={onToggle}
        />
      ) : null}
    </div>
  );
}

/** What he wrote last time, as a starting point for a schema he never set. */
function schemaFromUsual(entry: DrugShortItem): DrugArsenalSchema {
  return (
    parseDrugArsenalSchema({
      form: entry.lastForm,
      strength: entry.lastStrength,
      dose: entry.lastDose,
      timesOfDay: entry.lastTimesOfDay,
      mealRelation: entry.lastMealRelation,
      durationDays: entry.lastDurationDays,
    }) ?? EMPTY_DRUG_SCHEMA
  );
}

/** «Таблетки 10 мг · 1 таб., утром и вечером, после еды, 10 дней». */
function schemaLine(
  schema: DrugArsenalSchema,
  locale: PrescriptionLocale,
  formLabel: (form: string) => string,
): string {
  const head = [schema.form ? formLabel(schema.form) : null, schema.strength]
    .filter(Boolean)
    .join(" ");
  const sched = formatPrescriptionSchedule(
    {
      dose: schema.dose ?? "",
      timesOfDay: schema.timesOfDay,
      mealRelation: schema.mealRelation ?? "NO_MATTER",
      durationDays: schema.durationDays,
    },
    locale,
  );
  const instruction = locale === "uz" ? schema.instructionUz : schema.instructionRu;
  return [head, sched, instruction].filter(Boolean).join(" · ");
}

// ── The schema editor ───────────────────────────────────────────────────

/**
 * His usual schema for one drug, with big controls: every choice is one
 * click on a chip, typing only for a dose or days the chips do not offer
 * and for the instruction. Nothing saves until «Сохранить схему».
 */
function DrugSchemaEditor({
  drugForms,
  initial,
  hasSaved,
  locale,
  onSave,
  onCancel,
}: {
  drugForms: DrugFormOption[];
  initial: DrugArsenalSchema;
  hasSaved: boolean;
  locale: PrescriptionLocale;
  onSave: (schema: DrugArsenalSchema | null) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("doctor.arsenal");
  const tRx = useTranslations("doctor.reception.rx");
  const formLabel = useFormLabel();
  const [s, setS] = React.useState<DrugArsenalSchema>(initial);
  const set = (patch: Partial<DrugArsenalSchema>) => setS((cur) => ({ ...cur, ...patch }));
  // The typed days keep their own text: «14» typed through «1» must not be
  // swallowed by the chip «14» lighting up half way.
  const [daysText, setDaysText] = React.useState(
    initial.durationDays != null && !DAY_PICKS.includes(initial.durationDays)
      ? String(initial.durationDays)
      : "",
  );

  const strengths = drugForms.find((f) => f.form === s.form)?.strengths ?? [];
  const quick = quickDoseOptions(s.form, strengths, locale);
  const instructionKey = locale === "uz" ? "instructionUz" : "instructionRu";
  const cleaned = parseDrugArsenalSchema(s);

  return (
    <div className="flex flex-col gap-4 border-t border-border/70 px-3 py-4 sm:px-4">
      {drugForms.length > 0 ? (
        <Field label={tRx("form")}>
          <div className="flex flex-wrap gap-1.5">
            {drugForms.map((f) => (
              <Chip
                key={f.form}
                active={s.form === f.form}
                onClick={() =>
                  set(
                    s.form === f.form
                      ? { form: null, strength: null }
                      : { form: f.form, strength: f.strengths[0] ?? null },
                  )
                }
              >
                {formLabel(f.form)}
              </Chip>
            ))}
          </div>
          {strengths.length > 1 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {strengths.map((st) => (
                <Chip key={st} active={s.strength === st} onClick={() => set({ strength: st })}>
                  {st}
                </Chip>
              ))}
            </div>
          ) : null}
        </Field>
      ) : null}

      <Field label={tRx("dose")}>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={s.dose ?? ""}
            onChange={(e) => set({ dose: e.target.value || null })}
            placeholder={tRx("dosePlaceholder")}
            maxLength={160}
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[15px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-72"
          />
          {quick.map((d) => (
            <Chip key={d} active={(s.dose ?? "").trim() === d} onClick={() => set({ dose: d })}>
              {d}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={tRx("timesLabel")}>
        <div className="flex flex-wrap gap-1.5">
          {TIMES.map((tm) => (
            <Chip
              key={tm}
              active={s.timesOfDay.includes(tm)}
              onClick={() =>
                set({
                  timesOfDay: s.timesOfDay.includes(tm)
                    ? s.timesOfDay.filter((x) => x !== tm)
                    : TIMES.filter((x) => s.timesOfDay.includes(x) || x === tm),
                })
              }
            >
              {tRx(`times.${tm}`)}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={tRx("mealLabel")}>
        <div className="flex flex-wrap gap-1.5">
          {MEALS.map((meal) => (
            <Chip
              key={meal}
              active={(s.mealRelation ?? "NO_MATTER") === meal}
              onClick={() => set({ mealRelation: meal })}
            >
              {tRx(`meal.${meal}`)}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={tRx("duration")}>
        <div className="flex flex-wrap items-center gap-1.5">
          {DAY_PICKS.map((d) => (
            <Chip
              key={d}
              active={!daysText && s.durationDays === d}
              onClick={() => {
                setDaysText("");
                set({ durationDays: s.durationDays === d && !daysText ? null : d });
              }}
            >
              {d}
            </Chip>
          ))}
          <input
            inputMode="numeric"
            value={daysText}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 3);
              setDaysText(v);
              const n = parseInt(v, 10);
              set({ durationDays: Number.isFinite(n) && n >= 1 && n <= 365 ? n : null });
            }}
            placeholder={t("schema.otherDays")}
            aria-label={tRx("duration")}
            className="h-11 w-24 rounded-lg border border-border bg-background px-3 text-center text-[15px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </Field>

      <Field label={tRx("instruction")}>
        <input
          value={s[instructionKey] ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            set(instructionKey === "instructionUz" ? { instructionUz: v } : { instructionRu: v });
          }}
          placeholder={tRx("instructionPlaceholder")}
          maxLength={500}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[15px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => onSave(cleaned)}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <CheckIcon className="size-4" />
          {t("schema.save")}
        </button>
        {hasSaved ? (
          <button
            type="button"
            onClick={() => onSave(null)}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-[15px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t("schema.clear")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
          {t("schema.cancel")}
        </button>
        <span className="text-sm text-muted-foreground">
          {isEmptyDrugSchema(cleaned) ? t("schema.emptyHint") : t("schema.hint")}
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 items-center rounded-lg border px-3.5 text-[15px] font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

// ── Where to add from ───────────────────────────────────────────────────

function AddCard({
  full,
  max,
  children,
}: {
  full: boolean;
  max: number;
  children: React.ReactNode;
}) {
  const t = useTranslations("doctor.arsenal");
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <h2 className="text-lg font-semibold text-foreground">{t("add.title")}</h2>
      {full ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm font-medium text-warning-text">
          {t("add.full", { max })}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function SourceSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string;
  children: React.ReactNode;
}) {
  const rows = React.Children.toArray(children).filter(Boolean);
  if (rows.length === 0 && !empty) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-1 text-sm font-semibold text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto pr-0.5">{rows}</ul>
      )}
    </div>
  );
}

/** One candidate: the whole row is the «В арсенал» button. */
function SourceRow({
  title,
  sub,
  code,
  count,
  countTitle,
  disabled,
  added,
  onAdd,
}: {
  title: string;
  sub?: string;
  code?: string;
  count?: number;
  countTitle?: string;
  disabled: boolean;
  added?: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations("doctor.arsenal");
  return (
    <li>
      <button
        type="button"
        disabled={disabled || added}
        onClick={(e) => {
          // The row leaves the list on a click: a double click must not
          // add the one that moves up under the cursor.
          if (e.detail > 1) return;
          onAdd();
        }}
        className="group flex min-h-14 w-full items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-background"
      >
        {count && count > 0 ? (
          <span
            title={countTitle}
            className="inline-flex h-6 min-w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 px-1.5 text-[13px] font-semibold tabular-nums text-primary"
          >
            {count}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          {code ? (
            <span className="block font-mono text-sm font-semibold text-primary">{code}</span>
          ) : null}
          <span className="block break-words text-[15px] font-medium leading-snug text-foreground">
            {title}
          </span>
          {sub ? (
            <span className="mt-0.5 block break-words text-[13px] leading-snug text-muted-foreground">
              {sub}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-sm font-semibold",
            added
              ? "text-success"
              : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground",
          )}
        >
          {added ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
          <span className="hidden sm:inline">{added ? t("add.added") : t("add.button")}</span>
        </span>
      </button>
    </li>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const t = useTranslations("doctor.arsenal");
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border border-border bg-background pl-9 pr-11 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("add.searchClear")}
          title={t("add.searchClear")}
          className="absolute right-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function DrugSearchSource({
  pinned,
  full,
  onAdd,
}: {
  pinned: ReadonlySet<string>;
  full: boolean;
  onAdd: (hit: DrugSearchHit) => void;
}) {
  const t = useTranslations("doctor.arsenal");
  const [query, setQuery] = React.useState("");
  return (
    <div className="flex flex-col gap-1.5">
      <SearchBox value={query} onChange={setQuery} placeholder={t("add.searchDrugs")} />
      {query.trim().length >= 2 ? (
        <DrugHits query={query} pinned={pinned} full={full} onAdd={onAdd} />
      ) : null}
    </div>
  );
}

function DrugHits({
  query,
  pinned,
  full,
  onAdd,
}: {
  query: string;
  pinned: ReadonlySet<string>;
  full: boolean;
  onAdd: (hit: DrugSearchHit) => void;
}) {
  const t = useTranslations("doctor.arsenal");
  const search = useDrugSearch(query);
  const hits = search.data ?? [];
  if (search.isLoading) {
    return <Loader2Icon className="mx-auto my-3 size-5 animate-spin text-muted-foreground" />;
  }
  if (search.data !== undefined && hits.length === 0) {
    return <p className="px-1 py-2 text-sm text-muted-foreground">{t("add.searchEmpty")}</p>;
  }
  return (
    <ul className="flex max-h-[22rem] flex-col gap-1 overflow-y-auto">
      {hits.map((hit) => (
        <SourceRow
          key={hit.id}
          title={hit.nameRu}
          sub={normalizeForms(hit.forms)[0]?.strengths.slice(0, 3).join(" / ")}
          disabled={full}
          added={pinned.has(hit.id)}
          onAdd={() => onAdd(hit)}
        />
      ))}
    </ul>
  );
}

function DiagnosisSearchSource({
  pinned,
  full,
  onAdd,
}: {
  pinned: ReadonlySet<string>;
  full: boolean;
  onAdd: (hit: { code: string; nameRu: string }) => void;
}) {
  const t = useTranslations("doctor.arsenal");
  const [query, setQuery] = React.useState("");
  return (
    <div className="flex flex-col gap-1.5">
      <SearchBox value={query} onChange={setQuery} placeholder={t("add.searchDiagnoses")} />
      {query.trim().length >= 2 ? (
        <DiagnosisHits query={query} pinned={pinned} full={full} onAdd={onAdd} />
      ) : null}
    </div>
  );
}

function DiagnosisHits({
  query,
  pinned,
  full,
  onAdd,
}: {
  query: string;
  pinned: ReadonlySet<string>;
  full: boolean;
  onAdd: (hit: { code: string; nameRu: string }) => void;
}) {
  const t = useTranslations("doctor.arsenal");
  const search = useIcd10Search(query);
  // A pin is a code: the clinic's code-less wordings cannot be pinned.
  const hits = (search.data ?? []).filter((h) => !!h.code);
  if (search.isLoading) {
    return <Loader2Icon className="mx-auto my-3 size-5 animate-spin text-muted-foreground" />;
  }
  if (search.data !== undefined && hits.length === 0) {
    return <p className="px-1 py-2 text-sm text-muted-foreground">{t("add.searchEmpty")}</p>;
  }
  return (
    <ul className="flex max-h-[22rem] flex-col gap-1 overflow-y-auto">
      {hits.map((hit) => (
        <SourceRow
          key={`${hit.code}|${hit.nameRu}`}
          code={hit.code}
          title={hit.nameRu}
          disabled={full}
          added={pinned.has(hit.code.toUpperCase())}
          onAdd={() => onAdd(hit)}
        />
      ))}
    </ul>
  );
}

// ── The catalog walked by clicks ────────────────────────────────────────

type DrugPath =
  | { kind: "root" }
  | { kind: "atc"; letter: string }
  | { kind: "sub"; letter: string; code: string };

/** ATC main group → subgroup → drugs, as the visit screen's «Каталог». */
function DrugCatalogBrowse({
  locale,
  pinned,
  full,
  onAdd,
}: {
  locale: PrescriptionLocale;
  pinned: ReadonlySet<string>;
  full: boolean;
  onAdd: (hit: DrugSearchHit) => void;
}) {
  const t = useTranslations("doctor.arsenal");
  const [path, setPath] = React.useState<DrugPath>({ kind: "root" });
  const facets = useDrugFacets();
  const atc = useAtcDrugs(path.kind === "sub" ? path.code : null);
  const groupLabel = (letter: string) => atcGroupLabel(letter, locale) ?? letter;
  const subLabel = (code: string) => atcSubgroupLabel(code, locale) ?? code;

  let back: React.ReactNode = null;
  let body: React.ReactNode;
  if (path.kind === "root") {
    const groups = catalogRootGroups({
      diagnosisCode: null,
      diagnosisCount: 0,
      coreCount: 0,
      byGroup: facets.data?.byGroup,
    });
    body = groups.map((g) =>
      g.kind === "atc" ? (
        <GroupRow
          key={g.code}
          label={groupLabel(g.code)}
          meta={[g.code, g.count != null ? String(g.count) : null].filter(Boolean).join(" · ")}
          onClick={() => setPath({ kind: "atc", letter: g.code })}
        />
      ) : null,
    );
  } else if (path.kind === "atc") {
    back = <BackRow label={groupLabel(path.letter)} onClick={() => setPath({ kind: "root" })} />;
    body = atcSubgroups(path.letter, facets.data?.bySubgroup).map((sg) => (
      <GroupRow
        key={sg.code}
        label={subLabel(sg.code)}
        meta={[sg.code, sg.count != null ? String(sg.count) : null].filter(Boolean).join(" · ")}
        onClick={() => setPath({ kind: "sub", letter: path.letter, code: sg.code })}
      />
    ));
  } else {
    back = (
      <BackRow
        label={subLabel(path.code)}
        onClick={() => setPath({ kind: "atc", letter: path.letter })}
      />
    );
    const drugs = atc.data?.pages.flatMap((p) => p.rows) ?? [];
    body = atc.isLoading ? (
      <Loader2Icon className="mx-auto my-3 size-5 animate-spin text-muted-foreground" />
    ) : (
      <>
        {drugs.map((hit) => (
          <SourceRow
            key={hit.id}
            title={hit.nameRu}
            sub={normalizeForms(hit.forms)[0]?.strengths.slice(0, 3).join(" / ")}
            disabled={full}
            added={pinned.has(hit.id)}
            onAdd={() => onAdd(hit)}
          />
        ))}
        {atc.hasNextPage ? (
          <li>
            <button
              type="button"
              disabled={atc.isFetchingNextPage}
              onClick={() => void atc.fetchNextPage()}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {atc.isFetchingNextPage ? <Loader2Icon className="size-4 animate-spin" /> : null}
              {t("add.more")}
            </button>
          </li>
        ) : null}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-1 text-sm font-semibold text-muted-foreground">{t("add.catalog")}</h3>
      {back}
      <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto pr-0.5">{body}</ul>
    </div>
  );
}

type IcdStep = { range: string; title: string };

/** ICD-10 chapter → block → codes under their category, as the visit screen's. */
function DiagnosisCatalogBrowse({
  pinned,
  full,
  onAdd,
}: {
  pinned: ReadonlySet<string>;
  full: boolean;
  onAdd: (row: { code: string; nameRu: string }) => void;
}) {
  const t = useTranslations("doctor.arsenal");
  const tChapter = useTranslations("doctor.references.icd10.chapters");
  const [trail, setTrail] = React.useState<IcdStep[]>([]);
  const here = trail.at(-1) ?? null;
  const node = useIcd10Node(here?.range ?? null);

  let body: React.ReactNode;
  if (!here) {
    body = ICD10_CHAPTERS.map((c) => (
      <GroupRow
        key={c.id}
        label={tChapter(c.id)}
        meta={c.id}
        onClick={() => setTrail([{ range: c.id, title: tChapter(c.id) }])}
      />
    ));
  } else if (node.isLoading || !node.data) {
    body = <Loader2Icon className="mx-auto my-3 size-5 animate-spin text-muted-foreground" />;
  } else {
    const groups = groupNodeRows(node.data.rows, node.data.headings);
    body = (
      <>
        {node.data.blocks.map((b) => (
          <GroupRow
            key={b.range}
            label={b.nameRu}
            meta={`${b.range} · ${b.count}`}
            onClick={() => setTrail([...trail, { range: b.range, title: b.nameRu }])}
          />
        ))}
        {groups.map((g, i) => (
          <React.Fragment key={g.heading?.code ?? `plain-${i}`}>
            {g.heading ? (
              <li className="px-2 pb-0.5 pt-1.5 text-[13px] font-semibold leading-snug text-muted-foreground">
                <span className="mr-1.5 font-mono">{g.heading.code}</span>
                {g.heading.nameRu}
              </li>
            ) : null}
            {g.rows.map((r) => (
              <SourceRow
                key={r.code}
                code={r.code}
                title={r.nameRu}
                disabled={full}
                added={pinned.has(r.code.toUpperCase())}
                onAdd={() => onAdd(r)}
              />
            ))}
          </React.Fragment>
        ))}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-1 text-sm font-semibold text-muted-foreground">{t("add.catalogIcd")}</h3>
      {here ? <BackRow label={here.title} onClick={() => setTrail(trail.slice(0, -1))} /> : null}
      <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto pr-0.5">{body}</ul>
    </div>
  );
}

function GroupRow({
  label,
  meta,
  onClick,
}: {
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={(e) => {
          // One gesture, one level: the list is replaced under the cursor.
          if (e.detail > 1) return;
          onClick();
        }}
        className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left transition-colors hover:bg-primary/5"
      >
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[15px] font-medium leading-snug text-foreground">
            {label}
          </span>
          {meta ? (
            <span className="block font-mono text-xs tabular-nums text-muted-foreground">{meta}</span>
          ) : null}
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function BackRow({ label, onClick }: { label: string; onClick: () => void }) {
  const t = useTranslations("doctor.arsenal");
  return (
    <button
      type="button"
      onClick={(e) => {
        if (e.detail > 1) return;
        onClick();
      }}
      title={t("add.back")}
      className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-left text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
    >
      <ChevronLeftIcon className="size-4 shrink-0" />
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[15px] leading-snug text-muted-foreground">
      {children}
    </div>
  );
}

/** A catalog hit as the item a pin shows until the list reloads. */
function drugItemFromHit(hit: DrugSearchHit): DrugShortItem {
  return {
    key: hit.id,
    drugId: hit.id,
    label: hit.nameRu,
    count: 0,
    lastDose: null,
    pinned: true,
    strengths: [],
    drug: hit,
  };
}

/** His usual line for a top item, else the drug's strengths. */
function drugSub(item: DrugShortItem, locale: PrescriptionLocale): string {
  if (item.lastDose) {
    return formatPrescriptionSchedule(
      {
        dose: item.lastDose,
        timesOfDay: item.lastTimesOfDay ?? [],
        mealRelation: item.lastMealRelation ?? "NO_MATTER",
        durationDays: item.lastDurationDays ?? null,
      },
      locale,
    );
  }
  return item.drug ? (normalizeForms(item.drug.forms)[0]?.strengths.slice(0, 3).join(" / ") ?? "") : "";
}

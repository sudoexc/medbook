"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BookOpenIcon,
  ClipboardListIcon,
  FileTextIcon,
  FlaskConicalIcon,
  Loader2Icon,
  PillIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchIcon,
  Share2Icon,
  SlidersHorizontalIcon,
  ScrollIcon,
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
  useClinicalProtocols,
  type ClinicalProtocolRow,
} from "../_hooks/use-clinical-protocols";
import {
  usePatchVisitNote,
  useVisitNote,
  type VisitNotePatch,
  type VisitNoteRow,
} from "../_hooks/use-visit-note";
import { ApplyProtocolDialog } from "./apply-protocol-dialog";
import { CatalogDrawer } from "./catalog-drawer";
import { CdsWarningsCard } from "./cds-warnings-card";
import { DosageBuilderDialog } from "./dosage-builder-dialog";
import { EPrescriptionDialog } from "./e-prescription-dialog";
import { LabOrderDialog } from "./lab-order-dialog";
import { ReferralDialog } from "./referral-dialog";
import { SickLeaveDialog } from "./sick-leave-dialog";

type ArrayKey =
  | "complaints"
  | "anamnesis"
  | "examination"
  | "prescriptions"
  | "advice";

type FieldDef = {
  key: ArrayKey;
  labelKey: string;
  Icon: LucideIcon;
  placeholderKey: string;
  presetField: PresetField;
};

const FIELDS: FieldDef[] = [
  {
    key: "complaints",
    labelKey: "fields.complaints.label",
    Icon: ClipboardListIcon,
    placeholderKey: "fields.complaints.placeholder",
    presetField: "COMPLAINTS",
  },
  {
    key: "anamnesis",
    labelKey: "fields.anamnesis.label",
    Icon: ScrollTextIcon,
    placeholderKey: "fields.anamnesis.placeholder",
    presetField: "ANAMNESIS",
  },
  {
    key: "examination",
    labelKey: "fields.examination.label",
    Icon: StethoscopeIcon,
    placeholderKey: "fields.examination.placeholder",
    presetField: "EXAMINATION",
  },
  {
    key: "prescriptions",
    labelKey: "fields.prescriptions.label",
    Icon: PillIcon,
    placeholderKey: "fields.prescriptions.placeholder",
    presetField: "PRESCRIPTIONS",
  },
  {
    key: "advice",
    labelKey: "fields.advice.label",
    Icon: WandSparklesIcon,
    placeholderKey: "fields.advice.placeholder",
    presetField: "ADVICE",
  },
];

export function StructuredFieldsPanel() {
  const t = useTranslations("doctor.reception");
  const {
    visitNoteId,
    requestBodyAppend,
    requestBodyRemove,
    activeAppointment,
  } = useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const presetsQuery = useDoctorPresets();
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [labOrderOpen, setLabOrderOpen] = React.useState(false);
  const [labOrderInitial, setLabOrderInitial] = React.useState<string[]>([]);
  const [rxOpen, setRxOpen] = React.useState(false);
  const [sickLeaveOpen, setSickLeaveOpen] = React.useState(false);
  const [referOpen, setReferOpen] = React.useState(false);
  const [protocolToApply, setProtocolToApply] =
    React.useState<ClinicalProtocolRow | null>(null);

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

  const handleApplyProtocol = React.useCallback(
    (protocol: ClinicalProtocolRow) => {
      if (!note || isFinalized) return;
      const mergeUnique = (existing: string[], incoming: string[]) => {
        const seen = new Set(existing);
        const out = [...existing];
        for (const item of incoming) {
          if (!seen.has(item)) {
            seen.add(item);
            out.push(item);
          }
        }
        return out;
      };
      applyPatch({
        complaints: mergeUnique(note.complaints ?? [], protocol.complaintsTemplate),
        anamnesis: mergeUnique(note.anamnesis ?? [], protocol.anamnesisTemplate),
        examination: mergeUnique(
          note.examination ?? [],
          protocol.examinationTemplate,
        ),
        prescriptions: mergeUnique(
          note.prescriptions ?? [],
          protocol.prescriptionsTemplate,
        ),
        advice: mergeUnique(note.advice ?? [], protocol.adviceTemplate),
      });
      if (protocol.conclusionTemplateMd && protocol.conclusionTemplateMd.trim()) {
        requestBodyAppend(protocol.conclusionTemplateMd);
      }
      // If the protocol recommends labs, open the lab-order dialog with the
      // codes pre-selected. The doctor can still tweak before printing.
      if (protocol.recommendedLabs && protocol.recommendedLabs.length > 0) {
        setLabOrderInitial(protocol.recommendedLabs);
        setLabOrderOpen(true);
      }
      setProtocolToApply(null);
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
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("structured.title")}
        </h2>
        <div className="inline-flex items-center gap-2">
          {patch.isPending && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              {t("editor.saving")}
            </span>
          )}
          {note && !isFinalized && (
            <>
              <button
                type="button"
                onClick={() => {
                  setLabOrderInitial([]);
                  setLabOrderOpen(true);
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                title={t("structured.labOrderTitle")}
              >
                <FlaskConicalIcon className="size-3" />
                {t("structured.labOrder")}
              </button>
              <button
                type="button"
                onClick={() => setRxOpen(true)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                title={t("structured.rxTitle")}
              >
                <PillIcon className="size-3" />
                {t("structured.rx")}
              </button>
              <button
                type="button"
                onClick={() => setSickLeaveOpen(true)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                title={t("structured.sickLeaveTitle")}
              >
                <ScrollIcon className="size-3" />
                {t("structured.sickLeave")}
              </button>
              <button
                type="button"
                onClick={() => setReferOpen(true)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                title={t("structured.referTitle")}
              >
                <Share2Icon className="size-3" />
                {t("structured.refer")}
              </button>
            </>
          )}
        </div>
      </div>

      {!note ? (
        <p className="text-xs text-muted-foreground">
          {t("structured.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {FIELDS.map((f) => (
            <React.Fragment key={f.key}>
              <ChipFieldCard
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
                onOpenCatalog={
                  f.key === "prescriptions" ? () => setCatalogOpen(true) : undefined
                }
              />
              {f.key === "prescriptions" && (
                <CdsWarningsCard
                  patientId={activeAppointment?.patient.id ?? null}
                  prescriptions={note.prescriptions ?? []}
                  diagnosisCode={note.diagnosisCode ?? null}
                  appointmentId={activeAppointment?.id ?? null}
                  visitNoteId={visitNoteId}
                />
              )}
            </React.Fragment>
          ))}
          <DiagnosisCard
            note={note}
            disabled={isFinalized}
            onChange={(code, name) =>
              applyPatch({ diagnosisCode: code, diagnosisName: name })
            }
            onRequestApplyProtocol={(p) => setProtocolToApply(p)}
          />
        </div>
      )}

      <DosageBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        onAdd={handleAddPrescription}
      />

      <CatalogDrawer
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onPick={handleAddPrescription}
      />

      <LabOrderDialog
        open={labOrderOpen}
        onOpenChange={setLabOrderOpen}
        patientId={activeAppointment?.patient.id ?? null}
        appointmentId={activeAppointment?.id ?? null}
        visitNoteId={visitNoteId}
        diagnosisCode={note?.diagnosisCode ?? null}
        initialTestCodes={labOrderInitial}
      />

      <EPrescriptionDialog
        open={rxOpen}
        onOpenChange={setRxOpen}
        patientId={activeAppointment?.patient.id ?? null}
        appointmentId={activeAppointment?.id ?? null}
        visitNoteId={visitNoteId}
        diagnosisCode={note?.diagnosisCode ?? null}
        diagnosisName={note?.diagnosisName ?? null}
        seedItems={note?.prescriptions ?? []}
      />

      <SickLeaveDialog
        open={sickLeaveOpen}
        onOpenChange={setSickLeaveOpen}
        patientId={activeAppointment?.patient.id ?? null}
        appointmentId={activeAppointment?.id ?? null}
        visitNoteId={visitNoteId}
        diagnosisCode={note?.diagnosisCode ?? null}
        diagnosisName={note?.diagnosisName ?? null}
      />

      <ReferralDialog
        open={referOpen}
        onOpenChange={setReferOpen}
        patientId={activeAppointment?.patient.id ?? null}
        visitNoteId={visitNoteId}
        diagnosisCode={note?.diagnosisCode ?? null}
        diagnosisName={note?.diagnosisName ?? null}
      />

      <ApplyProtocolDialog
        open={!!protocolToApply}
        onOpenChange={(next) => {
          if (!next) setProtocolToApply(null);
        }}
        protocol={protocolToApply}
        onApply={handleApplyProtocol}
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
  onOpenCatalog,
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
  /** Opens the searchable drug catalog drawer (Phase G1). */
  onOpenCatalog?: () => void;
}) {
  const t = useTranslations("doctor.reception");
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
          <span className="text-xs font-semibold text-foreground">{t(def.labelKey)}</span>
          {value.length > 0 && (
            <span className="rounded-md bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {value.length}
            </span>
          )}
        </div>
        <div className="inline-flex items-center gap-1">
          {onOpenCatalog && (
            <button
              type="button"
              disabled={disabled}
              onClick={onOpenCatalog}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
              title={t("structured.catalogTitle")}
            >
              <BookOpenIcon className="size-3" />
              {t("structured.catalog")}
            </button>
          )}
          {onOpenBuilder && (
            <button
              type="button"
              disabled={disabled}
              onClick={onOpenBuilder}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              <SlidersHorizontalIcon className="size-3" />
              {t("structured.builder")}
            </button>
          )}
          <button
            type="button"
            aria-label={t("structured.add")}
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
                  ? t("structured.presetTitleWithTemplate")
                  : t("structured.presetTitle")
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
            placeholder={t(def.placeholderKey)}
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
              {t("structured.add")}
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
  const t = useTranslations("doctor.reception");
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
          aria-label={t("structured.remove")}
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
  onRequestApplyProtocol,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onChange: (code: string | null, name: string | null) => void;
  onRequestApplyProtocol: (protocol: ClinicalProtocolRow) => void;
}) {
  const t = useTranslations("doctor.reception");
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const hits = useIcd10Search(query);
  const protocolsQuery = useClinicalProtocols(note.diagnosisCode);
  const protocols = protocolsQuery.data ?? [];

  const rows = hits.data ?? [];

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileTextIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">{t("diagnosis.title")}</span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            disabled={disabled}
            placeholder={t("diagnosis.searchPlaceholder")}
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
          <>
            <div className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-sm">
              <span className="font-mono font-semibold text-primary">
                {note.diagnosisCode}
              </span>
              <span className="text-foreground">{note.diagnosisName}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={t("diagnosis.reset")}
                  onClick={() => onChange(null, null)}
                  className="ml-auto inline-flex size-5 items-center justify-center rounded-full text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
            {!disabled && protocols.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {protocols.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onRequestApplyProtocol(p)}
                    title={p.summaryRu ?? t("diagnosis.applyProtocolTitle")}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <WandSparklesIcon className="size-3" />
                    {t("diagnosis.applyStandard")}
                    <span className="rounded-md bg-primary/15 px-1 font-mono text-[10px]">
                      {p.diagnosisCodePrefix}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

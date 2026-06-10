"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  BookmarkPlusIcon,
  CalendarCheckIcon,
  ClipboardListIcon,
  FileTextIcon,
  FlaskConicalIcon,
  Loader2Icon,
  PillIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchIcon,
  Share2Icon,
  ScrollIcon,
  StethoscopeIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  useDoctorPresets,
  type DoctorPresetRow,
  type PresetField,
} from "../_hooks/use-doctor-presets";
import { useIcd10Search } from "../_hooks/use-icd10";
import {
  protocolItemToDraft,
  useClinicalProtocols,
  type ClinicalProtocolRow,
} from "../_hooks/use-clinical-protocols";
import {
  usePatchVisitNote,
  useVisitNote,
  type VisitNotePatch,
  type VisitNoteRow,
  type VisitPrescriptionDraft,
} from "../_hooks/use-visit-note";
import { ApplyProtocolDialog } from "./apply-protocol-dialog";
import { CatalogDrawer } from "./catalog-drawer";
import { CdsWarningsCard } from "./cds-warnings-card";
import { DiagnosisGuideCard } from "./diagnosis-guide-card";
import { EPrescriptionDialog } from "./e-prescription-dialog";
import {
  draftFromDrug,
  PrescriptionConstructor,
} from "./prescription-constructor";
import { LabOrderDialog } from "./lab-order-dialog";
import { ReferralDialog } from "./referral-dialog";
import { SaveProtocolDialog } from "./save-protocol-dialog";
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
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [labOrderOpen, setLabOrderOpen] = React.useState(false);
  const [labOrderInitial, setLabOrderInitial] = React.useState<string[]>([]);
  const [rxOpen, setRxOpen] = React.useState(false);
  const [sickLeaveOpen, setSickLeaveOpen] = React.useState(false);
  const [referOpen, setReferOpen] = React.useState(false);
  const [protocolToApply, setProtocolToApply] =
    React.useState<ClinicalProtocolRow | null>(null);
  const [saveProtocolOpen, setSaveProtocolOpen] = React.useState(false);

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

  // CDS v2 inputs: catalog-picked rows go by id (authoritative), custom rows
  // and legacy text lines keep the best-effort text match.
  const rxStructured = note?.visitPrescriptions ?? [];
  const cdsDrugIds = React.useMemo(
    () =>
      rxStructured
        .map((r) => r.drugId)
        .filter((id): id is string => !!id),
    [rxStructured],
  );
  const legacyPrescriptions = note?.prescriptions;
  const cdsTextLines = React.useMemo(
    () => [
      ...(legacyPrescriptions ?? []),
      ...rxStructured
        .filter((r) => !r.drugId)
        .map((r) => formatPrescriptionLine(r, "ru")),
    ],
    [legacyPrescriptions, rxStructured],
  );

  // Ф2 — structured rows replace-all save + catalog pick → structured draft.
  const saveRxRows = React.useCallback(
    (rows: VisitPrescriptionDraft[]) => {
      applyPatch({ visitPrescriptions: rows });
    },
    [applyPatch],
  );

  const handleCatalogPick = React.useCallback(
    (drug: Parameters<typeof draftFromDrug>[0]) => {
      if (!note) return;
      const drafts = (note.visitPrescriptions ?? []).map(
        ({ id: _id, sortOrder: _s, ...rest }) => rest,
      );
      applyPatch({ visitPrescriptions: [...drafts, draftFromDrug(drug)] });
    },
    [note, applyPatch],
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
      const patch: VisitNotePatch = {
        complaints: mergeUnique(note.complaints ?? [], protocol.complaintsTemplate),
        anamnesis: mergeUnique(note.anamnesis ?? [], protocol.anamnesisTemplate),
        examination: mergeUnique(
          note.examination ?? [],
          protocol.examinationTemplate,
        ),
        advice: mergeUnique(note.advice ?? [], protocol.adviceTemplate),
      };
      // Ф3 — structured items append to the prescription constructor
      // (dedup by name+dose so a double-apply is a no-op); the legacy
      // free-text lines are the fallback for protocols that predate it.
      const items = (protocol.prescriptionItems ?? []).map(protocolItemToDraft);
      if (items.length > 0) {
        const existing = (note.visitPrescriptions ?? []).map(
          ({ id: _id, sortOrder: _s, ...rest }) => rest,
        );
        const seen = new Set(existing.map((r) => `${r.displayName}|${r.dose}`));
        const fresh = items.filter(
          (r) => !seen.has(`${r.displayName}|${r.dose}`),
        );
        if (fresh.length > 0) {
          patch.visitPrescriptions = [...existing, ...fresh];
        }
      } else {
        patch.prescriptions = mergeUnique(
          note.prescriptions ?? [],
          protocol.prescriptionsTemplate,
        );
      }
      // Ф6 — prefill the control visit from the protocol unless the doctor
      // already set one by hand.
      if (protocol.followUpDays != null && note.followUpDays == null) {
        patch.followUpDays = protocol.followUpDays;
      }
      applyPatch(patch);
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
          {note && (
            <button
              type="button"
              onClick={() => setSaveProtocolOpen(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("structured.saveProtocolTitle")}
            >
              <BookmarkPlusIcon className="size-3" />
              {t("structured.saveProtocol")}
            </button>
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
              {f.key === "prescriptions" ? (
                <PrescriptionConstructor
                  note={note}
                  disabled={isFinalized}
                  presets={presetsByField[f.presetField] ?? []}
                  onSaveRows={saveRxRows}
                  onPresetClick={(preset) => handlePresetClick(f, preset)}
                  onRemoveLegacyChip={(chip) => handleRemoveChip(f, chip)}
                  onOpenCatalog={() => setCatalogOpen(true)}
                />
              ) : (
                <ChipFieldCard
                  def={f}
                  value={note[f.key] ?? []}
                  presets={presetsByField[f.presetField] ?? []}
                  disabled={isFinalized}
                  onChange={(next) =>
                    applyPatch({ [f.key]: next } as VisitNotePatch)
                  }
                  onPresetClick={(preset) => handlePresetClick(f, preset)}
                  onRemoveChip={(chip) => handleRemoveChip(f, chip)}
                />
              )}
              {f.key === "prescriptions" && (
                <CdsWarningsCard
                  patientId={activeAppointment?.patient.id ?? null}
                  prescriptions={cdsTextLines}
                  drugIds={cdsDrugIds}
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
          <DiagnosisGuideCard
            note={note}
            disabled={isFinalized}
            onMergeAdvice={(chips) => {
              const current = note.advice ?? [];
              const next = chips.filter((c) => !current.includes(c));
              if (next.length === 0) return;
              applyPatch({ advice: [...current, ...next] });
            }}
            onSetFollowUpDays={(days) => applyPatch({ followUpDays: days })}
          />
          {(!isFinalized || note.followUpDays != null) && (
            <FollowUpCard
              note={note}
              disabled={isFinalized}
              onChange={applyPatch}
            />
          )}
        </div>
      )}

      <CatalogDrawer
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onPick={handleCatalogPick}
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
        seedItems={[
          ...rxStructured.map((r) => formatPrescriptionLine(r, "ru")),
          ...(note?.prescriptions ?? []),
        ]}
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

      <SaveProtocolDialog
        open={saveProtocolOpen}
        onOpenChange={setSaveProtocolOpen}
        note={note}
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
}: {
  def: FieldDef;
  value: string[];
  presets: DoctorPresetRow[];
  disabled: boolean;
  onChange: (next: string[]) => void;
  onPresetClick: (preset: DoctorPresetRow) => void;
  onRemoveChip: (chip: string) => void;
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

const FOLLOW_UP_PRESETS = [3, 7, 10, 14, 30];

/**
 * Ф6 — «Контрольный визит». Days + note feed VisitNote.followUpDays /
 * followUpNote; after finalize the bridge worker turns them into a
 * VISIT_FOLLOW_UP_DUE action for the reception desk.
 */
function FollowUpCard({
  note,
  disabled,
  onChange,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  onChange: (patch: VisitNotePatch) => void;
}) {
  const t = useTranslations("doctor.reception");
  const fmt = useFormatter();
  const days = note.followUpDays;
  const [noteDraft, setNoteDraft] = React.useState(note.followUpNote ?? "");

  React.useEffect(() => {
    setNoteDraft(note.followUpNote ?? "");
  }, [note.followUpNote]);

  const commitNote = () => {
    const v = noteDraft.trim();
    if (v === (note.followUpNote ?? "")) return;
    onChange({ followUpNote: v || null });
  };

  const due =
    days != null && days > 0
      ? new Date(Date.now() + days * 86_400_000)
      : null;

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CalendarCheckIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">
            {t("followUp.title")}
          </span>
        </div>
        {due && (
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {t("followUp.dueOn", {
              date: fmt.dateTime(due, { day: "numeric", month: "long" }),
            })}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {FOLLOW_UP_PRESETS.map((d) => {
          const active = days === d;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ followUpDays: active ? null : d })}
              className={cn(
                "inline-flex h-6 items-center rounded-md border px-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
              )}
            >
              {t("followUp.daysShort", { days: d })}
            </button>
          );
        })}
        {days != null && !FOLLOW_UP_PRESETS.includes(days) && (
          <span className="inline-flex h-6 items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
            {t("followUp.daysShort", { days })}
          </span>
        )}
        {days != null && !disabled && (
          <button
            type="button"
            aria-label={t("followUp.clear")}
            onClick={() => onChange({ followUpDays: null, followUpNote: null })}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>

      {days != null && (
        <input
          type="text"
          disabled={disabled}
          value={noteDraft}
          maxLength={500}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNote();
            }
          }}
          placeholder={t("followUp.notePlaceholder")}
          className="mt-2 h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
        />
      )}
    </div>
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

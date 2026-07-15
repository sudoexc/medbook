"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  CalendarCheckIcon,
  FileTextIcon,
  HeartPulseIcon,
  Loader2Icon,
  SearchIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { useAddChronicCondition } from "../_hooks/use-patient-history";
import { ApplyProtocolDialog } from "./apply-protocol-dialog";
import { CatalogDrawer } from "./catalog-drawer";
import { CdsWarningsCard } from "./cds-warnings-card";
import {
  draftFromDrug,
  PrescriptionConstructor,
} from "./prescription-constructor";

type FieldDef = {
  key: "prescriptions";
  presetField: PresetField;
};

const RX_FIELD: FieldDef = {
  key: "prescriptions",
  presetField: "PRESCRIPTIONS",
};

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
      const patch: VisitNotePatch = {};
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
      if (Object.keys(patch).length > 0) {
        applyPatch(patch);
      }
      if (protocol.conclusionTemplateMd && protocol.conclusionTemplateMd.trim()) {
        requestBodyAppend(protocol.conclusionTemplateMd);
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
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold text-foreground">
          {t("structured.title")}
        </h2>
        {patch.isPending && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            {t("editor.saving")}
          </span>
        )}
      </div>

      {!note ? (
        <p className="text-xs text-muted-foreground">
          {t("structured.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <PrescriptionConstructor
            note={note}
            disabled={isFinalized}
            presets={presetsByField[RX_FIELD.presetField] ?? []}
            onSaveRows={saveRxRows}
            onPresetClick={(preset) => handlePresetClick(RX_FIELD, preset)}
            onRemoveLegacyChip={(chip) => handleRemoveChip(RX_FIELD, chip)}
            onOpenCatalog={() => setCatalogOpen(true)}
          />
          <CdsWarningsCard
            patientId={activeAppointment?.patient.id ?? null}
            prescriptions={cdsTextLines}
            drugIds={cdsDrugIds}
            diagnosisCode={note.diagnosisCode ?? null}
            appointmentId={activeAppointment?.id ?? null}
            visitNoteId={visitNoteId}
          />
          <DiagnosisCard
            note={note}
            disabled={isFinalized}
            onChange={(code, name) =>
              applyPatch({ diagnosisCode: code, diagnosisName: name })
            }
            onRequestApplyProtocol={(p) => setProtocolToApply(p)}
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
  // Ф7 — «в хронические»: один клик копирует диагноз в карточку пациента.
  const chronic = useAddChronicCondition(note.patientId);
  const [chronicSaved, setChronicSaved] = React.useState(false);
  React.useEffect(() => {
    setChronicSaved(false);
  }, [note.diagnosisCode]);

  const handleToChronic = () => {
    const name = note.diagnosisName ?? note.diagnosisCode;
    if (!name) return;
    chronic.mutate(
      {
        name,
        notes: note.diagnosisCode ? `МКБ-10: ${note.diagnosisCode}` : null,
      },
      {
        onSuccess: () => {
          setChronicSaved(true);
          toast.success(t("diagnosis.toChronicDone"));
        },
        onError: () => toast.error(t("diagnosis.toChronicError")),
      },
    );
  };

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
            {!disabled && (
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
                <button
                  type="button"
                  disabled={chronic.isPending || chronicSaved}
                  onClick={handleToChronic}
                  title={t("diagnosis.toChronicTitle")}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-60"
                >
                  {chronic.isPending ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <HeartPulseIcon className="size-3" />
                  )}
                  {chronicSaved
                    ? t("diagnosis.toChronicDone")
                    : t("diagnosis.toChronic")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

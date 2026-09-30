"use client";

/**
 * The structured half of the visit screen, as two panels in two columns
 * (clinic request 29.09.2026, «хаммаси бирлашиб ковоти»):
 *
 *   - DiagnosisFollowUpPanel: «Диагноз» and «Контрольный визит», alone in the
 *     left column so up to four diagnoses have room;
 *   - PrescriptionsPanel: «Назначения» with its interaction check, a card of
 *     its own under the conclusion editor in the middle column, wide enough
 *     for a whole prescription line.
 *
 * They used to be one left-column stack, where a drug row was cut to
 * «Грандаксин 50 мг — по…». Both panels save through the same loud-patch
 * hook, so the failure behaviour cannot drift between them.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";
import { visitDiagnosesOf } from "@/lib/visit-diagnoses";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  useDoctorPresets,
  type DoctorPresetRow,
  type PresetField,
} from "../_hooks/use-doctor-presets";
import {
  protocolItemToDraft,
  type ClinicalProtocolRow,
} from "../_hooks/use-clinical-protocols";
import type {
  VisitNotePatch,
  VisitPrescriptionDraft,
} from "../_hooks/use-visit-note";
import { useLoudVisitNotePatch } from "../_hooks/use-loud-patch";
import { useQueryClient } from "@tanstack/react-query";
import { visitNoteKey, type VisitNoteRow } from "../_hooks/use-visit-note";
import { toPrescriptionDrafts } from "../_hooks/prescription-rows";
import { hasDiagnosis, withDiagnosisPicked } from "../_hooks/diagnosis-list";
// Diagnosis + follow-up cards are shared with the conclusions screen (the
// 24h in-window correction flow) — see ../../_components.
import {
  DiagnosisCard,
  FollowUpCard,
} from "../../_components/diagnosis-follow-up-cards";
import { ApplyProtocolDialog } from "./apply-protocol-dialog";
import { CatalogDrawer } from "./catalog-drawer";
import { IcdCatalogDrawer } from "./icd-catalog-drawer";
import { CdsWarningsCard } from "./cds-warnings-card";
import { ParsedFromTextCard } from "./parsed-from-text-card";
import {
  PrescriptionConstructor,
  type CatalogPickDrug,
} from "./prescription-constructor";

type FieldDef = {
  key: "prescriptions";
  presetField: PresetField;
};

const RX_FIELD: FieldDef = {
  key: "prescriptions",
  presetField: "PRESCRIPTIONS",
};

/** A drug a doctor quick-added to the clinic's base: a name, no substance. */
function isBareClinicDrug(id: string | null | undefined): boolean {
  return !!id && id.startsWith("clinic-");
}

/**
 * The note as the doctor last left it. Every replace-all payload built here
 * starts from this, not from the render snapshot: the cache already holds
 * edits whose PATCH is still in flight (usePatchVisitNote writes them in at
 * once), the snapshot does not, and a payload built on it would erase them
 * (audit VW-01).
 */
function useLiveNote(note: VisitNoteRow | null) {
  const qc = useQueryClient();
  return React.useCallback(
    (): VisitNoteRow | null =>
      note ? (qc.getQueryData<VisitNoteRow>(visitNoteKey(note.id)) ?? note) : null,
    [note, qc],
  );
}

/** Left column: «Диагноз» (one to four) and «Контрольный визит». */
export function DiagnosisFollowUpPanel() {
  const t = useTranslations("doctor.reception");
  const { visitNoteId, requestBodyAppend } = useReceptionContext();
  // Every card saves through the shared loud-patch hook — see
  // use-loud-patch.ts for the conflict/rollback contract.
  const { note, isFinalized, applyPatch, patch } =
    useLoudVisitNotePatch(visitNoteId);
  const liveNote = useLiveNote(note);
  const [icdCatalogOpen, setIcdCatalogOpen] = React.useState(false);
  const [protocolToApply, setProtocolToApply] =
    React.useState<ClinicalProtocolRow | null>(null);

  // A protocol comes from the main diagnosis but fills the other columns
  // too (prescriptions, advice, control visit, conclusion template), so it
  // is applied here, where it is asked for.
  const handleApplyProtocol = React.useCallback(
    (protocol: ClinicalProtocolRow) => {
      const live = liveNote();
      if (!live || isFinalized) return;
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
        const existing = toPrescriptionDrafts(live.visitPrescriptions ?? []);
        const seen = new Set(existing.map((r) => `${r.displayName}|${r.dose}`));
        const fresh = items.filter(
          (r) => !seen.has(`${r.displayName}|${r.dose}`),
        );
        if (fresh.length > 0) {
          patch.visitPrescriptions = [...existing, ...fresh];
        }
      } else {
        patch.prescriptions = mergeUnique(
          live.prescriptions ?? [],
          protocol.prescriptionsTemplate,
        );
      }
      // The apply-dialog previews the protocol's advice lines and the
      // «Рекомендации» column sits on the same screen — leaving them
      // unapplied read as a bug (review finding). Same merge semantics as
      // prescriptions: dedup, never clobber what the doctor already wrote.
      if ((protocol.adviceTemplate?.length ?? 0) > 0) {
        const mergedAdvice = mergeUnique(
          live.advice ?? [],
          protocol.adviceTemplate,
        );
        if (mergedAdvice.length !== (live.advice ?? []).length) {
          patch.advice = mergedAdvice;
        }
      }
      // Ф6 — prefill the control visit from the protocol unless the doctor
      // already set one by hand (a count of days or an exact day).
      if (
        protocol.followUpDays != null &&
        live.followUpDays == null &&
        live.followUpDate == null
      ) {
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
    [liveNote, isFinalized, applyPatch, requestBodyAppend],
  );

  return (
    <div className="flex flex-col gap-4">
      {!note ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">
            {t("structured.title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("structured.empty")}
          </p>
        </section>
      ) : (
        <>
          <DiagnosisCard
            note={note}
            disabled={isFinalized}
            standalone
            saving={patch.isPending}
            onChange={applyPatch}
            onRequestApplyProtocol={(p) => setProtocolToApply(p)}
            onOpenCatalog={() => setIcdCatalogOpen(true)}
          />
          {(!isFinalized ||
            note.followUpDays != null ||
            note.followUpDate != null) && (
            <FollowUpCard
              note={note}
              disabled={isFinalized}
              standalone
              onChange={applyPatch}
            />
          )}
        </>
      )}

      <IcdCatalogDrawer
        open={icdCatalogOpen}
        onOpenChange={setIcdCatalogOpen}
        onPick={(code, name) => {
          // Same rule as a pick in the card's search: the main diagnosis
          // while the visit has none, one more after that.
          const live = liveNote();
          const next = live ? withDiagnosisPicked(live, { code, name }) : null;
          if (next) applyPatch(next);
          else if (live && hasDiagnosis(live, { code, name })) {
            toast.info(t("diagnosis.alreadyAdded"));
          }
          setIcdCatalogOpen(false);
        }}
      />

      <ApplyProtocolDialog
        open={!!protocolToApply}
        onOpenChange={(next) => {
          if (!next) setProtocolToApply(null);
        }}
        protocol={protocolToApply}
        onApply={handleApplyProtocol}
        followUpSet={
          note != null && (note.followUpDays != null || note.followUpDate != null)
        }
      />
    </div>
  );
}

/**
 * Middle column, under the conclusion: «Назначения» as its own card, with
 * the interaction check and «Записать аллергию» inside it, and the lines
 * recognised in the conclusion text offered right below.
 */
export function PrescriptionsPanel() {
  const { visitNoteId, requestBodyAppend, requestBodyRemove, activeAppointment } =
    useReceptionContext();
  // Prescription rows are replace-all: see use-loud-patch.ts for the
  // conflict/rollback contract every column shares.
  const { note, isFinalized, applyPatch, patch } =
    useLoudVisitNotePatch(visitNoteId);
  const qc = useQueryClient();
  const liveNote = useLiveNote(note);
  const presetsQuery = useDoctorPresets();
  const [catalogOpen, setCatalogOpen] = React.useState(false);

  const presetsByField = React.useMemo(() => {
    const map: Partial<Record<PresetField, DoctorPresetRow[]>> = {};
    for (const p of presetsQuery.data ?? []) {
      (map[p.field] ??= []).push(p);
    }
    return map;
  }, [presetsQuery.data]);

  // CDS v2 inputs: catalog-picked rows go by id (authoritative), custom rows
  // and legacy text lines keep the best-effort text match. A drug a doctor
  // added to the clinic's base («clinic-…») has no substance or ATC on its
  // row, so it is checked by its name like a custom line — by id it would
  // count as «resolved» and pass every allergy/interaction check blind.
  // Each row keeps its label: «Ибупрофен» and «Нурофен (ибупрофен)» are one
  // id twice, and only the names show the doctor wrote a double dose.
  const rxStructured = note?.visitPrescriptions ?? [];
  const cdsDrugRows = React.useMemo(
    () =>
      rxStructured.flatMap((r) =>
        r.drugId && !isBareClinicDrug(r.drugId)
          ? [{ id: r.drugId, displayName: r.displayName }]
          : [],
      ),
    [rxStructured],
  );
  const legacyPrescriptions = note?.prescriptions;
  const cdsTextLines = React.useMemo(
    () => [
      ...(legacyPrescriptions ?? []),
      ...rxStructured
        .filter((r) => !r.drugId || isBareClinicDrug(r.drugId))
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

  // A drawer pick goes through the constructor, like a search pick: a drug
  // whose dose the catalog cannot give asks for it before it is saved
  // (audit G4-07).
  const catalogPickRef = React.useRef<
    ((drug: CatalogPickDrug, term: string) => void) | null
  >(null);
  const handleCatalogPick = React.useCallback(
    (drug: CatalogPickDrug, term: string) => {
      catalogPickRef.current?.(drug, term);
    },
    [],
  );

  /**
   * Legacy chip arrays are saved replace-all, so building the payload from
   * the render snapshot loses the first of two quick clicks. Read the
   * CURRENT cache row and fold the result back synchronously — same guard
   * the advice column and the parsed-prescription adopt path use.
   */
  const mutateChips = React.useCallback(
    (key: FieldDef["key"], updater: (cur: string[]) => string[]): boolean => {
      if (!note || isFinalized) return false;
      const cacheKey = visitNoteKey(note.id);
      const cur = qc.getQueryData<VisitNoteRow>(cacheKey)?.[key] ?? note[key] ?? [];
      const next = updater(cur);
      if (next.length === cur.length && next.every((v, i) => v === cur[i])) {
        return false;
      }
      qc.setQueryData<VisitNoteRow>(cacheKey, (prev) =>
        prev ? { ...prev, [key]: next } : prev,
      );
      applyPatch({ [key]: next } as VisitNotePatch);
      return true;
    },
    [note, isFinalized, qc, applyPatch],
  );

  const handlePresetClick = React.useCallback(
    (def: FieldDef, preset: DoctorPresetRow) => {
      const added = mutateChips(def.key, (cur) =>
        cur.includes(preset.fieldValue) ? cur : [...cur, preset.fieldValue],
      );
      // Template only when the chip actually landed, otherwise a dedupe
      // no-op orphans the template text in the conclusion editor.
      if (added && preset.noteTemplate && preset.noteTemplate.trim()) {
        requestBodyAppend(preset.noteTemplate);
      }
    },
    [mutateChips, requestBodyAppend],
  );

  const handleRemoveChip = React.useCallback(
    (def: FieldDef, chip: string) => {
      if (!mutateChips(def.key, (cur) => cur.filter((c) => c !== chip))) return;
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
    [mutateChips, presetsByField, requestBodyRemove],
  );

  // No visit yet: the editor above already says so, a second empty card
  // would only repeat it.
  if (!note) return null;

  return (
    <div className="flex flex-col gap-4">
      <PrescriptionConstructor
        note={note}
        disabled={isFinalized}
        standalone
        saving={patch.isPending}
        presets={presetsByField[RX_FIELD.presetField] ?? []}
        onSaveRows={saveRxRows}
        onPresetClick={(preset) => handlePresetClick(RX_FIELD, preset)}
        onAddLegacyLine={(line) => {
          mutateChips(RX_FIELD.key, (cur) =>
            cur.includes(line) ? cur : [...cur, line],
          );
        }}
        onRemoveLegacyChip={(chip) => handleRemoveChip(RX_FIELD, chip)}
        onOpenCatalog={() => setCatalogOpen(true)}
        catalogPickRef={catalogPickRef}
        footer={
          // The check reads every diagnosis of the visit, not only the main
          // one: a comorbidity is where a contraindication usually hides.
          <CdsWarningsCard
            patientId={activeAppointment?.patient.id ?? null}
            prescriptions={cdsTextLines}
            drugRows={cdsDrugRows}
            diagnosisCode={note.diagnosisCode ?? null}
            diagnoses={visitDiagnosesOf(note)}
            appointmentId={activeAppointment?.id ?? null}
            visitNoteId={visitNoteId}
          />
        }
      />
      <ParsedFromTextCard
        key={note.id}
        note={note}
        disabled={isFinalized}
        onAdopt={(drafts) => {
          // Same lost-update guard as every other replace-all save:
          // compose on the live cache row (the patch hook folds the
          // result back in at once), so two quick «+» clicks both land.
          const live = liveNote() ?? note;
          applyPatch({
            visitPrescriptions: [
              ...toPrescriptionDrafts(live.visitPrescriptions ?? []),
              ...drafts,
            ],
          });
        }}
      />

      <CatalogDrawer
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onPick={handleCatalogPick}
      />
    </div>
  );
}

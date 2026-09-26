"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";

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
import {
  draftFromDrug,
  toPrescriptionDrafts,
} from "../_hooks/prescription-rows";
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
import { PrescriptionConstructor } from "./prescription-constructor";

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

export function StructuredFieldsPanel() {
  const t = useTranslations("doctor.reception");
  const {
    visitNoteId,
    requestBodyAppend,
    requestBodyRemove,
    activeAppointment,
  } = useReceptionContext();
  // Every card in this panel saves through the shared loud-patch hook:
  // diagnosis, prescription rows (replace-all!), follow-up. See
  // use-loud-patch.ts for the conflict/rollback contract — the advice
  // column uses the same hook, so behaviour cannot drift between columns.
  const { note, isFinalized, applyPatch, patch } =
    useLoudVisitNotePatch(visitNoteId);
  const qc = useQueryClient();
  const presetsQuery = useDoctorPresets();
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [icdCatalogOpen, setIcdCatalogOpen] = React.useState(false);
  const [protocolToApply, setProtocolToApply] =
    React.useState<ClinicalProtocolRow | null>(null);

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
  const rxStructured = note?.visitPrescriptions ?? [];
  const cdsDrugIds = React.useMemo(
    () =>
      rxStructured
        .map((r) => r.drugId)
        .filter((id): id is string => !!id && !isBareClinicDrug(id)),
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

  /**
   * The note as the doctor last left it. Every replace-all payload built
   * here starts from this, not from the render snapshot: the cache already
   * holds edits whose PATCH is still in flight (usePatchVisitNote writes
   * them in at once), the snapshot does not, and a payload built on it would
   * erase them (audit VW-01).
   */
  const liveNote = React.useCallback(
    (): VisitNoteRow | null =>
      note ? (qc.getQueryData<VisitNoteRow>(visitNoteKey(note.id)) ?? note) : null,
    [note, qc],
  );

  const handleCatalogPick = React.useCallback(
    (drug: Parameters<typeof draftFromDrug>[0], term: string) => {
      const live = liveNote();
      if (!live) return;
      applyPatch({
        visitPrescriptions: [
          ...toPrescriptionDrafts(live.visitPrescriptions ?? []),
          draftFromDrug(drug, term),
        ],
      });
    },
    [liveNote, applyPatch],
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
      // «Рекомендации» column now sits right next to it — leaving them
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
      // already set one by hand.
      if (protocol.followUpDays != null && live.followUpDays == null) {
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

  return (
    <div className="flex flex-col gap-4">
      {!note ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t("structured.title")}
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("structured.empty")}
          </p>
        </section>
      ) : (
        <>
          {/* Clinic's working order: diagnosis first as its own card, then
              prescriptions as its own card — the conclusion sits in the
              middle column, advice on the right. */}
          <DiagnosisCard
            note={note}
            disabled={isFinalized}
            standalone
            saving={patch.isPending}
            onChange={(code, name) =>
              applyPatch({ diagnosisCode: code, diagnosisName: name })
            }
            onRequestApplyProtocol={(p) => setProtocolToApply(p)}
            onOpenCatalog={() => setIcdCatalogOpen(true)}
          />
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
          <CdsWarningsCard
            patientId={activeAppointment?.patient.id ?? null}
            prescriptions={cdsTextLines}
            drugIds={cdsDrugIds}
            diagnosisCode={note.diagnosisCode ?? null}
            appointmentId={activeAppointment?.id ?? null}
            visitNoteId={visitNoteId}
          />
          {(!isFinalized || note.followUpDays != null) && (
            <FollowUpCard
              note={note}
              disabled={isFinalized}
              standalone
              onChange={applyPatch}
            />
          )}
        </>
      )}

      <CatalogDrawer
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onPick={handleCatalogPick}
      />

      <IcdCatalogDrawer
        open={icdCatalogOpen}
        onOpenChange={setIcdCatalogOpen}
        onPick={(code, name) => {
          applyPatch({ diagnosisCode: code, diagnosisName: name });
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
      />
    </div>
  );
}

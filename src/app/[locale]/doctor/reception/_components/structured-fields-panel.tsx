"use client";

/**
 * The structured half of the visit screen, as three panels in two columns
 * (clinic request 29.09.2026, «хаммаси бирлашиб ковоти», reworked
 * 03.10.2026):
 *
 *   - DiagnosisPanel: «Диагноз», at the top of the middle column, as big as
 *     «Назначения» under it and split in three the same way (owner request
 *     03.10.2026, «как назначения сделал сверху, так же диагноз сделай,
 *     таким же большим и на три разделённый»);
 *   - PrescriptionsPanel: «Назначения» with its interaction check, under
 *     the diagnosis in the middle column, wide enough for a whole
 *     prescription line and the picker's three columns;
 *   - FollowUpPanel: «Контрольный визит», what stays in the left column.
 *
 * They used to be one left-column stack, where a drug row was cut to
 * «Грандаксин 50 мг — по…». Every panel saves through the same loud-patch
 * hook, so the failure behaviour cannot drift between them.
 *
 * The doctor of this screen works with the mouse (03.10.2026): a diagnosis
 * is one click in the three columns of «Диагноз» (diagnosis-picker.tsx),
 * and once the visit has one, «Назначения» offers what he usually
 * prescribes and recommends with it (diagnosis-memory-card.tsx).
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";
import type { BodyTemplate } from "@/lib/conclusion-body";
import { visitDiagnosesOf, visitDiagnosisCodes } from "@/lib/visit-diagnoses";

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
import { useTemplatesFollowDiagnoses } from "../_hooks/use-templates-follow-diagnoses";
import { useQueryClient } from "@tanstack/react-query";
import { visitNoteKey, type VisitNoteRow } from "../_hooks/use-visit-note";
import { toPrescriptionDrafts } from "../_hooks/prescription-rows";
import { adviceKey } from "../_hooks/diagnosis-columns";
// Diagnosis + follow-up cards are shared with the conclusions screen (the
// 24h in-window correction flow) — see ../../_components.
import {
  DiagnosisCard,
  FollowUpCard,
} from "../../_components/diagnosis-follow-up-cards";
import { ApplyProtocolDialog } from "./apply-protocol-dialog";
import { CatalogDrawer } from "./catalog-drawer";
import { DiagnosisMemoryCard } from "./diagnosis-memory-card";
import { DiagnosisPicker, type CatalogTrailStep } from "./diagnosis-picker";
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

// The advice column's limits (the server's ChipArray, see advice-panel.tsx).
const MAX_ADVICE_LINE_LEN = 500;
const MAX_ADVICE_LINES = 40;

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

/**
 * Top of the middle column: «Диагноз», one to four, picked in its three
 * columns, with the protocols of the main one («Применить стандарт»).
 */
export function DiagnosisPanel() {
  const t = useTranslations("doctor.reception");
  const locale = useLocale();
  const { visitNoteId, requestBodyAppend, requestBodyRemove } =
    useReceptionContext();
  // Every card saves through the shared loud-patch hook — see
  // use-loud-patch.ts for the conflict/rollback contract.
  const { note, isFinalized, applyPatch, patch } =
    useLoudVisitNotePatch(visitNoteId);
  const liveNote = useLiveNote(note);

  // A protocol's conclusion template leaves with its diagnosis: with no
  // editor on this screen, the doctor could neither see nor delete it.
  const announceTemplatesRemoved = React.useCallback(
    (templates: readonly BodyTemplate[]) => {
      for (const tpl of templates) {
        toast.info(t("structured.templateTextRemoved", { name: tpl.name }));
      }
    },
    [t],
  );
  useTemplatesFollowDiagnoses({
    noteId: note?.id ?? null,
    codes: note ? visitDiagnosisCodes(note) : [],
    disabled: isFinalized,
    locale,
    removeTexts: requestBodyRemove,
    onRemoved: announceTemplatesRemoved,
  });
  // The catalog column's place outlives the folded columns and the patient:
  // a neurologist goes back to the same block visit after visit.
  const [trail, setTrail] = React.useState<CatalogTrailStep[]>([]);
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

  // No visit yet: the block keeps its place with a quiet card, so the page
  // does not reflow when the visit starts.
  if (!note) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("diagnosis.title")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("diagnosis.picker.noVisit")}
        </p>
      </section>
    );
  }

  return (
    <>
      <DiagnosisCard
        note={note}
        disabled={isFinalized}
        standalone
        saving={patch.isPending}
        onChange={applyPatch}
        onRequestApplyProtocol={(p) => setProtocolToApply(p)}
        picker={({ collapse, opened }) => (
          <DiagnosisPicker
            note={note}
            liveNote={() => liveNote() ?? note}
            onChange={applyPatch}
            trail={trail}
            onTrail={setTrail}
            onCollapse={collapse}
            focusSearch={opened}
          />
        )}
      />

      <ApplyProtocolDialog
        open={!!protocolToApply}
        onOpenChange={(next) => {
          if (!next) setProtocolToApply(null);
        }}
        protocol={protocolToApply}
        onApply={handleApplyProtocol}
        followUpSet={note.followUpDays != null || note.followUpDate != null}
      />
    </>
  );
}

/**
 * «Контрольный визит», in the side column under «Рекомендации» since
 * 05.10.2026 (session-tab-content.tsx).
 */
export function FollowUpPanel() {
  const t = useTranslations("doctor.reception");
  const { visitNoteId } = useReceptionContext();
  const { note, isFinalized, applyPatch } = useLoudVisitNotePatch(visitNoteId);

  // Always one element, even with nothing in it, so the side column's
  // stack keeps the same shape on a signed note without a control visit.
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!note ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">
            {t("structured.title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("structured.empty")}
          </p>
        </section>
      ) : (!isFinalized ||
          note.followUpDays != null ||
          note.followUpDate != null) ? (
        <FollowUpCard
          note={note}
          disabled={isFinalized}
          standalone
          onChange={applyPatch}
        />
      ) : null}
    </div>
  );
}

/**
 * Middle column: «Назначения» as its own card, with the mouse-first picker,
 * the interaction check and «Записать аллергию» inside it, and the lines
 * recognised in the conclusion text (older notes, the AI rail) offered
 * right below.
 */
export function PrescriptionsPanel() {
  const t = useTranslations("doctor.reception");
  const {
    visitNoteId,
    requestBodyAppend,
    requestBodyRemove,
    activeAppointment,
    registerDraftFlush,
  } = useReceptionContext();
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
  // id twice, and only the names show the doctor wrote a double dose. And its
  // form: a gel or eye drops barely reach the blood (audit G4-22).
  const rxStructured = note?.visitPrescriptions ?? [];
  const cdsDrugRows = React.useMemo(
    () =>
      rxStructured.flatMap((r) =>
        r.drugId && !isBareClinicDrug(r.drugId)
          ? [{ id: r.drugId, displayName: r.displayName, form: r.form ?? null }]
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
  // A row the text card could not dose («Конкор 5 мг — ¼ утром», 10.10.2026)
  // goes to the same dose prompt instead of being saved with a guess.
  const draftPickRef = React.useRef<
    ((draft: VisitPrescriptionDraft) => void) | null
  >(null);

  /**
   * Legacy chip arrays are saved replace-all, so building the payload from
   * the render snapshot loses the first of two quick clicks. Read the
   * CURRENT cache row and fold the result back synchronously — same guard
   * the advice column and the parsed-prescription adopt path use. Advice
   * goes through here too when «Обычно при <диагноз>» adds a recommendation.
   */
  const mutateChips = React.useCallback(
    (
      key: FieldDef["key"] | "advice",
      updater: (cur: string[]) => string[],
    ): boolean => {
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

  /**
   * Recommendations from «Обычно при <диагноз>», added to the advice column
   * with its rules: no line twice (case aside), at most MAX_ADVICE_LINES.
   */
  const addAdviceLines = React.useCallback(
    (lines: readonly string[]) => {
      mutateChips("advice", (cur) => {
        const next = [...cur];
        for (const raw of lines) {
          const line = raw.trim().slice(0, MAX_ADVICE_LINE_LEN);
          if (!line || next.length >= MAX_ADVICE_LINES) continue;
          if (next.some((l) => adviceKey(l) === adviceKey(line))) continue;
          next.push(line);
        }
        return next;
      });
    },
    [mutateChips],
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

  // No visit yet: the column keeps its place with a quiet card, so the page
  // does not reflow when the visit starts.
  if (!note) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("fields.prescriptions.label")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("rx.picker.noVisit")}
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PrescriptionConstructor
        note={note}
        disabled={isFinalized}
        standalone
        saving={patch.isPending}
        // «Обычно при <диагноз>»: what this doctor usually prescribes and
        // recommends with the visit's diagnoses, above the picker's columns.
        aboveColumns={(pickApi) => (
          <DiagnosisMemoryCard
            note={note}
            pickApi={pickApi}
            onAddAdvice={addAdviceLines}
          />
        )}
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
        draftPickRef={draftPickRef}
        // A drug waiting in the dose prompt holds «Завершить приём» and
        // «Предпросмотр» until it is added or cancelled.
        registerDraftFlush={registerDraftFlush}
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
          // A row without a dose (a part of a tablet the parser could not
          // count) is never saved: the first one goes to the constructor's
          // dose prompt, which holds one pick at a time; the others stay
          // on the card for another click.
          const ready = drafts.filter((d) => d.dose.trim());
          const needsDose = drafts.find((d) => !d.dose.trim());
          if (ready.length > 0) {
            // Same lost-update guard as every other replace-all save:
            // compose on the live cache row (the patch hook folds the
            // result back in at once), so two quick «+» clicks both land.
            const live = liveNote() ?? note;
            applyPatch({
              visitPrescriptions: [
                ...toPrescriptionDrafts(live.visitPrescriptions ?? []),
                ...ready,
              ],
            });
          }
          if (needsDose) draftPickRef.current?.(needsDose);
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

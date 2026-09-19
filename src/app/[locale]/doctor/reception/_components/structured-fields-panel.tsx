"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2Icon } from "lucide-react";

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
// Diagnosis + follow-up cards are shared with the conclusions screen (the
// 24h in-window correction flow) — see ../../_components.
import {
  DiagnosisCard,
  FollowUpCard,
} from "../../_components/diagnosis-follow-up-cards";
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
  // Every card in this panel saves through the shared loud-patch hook:
  // diagnosis, prescription rows (replace-all!), follow-up. See
  // use-loud-patch.ts for the conflict/rollback contract — the advice
  // column uses the same hook, so behaviour cannot drift between columns.
  const { note, isFinalized, applyPatch, patch } =
    useLoudVisitNotePatch(visitNoteId);
  const presetsQuery = useDoctorPresets();
  const [catalogOpen, setCatalogOpen] = React.useState(false);
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
      // The apply-dialog previews the protocol's advice lines and the
      // «Рекомендации» column now sits right next to it — leaving them
      // unapplied read as a bug (review finding). Same merge semantics as
      // prescriptions: dedup, never clobber what the doctor already wrote.
      if ((protocol.adviceTemplate?.length ?? 0) > 0) {
        const mergedAdvice = mergeUnique(
          note.advice ?? [],
          protocol.adviceTemplate,
        );
        if (mergedAdvice.length !== (note.advice ?? []).length) {
          patch.advice = mergedAdvice;
        }
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
            onAddLegacyLine={(line) => {
              if (!note || isFinalized) return;
              const arr = note[RX_FIELD.key] ?? [];
              if (arr.includes(line)) return;
              applyPatch({ [RX_FIELD.key]: [...arr, line] } as VisitNotePatch);
            }}
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

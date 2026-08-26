"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

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
import {
  isEditWindowExpired,
  isVersionConflict,
  usePatchVisitNote,
  useVisitNote,
  type VisitNotePatch,
  type VisitPrescriptionDraft,
} from "../_hooks/use-visit-note";
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
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const presetsQuery = useDoctorPresets();
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [protocolToApply, setProtocolToApply] =
    React.useState<ClinicalProtocolRow | null>(null);

  const noteRefetch = noteQuery.refetch;
  const applyPatch = React.useCallback(
    (p: VisitNotePatch) => {
      if (!note || isFinalized) return;
      // Every card in this panel saves through here: diagnosis, prescription
      // rows (replace-all!), follow-up, dynamics. A silent failure means the
      // doctor believes the data is recorded when it is not — the worst
      // failure class for a clinical system — so every error must be loud.
      patch.mutate(p, {
        onError: (e) => {
          if (isVersionConflict(e)) {
            // Another window saved this note first. Do NOT refetch here: the
            // conclusion editor still holds this window's stale draft, and a
            // refreshed cache row would hand its autosave a fresh version
            // token — letting the stale text overwrite the other window.
            // The doctor is told to reload instead.
            toast.error(t("structured.saveErrorConflict"));
            return;
          }
          toast.error(
            isEditWindowExpired(e)
              ? t("structured.saveErrorLocked")
              : t("structured.saveErrorGeneric"),
          );
          // Explicit rollback: the cards render from the cached server row
          // (the failed PATCH never touched it), so a refetch snaps every
          // optimistic-looking control back to server truth.
          void noteRefetch();
        },
      });
    },
    [note, isFinalized, patch, noteRefetch, t],
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

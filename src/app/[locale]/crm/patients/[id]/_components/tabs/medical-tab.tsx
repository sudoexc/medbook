"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import type { Patient } from "../../_hooks/use-patient";
import { usePatchPatient } from "../../_hooks/use-patient";
import type { Role } from "../../_hooks/use-current-role";

export interface MedicalTabProps {
  patient: Patient;
  role: Role;
}

/**
 * Medical tab — Phase 2a stub.
 *
 * The TZ §6.5.4 asks for complaints, diagnoses (ICD-10), allergies, chronic
 * diseases, medications, past surgeries, and attached study results. The
 * current Prisma schema (`prisma/schema.prisma` §Patient) only has a single
 * `notes` text field — no allergies array, no diagnoses table.
 *
 * Until `prisma-schema-owner` adds the dedicated fields/tables we persist
 * everything into `Patient.notes` (free-form text) via PATCH. This keeps the
 * data flow correct and avoids bespoke Communication hacks; a later
 * migration can split the blob into structured columns.
 *
 * NURSE has read-write access per charter; the read-only bucket is currently
 * empty (every non-RECEPTIONIST role writes).
 */
export function MedicalTab({ patient, role }: MedicalTabProps) {
  const t = useTranslations("patientCard.medical");
  const [draft, setDraft] = React.useState(patient.notes ?? "");
  const [saving, setSaving] = React.useState(false);
  const patch = usePatchPatient(patient.id);

  React.useEffect(() => {
    setDraft(patient.notes ?? "");
  }, [patient.notes]);

  const dirty = draft !== (patient.notes ?? "");
  const canWrite =
    role === "ADMIN" || role === "DOCTOR" || role === "NURSE" || role === "SUPER_ADMIN";

  const save = async () => {
    setSaving(true);
    try {
      await patch.mutateAsync({ notes: draft || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-[color:var(--warning-foreground)]">
        <AlertTriangleIcon className="size-4 shrink-0" />
        <p>{t("stubNotice")}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <Label htmlFor="medical-notes" className="text-sm font-medium">
          {t("notes")}
        </Label>
        <Textarea
          id="medical-notes"
          rows={10}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("placeholder")}
          disabled={!canWrite || saving}
          className="mt-2"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDraft(patient.notes ?? "")}
            disabled={!dirty || saving}
          >
            {t("reset")}
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || !dirty || saving}
            onClick={save}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StubCard title={t("anamnesis")} hint={t("anamnesisHint")} />
        <StubCard title={t("allergies")} hint={t("allergiesHint")} />
        <StubCard title={t("diagnoses")} hint={t("diagnosesHint")} />
      </div>
    </div>
  );
}

function StubCard({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

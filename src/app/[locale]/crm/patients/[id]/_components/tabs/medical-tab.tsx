"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  HeartPulseIcon,
  PencilIcon,
  PillIcon,
  PlusIcon,
  StethoscopeIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DateText } from "@/components/atoms/date-text";
import { ConfirmDeleteDialog } from "@/components/molecules/confirm-delete-dialog";

import type { Patient } from "../../_hooks/use-patient";
import { usePatchPatient } from "../../_hooks/use-patient";
import type { Role } from "../../_hooks/use-current-role";
import {
  useAllergies,
  useCreateAllergy,
  useDeleteAllergy,
  useUpdateAllergy,
  useChronicConditions,
  useCreateChronic,
  useDeleteChronic,
  useUpdateChronic,
  useDiagnoses,
  useCreateDiagnosis,
  useDeleteDiagnosis,
  useUpdateDiagnosis,
  type AllergyRow,
  type ChronicRow,
  type DiagnosisRow,
} from "../../_hooks/use-patient-medical";

export interface MedicalTabProps {
  patient: Patient;
  role: Role;
}

export function MedicalTab({ patient, role }: MedicalTabProps) {
  const t = useTranslations("patientCard.medical");
  const canWrite =
    role === "ADMIN" ||
    role === "DOCTOR" ||
    role === "NURSE" ||
    role === "SUPER_ADMIN";

  return (
    <div className="motion-stagger flex flex-col gap-4">
      <NotesCard patient={patient} canWrite={canWrite} t={t} />
      <AllergiesCard patientId={patient.id} canWrite={canWrite} t={t} />
      <ChronicCard patientId={patient.id} canWrite={canWrite} t={t} />
      <DiagnosesCard patientId={patient.id} canWrite={canWrite} t={t} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Notes
// ──────────────────────────────────────────────────────────────────────────

type T = ReturnType<typeof useTranslations<"patientCard.medical">>;

function NotesCard({
  patient,
  canWrite,
  t,
}: {
  patient: Patient;
  canWrite: boolean;
  t: T;
}) {
  const [draft, setDraft] = React.useState(patient.notes ?? "");
  const [saving, setSaving] = React.useState(false);
  const patch = usePatchPatient(patient.id);

  React.useEffect(() => {
    setDraft(patient.notes ?? "");
  }, [patient.notes]);

  const dirty = draft !== (patient.notes ?? "");

  const save = async () => {
    setSaving(true);
    try {
      await patch.mutateAsync({ notes: draft || null });
      toast.success(t("notesSaved"));
    } catch (e) {
      toast.error(t("notesSaveFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      icon={<PencilIcon className="size-4" />}
      title={t("notes")}
      subtitle={t("notesHint")}
    >
      <Textarea
        rows={5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t("placeholder")}
        disabled={!canWrite || saving}
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
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Allergies
// ──────────────────────────────────────────────────────────────────────────

function AllergiesCard({
  patientId,
  canWrite,
  t,
}: {
  patientId: string;
  canWrite: boolean;
  t: T;
}) {
  const list = useAllergies(patientId);
  const create = useCreateAllergy(patientId);
  const update = useUpdateAllergy(patientId);
  const remove = useDeleteAllergy(patientId);
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<AllergyRow | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );

  const rows = list.data?.rows ?? [];

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    try {
      await remove.mutateAsync(id);
      toast.success(t("allergies.deleted"));
      setPendingDeleteId(null);
    } catch (e) {
      toast.error(t("allergies.deleteFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
      setPendingDeleteId(null);
    }
  };

  const onSubmit = async (input: Partial<AllergyRow>) => {
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...input });
        toast.success(t("allergies.updated"));
      } else {
        await create.mutateAsync(input);
        toast.success(t("allergies.created"));
      }
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      toast.error(t("allergies.saveFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Section
      icon={<AlertCircleIcon className="size-4" />}
      title={t("allergies.title")}
      subtitle={t("allergies.subtitle")}
      action={
        canWrite ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setShowForm((v) => !v);
            }}
          >
            {showForm ? <XIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
            {showForm ? t("close") : t("add")}
          </Button>
        ) : null
      }
    >
      {showForm ? (
        <AllergyForm
          initial={editing}
          submitting={create.isPending || update.isPending}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSubmit={onSubmit}
          t={t}
        />
      ) : null}

      {list.isLoading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <Empty hint={t("allergies.empty")} />
      ) : (
        <ul className="motion-stagger space-y-2">
          {rows.map((row) => (
            <AllergyItem
              key={row.id}
              row={row}
              canWrite={canWrite}
              onEdit={() => {
                setEditing(row);
                setShowForm(true);
              }}
              onDelete={() => setPendingDeleteId(row.id)}
              t={t}
            />
          ))}
        </ul>
      )}
      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
        title={t("allergies.confirmDelete")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </Section>
  );
}

function AllergyItem({
  row,
  canWrite,
  onEdit,
  onDelete,
  t,
}: {
  row: AllergyRow;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  t: T;
}) {
  const sev = row.severity;
  const tone =
    sev === "SEVERE"
      ? "border-l-rose-500 bg-rose-50/40 dark:bg-rose-950/20"
      : sev === "MODERATE"
      ? "border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/20"
      : "border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/15";
  const sevLabel =
    sev === "SEVERE"
      ? t("allergies.severitySevere")
      : sev === "MODERATE"
      ? t("allergies.severityModerate")
      : t("allergies.severityMild");

  return (
    <li
      className={cn(
        "rounded-md border border-border border-l-2 p-3 motion-hover-lift",
        tone,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.substance}</span>
            <span className="rounded-sm bg-background/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              {sevLabel}
            </span>
          </div>
          {row.reaction ? (
            <p className="mt-1 text-sm text-foreground/80">{row.reaction}</p>
          ) : null}
          {row.notes ? (
            <p className="mt-1 text-xs text-muted-foreground">{row.notes}</p>
          ) : null}
          {row.recordedAt ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <DateText date={row.recordedAt} style="short" />
            </p>
          ) : null}
        </div>
        {canWrite ? (
          <div className="flex shrink-0 items-center gap-1">
            <IconBtn onClick={onEdit} aria-label={t("edit")}>
              <PencilIcon className="size-3.5" />
            </IconBtn>
            <IconBtn onClick={onDelete} aria-label={t("delete")}>
              <Trash2Icon className="size-3.5" />
            </IconBtn>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function AllergyForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
  t,
}: {
  initial: AllergyRow | null;
  submitting: boolean;
  onSubmit: (input: Partial<AllergyRow>) => void;
  onCancel: () => void;
  t: T;
}) {
  const [substance, setSubstance] = React.useState(initial?.substance ?? "");
  const [reaction, setReaction] = React.useState(initial?.reaction ?? "");
  const [severity, setSeverity] = React.useState<AllergyRow["severity"]>(
    initial?.severity ?? "MILD",
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!substance.trim()) return;
    onSubmit({
      substance: substance.trim(),
      reaction: reaction.trim() || null,
      severity,
      notes: notes.trim() || null,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="motion-rise-in mb-3 grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2"
    >
      <Field label={t("allergies.substance")}>
        <Input
          autoFocus
          value={substance}
          onChange={(e) => setSubstance(e.target.value)}
          required
        />
      </Field>
      <Field label={t("allergies.severity")}>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as AllergyRow["severity"])}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="MILD">{t("allergies.severityMild")}</option>
          <option value="MODERATE">{t("allergies.severityModerate")}</option>
          <option value="SEVERE">{t("allergies.severitySevere")}</option>
        </select>
      </Field>
      <Field label={t("allergies.reaction")} className="sm:col-span-2">
        <Input
          value={reaction}
          onChange={(e) => setReaction(e.target.value)}
          placeholder={t("allergies.reactionPlaceholder")}
        />
      </Field>
      <Field label={t("notesShort")} className="sm:col-span-2">
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={submitting || !substance.trim()}>
          {submitting ? t("saving") : initial ? t("save") : t("add")}
        </Button>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Chronic conditions
// ──────────────────────────────────────────────────────────────────────────

function ChronicCard({
  patientId,
  canWrite,
  t,
}: {
  patientId: string;
  canWrite: boolean;
  t: T;
}) {
  const list = useChronicConditions(patientId);
  const create = useCreateChronic(patientId);
  const update = useUpdateChronic(patientId);
  const remove = useDeleteChronic(patientId);
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<ChronicRow | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );

  const rows = list.data?.rows ?? [];

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    try {
      await remove.mutateAsync(id);
      toast.success(t("chronic.deleted"));
      setPendingDeleteId(null);
    } catch (e) {
      toast.error(t("chronic.deleteFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
      setPendingDeleteId(null);
    }
  };

  const onSubmit = async (input: Partial<ChronicRow>) => {
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...input });
        toast.success(t("chronic.updated"));
      } else {
        await create.mutateAsync(input);
        toast.success(t("chronic.created"));
      }
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      toast.error(t("chronic.saveFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Section
      icon={<HeartPulseIcon className="size-4" />}
      title={t("chronic.title")}
      subtitle={t("chronic.subtitle")}
      action={
        canWrite ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setShowForm((v) => !v);
            }}
          >
            {showForm ? <XIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
            {showForm ? t("close") : t("add")}
          </Button>
        ) : null
      }
    >
      {showForm ? (
        <ChronicForm
          initial={editing}
          submitting={create.isPending || update.isPending}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSubmit={onSubmit}
          t={t}
        />
      ) : null}
      {list.isLoading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <Empty hint={t("chronic.empty")} />
      ) : (
        <ul className="motion-stagger space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn(
                "rounded-md border border-border bg-background/60 p-3 motion-hover-lift",
                !row.isActive && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    {!row.isActive ? (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {t("chronic.inactive")}
                      </span>
                    ) : null}
                  </div>
                  {row.sinceDate ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("chronic.since")}: <DateText date={row.sinceDate} style="short" />
                    </p>
                  ) : null}
                  {row.notes ? (
                    <p className="mt-1 text-sm text-foreground/80">{row.notes}</p>
                  ) : null}
                </div>
                {canWrite ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <IconBtn
                      onClick={() => {
                        setEditing(row);
                        setShowForm(true);
                      }}
                      aria-label={t("edit")}
                    >
                      <PencilIcon className="size-3.5" />
                    </IconBtn>
                    <IconBtn
                      onClick={() => setPendingDeleteId(row.id)}
                      aria-label={t("delete")}
                    >
                      <Trash2Icon className="size-3.5" />
                    </IconBtn>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
        title={t("chronic.confirmDelete")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </Section>
  );
}

function ChronicForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
  t,
}: {
  initial: ChronicRow | null;
  submitting: boolean;
  onSubmit: (input: Partial<ChronicRow>) => void;
  onCancel: () => void;
  t: T;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [sinceDate, setSinceDate] = React.useState(
    initial?.sinceDate ? initial.sinceDate.slice(0, 10) : "",
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [isActive, setIsActive] = React.useState(initial?.isActive ?? true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      sinceDate: sinceDate ? new Date(sinceDate).toISOString() : null,
      notes: notes.trim() || null,
      isActive,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="motion-rise-in mb-3 grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2"
    >
      <Field label={t("chronic.name")} className="sm:col-span-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Field label={t("chronic.since")}>
        <Input
          type="date"
          value={sinceDate}
          onChange={(e) => setSinceDate(e.target.value)}
        />
      </Field>
      <Field label={t("chronic.status")}>
        <select
          value={isActive ? "active" : "inactive"}
          onChange={(e) => setIsActive(e.target.value === "active")}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="active">{t("chronic.active")}</option>
          <option value="inactive">{t("chronic.inactive")}</option>
        </select>
      </Field>
      <Field label={t("notesShort")} className="sm:col-span-2">
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
          {submitting ? t("saving") : initial ? t("save") : t("add")}
        </Button>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Diagnoses
// ──────────────────────────────────────────────────────────────────────────

function DiagnosesCard({
  patientId,
  canWrite,
  t,
}: {
  patientId: string;
  canWrite: boolean;
  t: T;
}) {
  const list = useDiagnoses(patientId);
  const create = useCreateDiagnosis(patientId);
  const update = useUpdateDiagnosis(patientId);
  const remove = useDeleteDiagnosis(patientId);
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<DiagnosisRow | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );

  const rows = list.data?.rows ?? [];

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    try {
      await remove.mutateAsync(id);
      toast.success(t("diagnoses.deleted"));
      setPendingDeleteId(null);
    } catch (e) {
      toast.error(t("diagnoses.deleteFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
      setPendingDeleteId(null);
    }
  };

  const onSubmit = async (input: Partial<DiagnosisRow>) => {
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...input });
        toast.success(t("diagnoses.updated"));
      } else {
        await create.mutateAsync(input);
        toast.success(t("diagnoses.created"));
      }
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      toast.error(t("diagnoses.saveFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Section
      icon={<StethoscopeIcon className="size-4" />}
      title={t("diagnoses.title")}
      subtitle={t("diagnoses.subtitle")}
      action={
        canWrite ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setShowForm((v) => !v);
            }}
          >
            {showForm ? <XIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
            {showForm ? t("close") : t("add")}
          </Button>
        ) : null
      }
    >
      {showForm ? (
        <DiagnosisForm
          initial={editing}
          submitting={create.isPending || update.isPending}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSubmit={onSubmit}
          t={t}
        />
      ) : null}
      {list.isLoading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <Empty hint={t("diagnoses.empty")} />
      ) : (
        <ul className="motion-stagger space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn(
                "rounded-md border border-border bg-background/60 p-3 motion-hover-lift",
                row.status === "RESOLVED" && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.icd10Code ? (
                      <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
                        {row.icd10Code}
                      </span>
                    ) : null}
                    <span className="font-medium">{row.label}</span>
                    {row.status === "RESOLVED" ? (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {t("diagnoses.resolved")}
                      </span>
                    ) : null}
                  </div>
                  {row.diagnosedAt ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <DateText date={row.diagnosedAt} style="short" />
                    </p>
                  ) : null}
                  {row.notes ? (
                    <p className="mt-1 text-sm text-foreground/80">{row.notes}</p>
                  ) : null}
                </div>
                {canWrite ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <IconBtn
                      onClick={() => {
                        setEditing(row);
                        setShowForm(true);
                      }}
                      aria-label={t("edit")}
                    >
                      <PencilIcon className="size-3.5" />
                    </IconBtn>
                    <IconBtn
                      onClick={() => setPendingDeleteId(row.id)}
                      aria-label={t("delete")}
                    >
                      <Trash2Icon className="size-3.5" />
                    </IconBtn>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
        title={t("diagnoses.confirmDelete")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </Section>
  );
}

function DiagnosisForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
  t,
}: {
  initial: DiagnosisRow | null;
  submitting: boolean;
  onSubmit: (input: Partial<DiagnosisRow>) => void;
  onCancel: () => void;
  t: T;
}) {
  const [icd10Code, setIcd10] = React.useState(initial?.icd10Code ?? "");
  const [label, setLabel] = React.useState(initial?.label ?? "");
  const [diagnosedAt, setDate] = React.useState(
    initial?.diagnosedAt ? initial.diagnosedAt.slice(0, 10) : "",
  );
  const [status, setStatus] = React.useState<DiagnosisRow["status"]>(
    initial?.status ?? "ACTIVE",
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    onSubmit({
      icd10Code: icd10Code.trim() || null,
      label: label.trim(),
      diagnosedAt: diagnosedAt ? new Date(diagnosedAt).toISOString() : null,
      status,
      notes: notes.trim() || null,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="motion-rise-in mb-3 grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3"
    >
      <Field label={t("diagnoses.icd")}>
        <Input
          value={icd10Code}
          onChange={(e) => setIcd10(e.target.value.toUpperCase())}
          placeholder="J45.0"
        />
      </Field>
      <Field label={t("diagnoses.label")} className="sm:col-span-2">
        <Input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
      </Field>
      <Field label={t("diagnoses.diagnosedAt")}>
        <Input
          type="date"
          value={diagnosedAt}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label={t("diagnoses.status")} className="sm:col-span-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as DiagnosisRow["status"])}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="ACTIVE">{t("diagnoses.active")}</option>
          <option value="RESOLVED">{t("diagnoses.resolved")}</option>
        </select>
      </Field>
      <Field label={t("notesShort")} className="sm:col-span-3">
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="sm:col-span-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={submitting || !label.trim()}>
          {submitting ? t("saving") : initial ? t("save") : t("add")}
        </Button>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="motion-fade-in rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {subtitle ? (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground motion-press"
      {...rest}
    >
      {children}
    </button>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      <div className="h-12 animate-pulse rounded-md bg-muted" />
      <div className="h-12 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
      {hint}
    </div>
  );
}

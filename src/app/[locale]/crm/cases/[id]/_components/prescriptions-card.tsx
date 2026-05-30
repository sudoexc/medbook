"use client";

/**
 * <PrescriptionsCard /> — Phase 16 Wave 3.
 *
 * Mounts on the case-detail page below the SOAP draft. Lets the doctor
 * (or admin) write, edit, pause, and delete prescriptions for the case.
 * Active rows with `remindersEnabled` flow into the hourly
 * `medication-reminder` worker.
 *
 * The list is read directly off `data.prescriptions` (folded into the case
 * detail GET — see DETAIL_INCLUDE in `/api/crm/cases/[id]/route.ts`); no
 * separate fetch. Mutations call the dedicated `/prescriptions` routes and
 * invalidate the case detail query.
 */

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PillIcon, PlusIcon, Trash2Icon, PencilIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteDialog } from "@/components/molecules/confirm-delete-dialog";

import {
  type CasePrescriptionRow,
  caseKey,
} from "../_hooks/use-case";

type Doctor = {
  id: string;
  nameRu: string;
  nameUz: string;
};

type FormState = {
  id?: string; // present = edit mode
  doctorId: string;
  drugName: string;
  dosage: string;
  times: string; // comma-separated HH:mm
  days: string; // empty = open-ended
  notes: string;
  remindersEnabled: boolean;
  status: CasePrescriptionRow["status"];
};

const EMPTY_FORM: FormState = {
  doctorId: "",
  drugName: "",
  dosage: "",
  times: "09:00, 21:00",
  days: "30",
  notes: "",
  remindersEnabled: false,
  status: "ACTIVE",
};

const STATUS_VARIANT: Record<
  CasePrescriptionRow["status"],
  "default" | "success" | "warning" | "muted"
> = {
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "muted",
  CANCELLED: "muted",
};

function parseTimes(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{2}:\d{2}$/.test(s));
}

function formatTimes(arr: string[]): string {
  return arr.join(", ");
}

export type PrescriptionsCardProps = {
  caseId: string;
  patientId: string;
  defaultDoctorId: string | null;
  prescriptions: CasePrescriptionRow[];
  doctors: Doctor[];
};

export function PrescriptionsCard({
  caseId,
  patientId,
  defaultDoctorId,
  prescriptions,
  doctors,
}: PrescriptionsCardProps) {
  const t = useTranslations("cases.detail.prescriptions");
  const locale = useLocale();
  const qc = useQueryClient();

  const [form, setForm] = React.useState<FormState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: caseKey(caseId) });
    qc.invalidateQueries({
      queryKey: ["patient", patientId, "prescriptions"],
    });
  }, [caseId, patientId, qc]);

  const createMutation = useMutation({
    mutationFn: async (input: FormState) => {
      const res = await fetch(`/api/crm/cases/${caseId}/prescriptions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorId: input.doctorId,
          drugName: input.drugName,
          dosage: input.dosage,
          schedule: {
            times: parseTimes(input.times),
            days: input.days ? Number(input.days) : null,
          },
          notes: input.notes || null,
          remindersEnabled: input.remindersEnabled,
          status: input.status,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("created"));
      setForm(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const patchMutation = useMutation({
    mutationFn: async (input: FormState & { id: string }) => {
      const res = await fetch(
        `/api/crm/cases/${caseId}/prescriptions/${input.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            drugName: input.drugName,
            dosage: input.dosage,
            schedule: {
              times: parseTimes(input.times),
              days: input.days ? Number(input.days) : null,
            },
            notes: input.notes || null,
            remindersEnabled: input.remindersEnabled,
            status: input.status,
          }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("updated"));
      setForm(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/crm/cases/${caseId}/prescriptions/${id}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("deleted"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startCreate = () => {
    setForm({ ...EMPTY_FORM, doctorId: defaultDoctorId ?? "" });
  };

  const startEdit = (rx: CasePrescriptionRow) => {
    setForm({
      id: rx.id,
      doctorId: rx.doctorId,
      drugName: rx.drugName,
      dosage: rx.dosage,
      times: formatTimes(rx.schedule.times ?? []),
      days: rx.schedule.days ? String(rx.schedule.days) : "",
      notes: rx.notes ?? "",
      remindersEnabled: rx.remindersEnabled,
      status: rx.status,
    });
  };

  const submit = () => {
    if (!form) return;
    const times = parseTimes(form.times);
    if (!form.drugName.trim()) {
      toast.error(t("validation.drugRequired"));
      return;
    }
    if (!form.dosage.trim()) {
      toast.error(t("validation.dosageRequired"));
      return;
    }
    if (times.length === 0) {
      toast.error(t("validation.timesRequired"));
      return;
    }
    if (!form.id && !form.doctorId) {
      toast.error(t("validation.doctorRequired"));
      return;
    }
    if (form.id) {
      patchMutation.mutate({ ...form, id: form.id });
    } else {
      createMutation.mutate(form);
    }
  };

  const isPending = createMutation.isPending || patchMutation.isPending;

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <PillIcon className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <Badge variant="muted">{prescriptions.length}</Badge>
        </div>
        {!form && (
          <Button size="sm" onClick={startCreate}>
            <PlusIcon className="size-4" />
            {t("add")}
          </Button>
        )}
      </header>

      <div className="space-y-3 p-4">
        {prescriptions.length === 0 && !form && (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}

        {prescriptions.map((rx) => (
          <article
            key={rx.id}
            className={cn(
              "flex items-start justify-between gap-3 rounded-md border border-border bg-background/40 p-3",
              form?.id === rx.id && "ring-2 ring-primary/30",
            )}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{rx.drugName}</span>
                <span className="text-sm text-muted-foreground">
                  {rx.dosage}
                </span>
                <Badge variant={STATUS_VARIANT[rx.status]}>
                  {t(`status.${rx.status}`)}
                </Badge>
                {rx.remindersEnabled && (
                  <Badge variant="default">{t("remindersOn")}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {(rx.schedule.times ?? []).join(", ") || "—"}
                {rx.schedule.days
                  ? ` · ${t("daysShort", { n: rx.schedule.days })}`
                  : ` · ${t("openEnded")}`}
                {rx.doctor && (
                  <span className="ml-2">
                    · {locale === "uz" ? rx.doctor.nameUz : rx.doctor.nameRu}
                  </span>
                )}
              </div>
              {rx.notes && (
                <p className="text-xs text-muted-foreground">{rx.notes}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => startEdit(rx)}
                aria-label={t("edit")}
              >
                <PencilIcon className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setPendingDeleteId(rx.id)}
                aria-label={t("delete")}
              >
                <Trash2Icon className="size-4 text-destructive" />
              </Button>
            </div>
          </article>
        ))}

        {form && (
          <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rx-drug">{t("fields.drug")}</Label>
                <Input
                  id="rx-drug"
                  value={form.drugName}
                  onChange={(e) =>
                    setForm({ ...form, drugName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="rx-dosage">{t("fields.dosage")}</Label>
                <Input
                  id="rx-dosage"
                  value={form.dosage}
                  onChange={(e) =>
                    setForm({ ...form, dosage: e.target.value })
                  }
                  placeholder={t("fields.dosagePlaceholder")}
                />
              </div>
              <div>
                <Label htmlFor="rx-times">{t("fields.times")}</Label>
                <Input
                  id="rx-times"
                  value={form.times}
                  onChange={(e) =>
                    setForm({ ...form, times: e.target.value })
                  }
                  placeholder="09:00, 21:00"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("fields.timesHint")}
                </p>
              </div>
              <div>
                <Label htmlFor="rx-days">{t("fields.days")}</Label>
                <Input
                  id="rx-days"
                  type="number"
                  min={1}
                  max={365}
                  value={form.days}
                  onChange={(e) =>
                    setForm({ ...form, days: e.target.value })
                  }
                  placeholder={t("fields.daysPlaceholder")}
                />
              </div>
              {!form.id && (
                <div>
                  <Label htmlFor="rx-doctor">{t("fields.doctor")}</Label>
                  <select
                    id="rx-doctor"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    value={form.doctorId}
                    onChange={(e) =>
                      setForm({ ...form, doctorId: e.target.value })
                    }
                  >
                    <option value="">{t("fields.doctorPlaceholder")}</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {locale === "uz" ? d.nameUz : d.nameRu}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <Label htmlFor="rx-status">{t("fields.status")}</Label>
                <select
                  id="rx-status"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as FormState["status"],
                    })
                  }
                >
                  <option value="ACTIVE">{t("status.ACTIVE")}</option>
                  <option value="PAUSED">{t("status.PAUSED")}</option>
                  <option value="COMPLETED">{t("status.COMPLETED")}</option>
                  <option value="CANCELLED">{t("status.CANCELLED")}</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="rx-notes">{t("fields.notes")}</Label>
              <Textarea
                id="rx-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="rx-reminders"
                checked={form.remindersEnabled}
                onCheckedChange={(v: boolean) =>
                  setForm({ ...form, remindersEnabled: v })
                }
              />
              <Label htmlFor="rx-reminders">
                {t("fields.remindersEnabled")}
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm(null)}
              >
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={submit} disabled={isPending}>
                {form.id ? t("save") : t("createCta")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
        title={t("confirmDelete")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onConfirm={async () => {
          if (!pendingDeleteId) return;
          const id = pendingDeleteId;
          setPendingDeleteId(null);
          await deleteMutation.mutateAsync(id).catch(() => {
            // toast handled by onError
          });
        }}
        pending={deleteMutation.isPending}
      />
    </section>
  );
}

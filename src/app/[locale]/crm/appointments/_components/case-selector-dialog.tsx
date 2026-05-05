"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckIcon,
  FolderOpenIcon,
  PlusIcon,
  SparklesIcon,
  XCircleIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Reusable case selector for the appointment booking flow and the appointment
 * drawer. Caller controls open/close + receives the chosen caseId on
 * `onSelect`.
 *
 * Behaviour:
 *  - Lists OPEN cases for the patient.
 *  - Auto-suggests the case whose `primaryDoctorId` matches the supplied
 *    `doctorId` (most likely "continued treatment with this doctor").
 *  - "Detach" option only appears if `currentCaseId` is set.
 *  - "+ Create new case" reveals an inline mini form. On submit it POSTs to
 *    /api/crm/cases. If `attachAppointmentId` is provided, the dialog also
 *    attaches the appointment in the same step. Otherwise it just emits the
 *    new case id back to the caller for it to attach later.
 *
 * Tenant-scope is enforced server-side; the dialog trusts the API.
 */

type CaseRow = {
  id: string;
  title: string;
  status: "OPEN" | "RESOLVED" | "ABANDONED" | "TRANSFERRED";
  primaryDoctorId: string | null;
  openedAt: string;
  updatedAt: string;
  primaryDoctor: {
    id: string;
    nameRu: string;
    nameUz: string;
    color: string | null;
  } | null;
  _count: { appointments: number };
};

export interface CaseSelectorDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  /** When set, used to bias the auto-suggest highlight. */
  doctorId?: string | null;
  /** Currently attached case id — enables the "Detach" row. */
  currentCaseId?: string | null;
  /**
   * If supplied, picking an existing case calls
   * `attach-appointment { appointmentId }`, picking "Detach" calls
   * `detach-appointment`, and "Create new" creates+attaches in one go.
   * If not supplied, the dialog simply emits the resolved caseId | null
   * via `onSelect` and the caller wires the API itself.
   */
  attachAppointmentId?: string | null;
  onSelect: (caseId: string | null) => void;
}

export function CaseSelectorDialog({
  open,
  onOpenChange,
  patientId,
  doctorId,
  currentCaseId,
  attachAppointmentId,
  onSelect,
}: CaseSelectorDialogProps) {
  const t = useTranslations("appointments.case");
  const locale = useLocale() as Locale;
  const qc = useQueryClient();

  const [creating, setCreating] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newComplaint, setNewComplaint] = React.useState("");

  // Reset transient state every time the dialog opens
  React.useEffect(() => {
    if (!open) return;
    setCreating(false);
    setNewTitle("");
    setNewComplaint("");
  }, [open]);

  const casesQuery = useQuery<CaseRow[], Error>({
    queryKey: ["cases", "open-for-patient", patientId],
    enabled: open && Boolean(patientId),
    queryFn: async ({ signal }) => {
      const sp = new URLSearchParams({
        patientId,
        status: "OPEN",
        limit: "50",
        sort: "openedAt",
        dir: "desc",
      });
      const res = await fetch(`/api/crm/cases?${sp.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: CaseRow[] };
      return j.rows ?? [];
    },
    staleTime: 15_000,
  });

  const cases = casesQuery.data ?? [];
  const suggested: CaseRow | null = doctorId
    ? (cases.find((c) => c.primaryDoctorId === doctorId) ?? null)
    : null;

  const attach = useMutation<{ id: string }, Error, string>({
    mutationFn: async (caseId) => {
      if (!attachAppointmentId) return { id: caseId };
      const res = await fetch(
        `/api/crm/cases/${caseId}/attach-appointment`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId: attachAppointmentId }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { id: caseId };
    },
  });

  const detach = useMutation<void, Error, string>({
    mutationFn: async (caseId) => {
      if (!attachAppointmentId) return;
      const res = await fetch(
        `/api/crm/cases/${caseId}/detach-appointment`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId: attachAppointmentId }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
  });

  const create = useMutation<
    { id: string },
    Error,
    { title: string; primaryComplaint?: string }
  >({
    mutationFn: async ({ title, primaryComplaint }) => {
      const res = await fetch(`/api/crm/cases`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          title: title.trim(),
          primaryDoctorId: doctorId ?? null,
          primaryComplaint: primaryComplaint?.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as { id: string };
      if (attachAppointmentId) {
        const aRes = await fetch(
          `/api/crm/cases/${created.id}/attach-appointment`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appointmentId: attachAppointmentId }),
          },
        );
        if (!aRes.ok) {
          // Surface but don't blow up — we still return the created case id.
          toast.warning(t("attachFailed"));
        }
      }
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["appointment"] });
    },
  });

  const handlePick = async (caseId: string) => {
    try {
      if (attachAppointmentId) {
        await attach.mutateAsync(caseId);
        toast.success(t("attachSuccess"));
        qc.invalidateQueries({ queryKey: ["appointment"] });
        qc.invalidateQueries({ queryKey: ["appointments", "list"] });
      }
      onSelect(caseId);
      onOpenChange(false);
    } catch {
      toast.error(t("attachFailed"));
    }
  };

  const handleDetach = async () => {
    if (!currentCaseId) return;
    try {
      if (attachAppointmentId) {
        await detach.mutateAsync(currentCaseId);
      }
      onSelect(null);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["appointment"] });
      qc.invalidateQueries({ queryKey: ["appointments", "list"] });
    } catch {
      toast.error(t("attachFailed"));
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const created = await create.mutateAsync({
        title: newTitle,
        primaryComplaint: newComplaint,
      });
      onSelect(created.id);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message || t("attachFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("selectorTitle")}</DialogTitle>
          {suggested ? (
            <DialogDescription className="flex items-center gap-1.5">
              <SparklesIcon className="size-3.5 text-primary" aria-hidden />
              {t("selectorAutoSuggest")}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {!creating ? (
          <div className="grid gap-3">
            {casesQuery.isLoading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t("loading")}
              </p>
            ) : cases.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t("selectorEmpty")}
              </p>
            ) : (
              <ul className="grid gap-1.5">
                {cases.map((c) => {
                  const highlighted = suggested?.id === c.id;
                  const isCurrent = currentCaseId === c.id;
                  const docName = c.primaryDoctor
                    ? locale === "uz"
                      ? c.primaryDoctor.nameUz
                      : c.primaryDoctor.nameRu
                    : null;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handlePick(c.id)}
                        disabled={attach.isPending}
                        className={cn(
                          "group flex w-full items-start gap-3 rounded-lg border bg-card/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          highlighted
                            ? "border-primary/60 bg-primary/5"
                            : "border-border",
                          isCurrent && "ring-1 ring-primary/40",
                        )}
                      >
                        <FolderOpenIcon
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            highlighted
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {c.title}
                            </span>
                            {highlighted ? (
                              <Badge variant="info" className="shrink-0">
                                <SparklesIcon className="size-3" aria-hidden />
                                {t("selectorRecommended")}
                              </Badge>
                            ) : null}
                            {isCurrent ? (
                              <Badge variant="muted" className="shrink-0">
                                <CheckIcon className="size-3" aria-hidden />
                                {t("selectorCurrent")}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            {docName ? <span>{docName}</span> : null}
                            <span>·</span>
                            <span>
                              {t("selectorVisits", {
                                n: c._count.appointments,
                              })}
                            </span>
                            <span>·</span>
                            <span>
                              {formatDate(c.openedAt, locale, "short")}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreating(true)}
                className="gap-1.5"
              >
                <PlusIcon className="size-3.5" />
                {t("selectorCreateNew")}
              </Button>
              {currentCaseId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDetach}
                  disabled={detach.isPending}
                  className="gap-1.5 text-muted-foreground"
                >
                  <XCircleIcon className="size-3.5" />
                  {t("detach")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateSubmit} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="case-title">{t("createTitleLabel")}</Label>
              <Input
                id="case-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t("createTitlePlaceholder")}
                autoFocus
                required
                maxLength={120}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="case-complaint">
                {t("createComplaintLabel")}
              </Label>
              <Textarea
                id="case-complaint"
                value={newComplaint}
                onChange={(e) => setNewComplaint(e.target.value)}
                placeholder={t("createComplaintPlaceholder")}
                rows={2}
                maxLength={500}
              />
            </div>
            <DialogFooter className="mt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(false)}
                disabled={create.isPending}
              >
                {t("createCancel")}
              </Button>
              <Button
                type="submit"
                disabled={create.isPending || !newTitle.trim()}
              >
                {create.isPending ? t("saving") : t("createSubmit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CaseSelectorDialog;

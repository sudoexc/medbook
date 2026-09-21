"use client";

/**
 * The visit's terminal action, where the flow actually ends.
 *
 * The doctor fills the columns top-to-bottom (diagnosis → prescriptions →
 * conclusion → advice) — and the sign-off button used to live in the header
 * card at the very top. This sticky bar keeps «Завершить приём» in view at
 * the bottom of the screen and, instead of a mute disabled button, says
 * exactly what is missing (the diagnosis gate).
 *
 * The finalize flow MOVED here from ActivePatientCard (not copied): flush
 * the editors' debounced tails, confirm empty sections explicitly, then
 * finalize and pin the appointment so the card survives the queue refetch.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckIcon,
  Loader2Icon,
  SquareCheckIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  isVersionConflict,
  useFinalizeVisitNote,
  useVisitNote,
  visitNoteKey,
  type VisitNoteRow,
} from "../_hooks/use-visit-note";

export function VisitActionBar() {
  const t = useTranslations("doctor.reception");
  const {
    activeAppointment,
    visitNoteId,
    flushDraftEdits,
    pinFinalizedAppointment,
  } = useReceptionContext();
  const qc = useQueryClient();
  const noteQuery = useVisitNote(visitNoteId);
  const finalize = useFinalizeVisitNote(visitNoteId);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";

  // Ф0 — finalize gate. A free-text diagnosis counts: the ICD-10 code is
  // for statistics, the name is what makes the conclusion a valid document.
  const hasDiagnosis = Boolean(
    note?.diagnosisCode || note?.diagnosisName?.trim(),
  );

  const emptySectionsOf = (n: VisitNoteRow | null | undefined): string[] =>
    !n
      ? []
      : [
          !n.bodyMarkdown?.trim() ? t("activePatient.emptyConclusion") : null,
          (n.visitPrescriptions?.length ?? 0) === 0 &&
          n.prescriptions.length === 0
            ? t("activePatient.emptyPrescriptions")
            : null,
        ].filter((s): s is string => s !== null);
  const emptySections = emptySectionsOf(note);

  // P0-2 — drain the editor's debounced tail before any finalize decision.
  const flushBeforeFinalize = async (): Promise<boolean> => {
    try {
      await flushDraftEdits();
      return true;
    } catch (e) {
      toast.error(
        isVersionConflict(e)
          ? t("editor.saveErrorConflict")
          : t("activePatient.finalizeFlushError"),
      );
      return false;
    }
  };

  const doFinalize = async () => {
    if (!visitNoteId || !activeAppointment || finalize.isPending || isFinalized)
      return;
    if (!(await flushBeforeFinalize())) return;
    try {
      await finalize.mutateAsync();
      // P0-3 — the queue refetch flips this appointment to COMPLETED, which
      // would unmount the screen before the doctor can print. Pin it.
      pinFinalizedAppointment(activeAppointment);
    } catch (error) {
      toast.error(
        error instanceof Error && / 400$/.test(error.message)
          ? t("activePatient.finalizeErrorDiagnosis")
          : t("activePatient.finalizeErrorGeneric"),
      );
    }
  };

  const onFinalize = async () => {
    if (!visitNoteId || finalize.isPending || isFinalized || !hasDiagnosis)
      return;
    // Flush BEFORE the emptiness check so text typed seconds ago counts.
    if (!(await flushBeforeFinalize())) return;
    const fresh =
      qc.getQueryData<VisitNoteRow>(visitNoteKey(visitNoteId)) ?? note;
    if (emptySectionsOf(fresh).length > 0) {
      setConfirmOpen(true);
      return;
    }
    await doFinalize();
  };

  // Nothing to sign: no visit, or already signed (the header card shows the
  // finished state and the print buttons).
  if (!activeAppointment || !note || isFinalized) return null;

  return (
    <>
      <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 px-5 py-3 shadow-lg shadow-foreground/5 backdrop-blur-sm">
        {hasDiagnosis ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium text-success">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-success/15">
              <CheckIcon className="size-3" />
            </span>
            {t("actionBar.ready")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-600">
            <AlertTriangleIcon className="size-4" />
            {t("actionBar.needDiagnosis")}
          </span>
        )}

        <Button
          type="button"
          size="lg"
          disabled={finalize.isPending || !hasDiagnosis}
          onClick={onFinalize}
        >
          {finalize.isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SquareCheckIcon className="size-4" />
          )}
          {t("activePatient.finishVisit")}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("activePatient.confirmEmptyTitle")}</DialogTitle>
            <DialogDescription>
              {t("activePatient.confirmEmptyHint")}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5">
            {emptySections.map((section) => (
              <li
                key={section}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
                {section}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {t("activePatient.confirmEmptyCancel")}
            </Button>
            <Button
              type="button"
              disabled={finalize.isPending}
              onClick={async () => {
                setConfirmOpen(false);
                await doFinalize();
              }}
            >
              {t("activePatient.confirmEmptyConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

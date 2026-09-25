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
  emptyConclusionSections,
  type ConclusionSection,
} from "@/lib/visit-note-sections";
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

const SECTION_LABEL: Record<ConclusionSection, string> = {
  diagnosis: "activePatient.emptyDiagnosis",
  conclusion: "activePatient.emptyConclusion",
  prescriptions: "activePatient.emptyPrescriptions",
};

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
  // What the confirm dialog lists, captured from the post-flush cache at the
  // moment it opens. Deriving it from `note` at render time showed the
  // pre-flush snapshot: text typed a second ago was still listed as empty.
  const [confirmSections, setConfirmSections] = React.useState<string[]>([]);

  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";

  // The diagnosis stopped being a hard gate (clinic decision 23.09.2026):
  // a visit for an EEG or a repeat dressing has no new diagnosis, and
  // forcing one produced invented data. It joins the other sections that
  // are merely confirmed before signing.
  const hasDiagnosis = Boolean(
    note?.diagnosisCode || note?.diagnosisName?.trim(),
  );

  // One definition of «empty» for every place that signs (reception, the
  // conclusion card, the server's My Day gate): see visit-note-sections.
  const emptySectionsOf = (n: VisitNoteRow | null | undefined): string[] =>
    !n
      ? []
      : emptyConclusionSections({
          ...n,
          structuredRx: n.visitPrescriptions?.length ?? 0,
        }).map((section) => t(SECTION_LABEL[section]));

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
    } catch {
      // The diagnosis is no longer a gate, so no failure here is the
      // doctor's to fix by filling a field — keep the message generic.
      toast.error(t("activePatient.finalizeErrorGeneric"));
    }
  };

  const onFinalize = async () => {
    if (!visitNoteId || finalize.isPending || isFinalized) return;
    // Flush BEFORE the emptiness check so text typed seconds ago counts.
    if (!(await flushBeforeFinalize())) return;
    const fresh =
      qc.getQueryData<VisitNoteRow>(visitNoteKey(visitNoteId)) ?? note;
    const missing = emptySectionsOf(fresh);
    if (missing.length > 0) {
      setConfirmSections(missing);
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
          // Informational, not blocking: the doctor may close the visit
          // without a diagnosis and will be asked to confirm it once.
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangleIcon className="size-4 text-amber-500" />
            {t("actionBar.noDiagnosisHint")}
          </span>
        )}

        <Button
          type="button"
          size="lg"
          disabled={finalize.isPending}
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
            {confirmSections.map((section) => (
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

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
 * any debounced text tails, wait for every queued card save, confirm empty
 * sections explicitly (judged on the saved row), then finalize and pin the
 * appointment so the card survives the queue refetch. The ordering lives in
 * `signVisitNoteWhenSaved`, shared in spirit with the conclusion card.
 *
 * «Предпросмотр» sits next to it since the conclusion editor, which carried
 * it, left the visit screen (03.10.2026): the sheet is checked right before
 * it is signed.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckIcon,
  EyeIcon,
  Loader2Icon,
  PrinterIcon,
  SquareCheckIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { printConclusion } from "@/components/visit/print-conclusion";
import { type ConclusionSection } from "@/lib/visit-note-sections";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { isPendingDosePick } from "../_hooks/prescription-rows";
import { useReceptionContext } from "../_hooks/reception-context";
import { cdsDrugCheckPatientKey } from "../_hooks/use-cds-drug-check";
import {
  isAppointmentNotActive,
  isFollowUpDateRefused,
  isVersionConflict,
  settleVisitNotePatches,
  signVisitNoteWhenSaved,
  useFinalizeVisitNote,
  useVisitNote,
} from "../_hooks/use-visit-note";
import { ConclusionPreviewDialog } from "./conclusion-preview-dialog";

/**
 * How long «Предпросмотр» waits for queued saves before it opens anyway:
 * the sheet redraws by itself when a late save lands (it is keyed by
 * `updatedAt`), and a dead link must not leave the button spinning.
 */
const PREVIEW_SETTLE_MS = 3_000;

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
  // What the confirm dialog lists, judged on the row read back from the
  // server after every queued save landed (VW-04), not on the render-time
  // cache, which showed text typed a second ago as still empty.
  const [confirmSections, setConfirmSections] = React.useState<string[]>([]);
  // The whole sequence (flush, drain, read back, sign) takes a round trip or
  // three; the ref stops a double click from starting it twice.
  const [signing, setSigning] = React.useState(false);
  const signingRef = React.useRef(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewPreparing, setPreviewPreparing] = React.useState(false);

  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";

  // The diagnosis stopped being a hard gate (clinic decision 23.09.2026):
  // a visit for an EEG or a repeat dressing has no new diagnosis, and
  // forcing one produced invented data. It joins the other sections that
  // are merely confirmed before signing.
  const hasDiagnosis = Boolean(
    note?.diagnosisCode || note?.diagnosisName?.trim(),
  );

  /**
   * «Завершить приём». The button is deliberately not disabled while a card
   * save is pending (same reasoning as the conclusion card): the dose field
   * commits on blur, i.e. on the mousedown of this very click, and a button
   * disabled before mouseup never receives it. It waits for the queue
   * instead, with its spinner on.
   *
   * `emptyConfirmed` is the second pass from the empty-sections dialog.
   */
  const runFinalize = async (emptyConfirmed: boolean) => {
    if (!visitNoteId || !activeAppointment || isFinalized) return;
    if (signingRef.current) return;
    signingRef.current = true;
    setSigning(true);
    const appointment = activeAppointment;
    // The drug check re-runs as the doctor signs (audit G3-02): the card left
    // on screen after signing must judge the record as it is now, not as it
    // was when the last prescription changed, even if an event was missed.
    void qc.invalidateQueries({
      queryKey: cdsDrugCheckPatientKey(appointment.patient.id),
    });
    try {
      const step = await signVisitNoteWhenSaved({
        noteId: visitNoteId,
        flushDraftEdits,
        readSavedRow: async () => {
          // What the server holds, not the optimistic cache: the check must
          // judge exactly what finalize is about to sign.
          const fresh = await noteQuery.refetch();
          if (fresh.isError || !fresh.data) {
            throw fresh.error ?? new Error("visit-note refetch failed");
          }
          return fresh.data;
        },
        finalize: () => finalize.mutateAsync(),
        emptyConfirmed,
      });
      if (step.kind === "flushFailed") {
        // A drug still waiting in the dose prompt: nothing was signed, the
        // prompt is scrolled into view. Not an error of the connection.
        if (isPendingDosePick(step.error)) {
          toast.error(t("rx.pendingBlocksSign", { name: step.error.displayName }));
          return;
        }
        toast.error(
          isVersionConflict(step.error)
            ? t("editor.saveErrorConflict")
            : t("activePatient.finalizeFlushError"),
        );
        return;
      }
      if (step.kind === "unsaved") {
        // A queued card save was refused. Its own toast may not have shown
        // (TanStack runs mutate() callbacks for the latest call only) and
        // the card still shows the optimistic value: say so, snap it back.
        toast.error(t("activePatient.finalizeUnsaved"));
        void noteQuery.refetch();
        return;
      }
      if (step.kind === "confirm") {
        setConfirmSections(
          step.missing.map((section) => t(SECTION_LABEL[section])),
        );
        setConfirmOpen(true);
        return;
      }
      // P0-3 — the queue refetch flips this appointment to COMPLETED, which
      // would unmount the screen before the doctor can print. Pin it.
      pinFinalizedAppointment(appointment);
    } catch (e) {
      if (isAppointmentNotActive(e)) {
        // VW-03 — reception cancelled the visit (or marked a no-show) while
        // this screen was stale. Nothing was signed; show the real state.
        toast.error(t("activePatient.finalizeNotActive"));
        void qc.invalidateQueries({ queryKey: ["doctor", "reception"] });
        return;
      }
      if (isFollowUpDateRefused(e)) {
        // The exact control-visit day has come and gone since it was
        // picked. Nothing was signed; the card shows that day in red, and
        // the doctor picks a new one there.
        toast.error(t("followUp.signDatePast"));
        void noteQuery.refetch();
        return;
      }
      // The diagnosis is no longer a gate, so no failure here is the
      // doctor's to fix by filling a field — keep the message generic.
      toast.error(t("activePatient.finalizeErrorGeneric"));
    } finally {
      signingRef.current = false;
      setSigning(false);
    }
  };
  const signBusy = signing || finalize.isPending;

  /**
   * Open the sheet as the server will print it: a drug picked a second ago
   * is still on the wire, and the first frame of the preview would miss it.
   */
  const openPreview = async (then: "preview" | "print" = "preview") => {
    if (!visitNoteId || previewPreparing) return;
    setPreviewPreparing(true);
    let open = true;
    try {
      await Promise.race([
        (async () => {
          await flushDraftEdits();
          await settleVisitNotePatches(visitNoteId);
        })(),
        new Promise((resolve) => setTimeout(resolve, PREVIEW_SETTLE_MS)),
      ]);
    } catch (e) {
      // A drug waiting in the dose prompt is not on the sheet: say so
      // instead of showing a preview without it.
      if (isPendingDosePick(e)) {
        open = false;
        toast.error(t("rx.pendingBlocksSign", { name: e.displayName }));
      }
      // A failed save has its own toast; the preview shows what is saved.
    } finally {
      setPreviewPreparing(false);
      if (open) {
        // «Печать» (owner report 09.10.2026): the same settled sheet, printed
        // at once without opening the preview.
        if (then === "print") printConclusion(visitNoteId);
        else setPreviewOpen(true);
      }
    }
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-10 px-4 text-sm"
            disabled={previewPreparing}
            onClick={() => void openPreview()}
          >
            {previewPreparing ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <EyeIcon className="size-4" />
            )}
            {t("editor.viewPreview")}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-10 px-4 text-sm"
            disabled={previewPreparing}
            onClick={() => void openPreview("print")}
          >
            <PrinterIcon className="size-4" />
            {t("activePatient.print")}
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-10 px-4 text-sm"
            disabled={signBusy}
            onClick={() => void runFinalize(false)}
          >
            {signBusy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SquareCheckIcon className="size-4" />
            )}
            {t("activePatient.finishVisit")}
          </Button>
        </div>
      </div>

      <ConclusionPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        noteId={note.id}
        updatedAt={note.updatedAt}
      />

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
              disabled={signBusy}
              onClick={async () => {
                setConfirmOpen(false);
                await runFinalize(true);
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

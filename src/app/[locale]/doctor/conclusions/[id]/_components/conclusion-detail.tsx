"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  CheckIcon,
  FileSignatureIcon,
  FileTextIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
} from "lucide-react";

import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { type ConclusionSection } from "@/lib/visit-note-sections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  isEditWindowExpired,
  isVersionConflict,
  prepareVisitNoteSignature,
  settleVisitNotePatches,
  useFinalizeVisitNote,
  usePatchVisitNote,
  useVisitNote,
  visitNoteKey,
  type VisitNotePatch,
  type VisitNoteRow,
  type VisitPrescriptionDraft,
} from "../../../reception/_hooks/use-visit-note";
// Same controls the doctor used during the visit — reused, not re-implemented,
// so an in-window correction can never diverge from the original entry UI.
import {
  DiagnosisCard,
  FollowUpCard,
} from "../../../_components/diagnosis-follow-up-cards";
import { PrescriptionConstructor } from "../../../reception/_components/prescription-constructor";
import { AmendmentsSection } from "./amendments-section";
import { RevisionsSection } from "./revisions-section";
import { TelegramSendPanel } from "../../../_components/telegram-send-panel";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function editableWindowEndsAt(finalizedAt: string | null): number | null {
  if (!finalizedAt) return null;
  return new Date(finalizedAt).getTime() + EDIT_WINDOW_MS;
}

function formatRemaining(
  ms: number,
  tr: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (ms <= 0) return tr("detail.remainingExpired");
  const h = Math.floor(ms / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (h > 0) return tr("detail.remainingHoursMinutes", { h, m });
  return tr("detail.remainingMinutes", { m });
}

export function ConclusionDetail({
  noteId,
  locale,
}: {
  noteId: string;
  locale: string;
}) {
  const tr = useTranslations("doctor.conclusions");
  const noteQuery = useVisitNote(noteId);
  const patch = usePatchVisitNote(noteId);
  const note = noteQuery.data ?? null;
  const qc = useQueryClient();
  const finalize = useFinalizeVisitNote(noteId);
  // Sections the doctor is asked to confirm before signing (null = closed).
  const [signConfirm, setSignConfirm] = React.useState<
    ConclusionSection[] | null
  >(null);
  // True from the click until finalize answers, including the wait for the
  // queued corrections. The ref guards a double click the state would only
  // reflect after the next render.
  const [signing, setSigning] = React.useState(false);
  const signingRef = React.useRef(false);

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  // Amendment form visibility lives here so the header button (next to the
  // "window closed" lock) can open the form rendered further down the page.
  const [amendFormOpen, setAmendFormOpen] = React.useState(false);
  const hydratedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!note) return;
    if (hydratedFor.current === note.id) return;
    hydratedFor.current = note.id;
    setDraft(note.bodyMarkdown ?? "");
  }, [note]);

  const isFinalized = note?.status === "FINALIZED";
  // A note signed once stays on the clock even after the visit is reverted
  // to DRAFT: the server counts the window from the FIRST signature, so the
  // screen must too, or it offers edits the save will refuse.
  const signedAt = note?.firstFinalizedAt ?? note?.finalizedAt ?? null;
  const everSigned = isFinalized || signedAt != null;
  const editsEndAt = editableWindowEndsAt(signedAt);
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!editsEndAt) return;
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [editsEndAt]);
  const canEdit = !everSigned || (editsEndAt != null && nowTick < editsEndAt);
  const remainingMs = editsEndAt ? editsEndAt - nowTick : null;

  if (noteQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {tr("detail.loading")}
      </div>
    );
  }

  if (noteQuery.isError || !note) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        {tr("detail.loadError")}
      </div>
    );
  }

  const onSave = async () => {
    try {
      await patch.mutateAsync({ bodyMarkdown: draft });
      setEditing(false);
    } catch (e) {
      // A swallowed failure here means the doctor closes the page believing
      // the conclusion is saved. Stay in edit mode (the draft is not lost)
      // and say exactly why the save was rejected.
      toast.error(
        isVersionConflict(e)
          ? tr("detail.saveErrorConflict")
          : isEditWindowExpired(e)
            ? tr("detail.saveErrorLocked")
            : tr("detail.saveErrorGeneric"),
      );
    }
  };

  const onCancel = () => {
    setDraft(note.bodyMarkdown ?? "");
    setEditing(false);
  };

  /**
   * Save path for the structured cards (diagnosis / prescriptions / control
   * visit). Unlike the conclusion text — which has an explicit «Сохранить» —
   * these cards commit on interaction, exactly as they do during the visit.
   *
   * A silent failure here is the worst case in this whole screen: the doctor
   * corrects a dosage, sees the control move, walks away, and the patient
   * keeps the old regimen. So every rejection is surfaced and the card is
   * snapped back to server truth by refetching.
   */
  const applyStructuredPatch = (p: VisitNotePatch) => {
    if (!canEdit) return;
    patch.mutate(p, {
      onError: (e) => {
        toast.error(
          isVersionConflict(e)
            ? tr("detail.saveErrorConflict")
            : isEditWindowExpired(e)
              ? tr("detail.saveErrorLocked")
              : tr("detail.saveErrorGeneric"),
        );
        void noteQuery.refetch();
      },
    });
  };

  // DC-01 — a draft whose visit is already closed (My Day closed it, or
  // reception did) used to offer only «Открыть в приёме», which opens today's
  // live visit, not this one: the draft could never be signed. It is signed
  // right here now; finalize accepts a completed visit. A draft of a visit
  // still in progress opens that very visit on the reception screen.
  const appointmentStatus = note.appointment?.status ?? null;
  const canSign = note.status === "DRAFT" && appointmentStatus === "COMPLETED";
  const canOpenInReception =
    note.status === "DRAFT" && appointmentStatus === "IN_PROGRESS";

  /**
   * Sign the draft. Every correction the doctor made before the click is
   * saved first: the finalize POST does not wait in the PATCH queue, so a
   * dose typed and a time chip clicked just before «Подписать» used to reach
   * the server after the signature. The signed revision and its PDF lacked
   * them, and the late PATCH then failed as a stale version.
   *
   * The button is deliberately not disabled while a PATCH is pending: the
   * dose field commits on blur, i.e. on the mousedown of this very click, and
   * a button disabled before mouseup never receives the click. It shows its
   * spinner and waits for the queue instead.
   *
   * `confirmed` is the second pass from the empty-sections dialog, which
   * already ran the check on the saved row.
   */
  const sign = async (confirmed: boolean) => {
    if (signingRef.current || editing) return;
    signingRef.current = true;
    setSigning(true);
    try {
      if (confirmed) {
        if (!(await settleVisitNotePatches(note.id))) {
          toast.error(tr("detail.signUnsaved"));
          void noteQuery.refetch();
          return;
        }
      } else {
        const ready = await prepareVisitNoteSignature(note.id, async () => {
          // What the server holds, not the optimistic cache: the check must
          // judge exactly what finalize is about to sign.
          const fresh = await noteQuery.refetch();
          if (fresh.isError || !fresh.data) {
            throw fresh.error ?? new Error("visit-note refetch failed");
          }
          return fresh.data;
        });
        if (ready.kind === "unsaved") {
          // The failed save may not have toasted itself (TanStack runs a
          // mutate() callback only for the latest call), and the card still
          // shows the optimistic value: say so and snap it back.
          toast.error(tr("detail.signUnsaved"));
          void noteQuery.refetch();
          return;
        }
        if (ready.missing.length > 0) {
          setSignConfirm(ready.missing);
          return;
        }
      }
      await finalize.mutateAsync();
      toast.success(tr("detail.signed"));
      void qc.invalidateQueries({ queryKey: ["doctor", "conclusions"] });
    } catch {
      toast.error(tr("detail.signError"));
    } finally {
      signingRef.current = false;
      setSigning(false);
    }
  };
  const signBusy = signing || finalize.isPending;

  return (
    <div className="flex flex-col gap-4 xl:gap-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileTextIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {/* Free text counts: keying the header off the code alone showed
                  «Без диагноза» on conclusions that carry one in words. */}
              {[note.diagnosisCode, note.diagnosisName]
                .filter((v) => Boolean(v && v.trim()))
                .join(" · ") || tr("noDiagnosis")}
            </div>
            <div className="text-xs text-muted-foreground">
              {note.status === "FINALIZED"
                ? tr("detail.finalizedAt", { date: formatDateTime(note.finalizedAt) })
                : tr("detail.statusDraft")}
            </div>
            {canSign && (
              <div className="text-xs text-amber-700">
                {tr("detail.draftCompletedHint")}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isFinalized && canEdit && remainingMs != null && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {tr("detail.editAvailable", { remaining: formatRemaining(remainingMs, tr) })}
            </span>
          )}
          {isFinalized && !canEdit && (
            <>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <LockIcon className="size-3" />
                {tr("detail.editWindowClosed")}
              </span>
              {/* The window is closed, but the record is not a dead end: the
                  amendment flow appends corrections without touching the
                  issued original. */}
              <button
                type="button"
                onClick={() => setAmendFormOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <PlusIcon className="size-4" />
                {tr("amendments.add")}
              </button>
            </>
          )}
          <a
            href={`/api/crm/visit-notes/${note.id}/print?lang=${locale === "uz" ? "uz" : "ru"}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <PrinterIcon className="size-4" />
            {tr("detail.print")}
          </a>
          {note.status === "FINALIZED" ? (
            <TelegramSendPanel patientId={note.patientId} visitNoteId={note.id} />
          ) : null}
          {canOpenInReception && (
            <Link
              href={`/${locale}/doctor/reception?appointment=${encodeURIComponent(note.appointmentId)}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <PencilIcon className="size-4" />
              {tr("detail.openInReception")}
            </Link>
          )}
          {canSign && (
            <button
              type="button"
              onClick={() => void sign(false)}
              disabled={signBusy || editing}
              aria-busy={signBusy}
              title={editing ? tr("detail.signSaveFirst") : undefined}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {signBusy ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <FileSignatureIcon className="size-4" />
              )}
              {tr("detail.sign")}
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] xl:gap-5">
        <section className="flex min-h-[480px] flex-col rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs">
            <span className="font-medium text-foreground">{tr("detail.bodyHeading")}</span>
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={!canEdit || signBusy}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                <PencilIcon className="size-3" />
                {canEdit ? tr("detail.edit") : tr("detail.readOnly")}
              </button>
            ) : (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={patch.isPending}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {tr("detail.cancel")}
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={patch.isPending}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {patch.isPending ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <CheckIcon className="size-3" />
                  )}
                  {tr("detail.save")}
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 resize-none border-0 bg-transparent px-5 py-4 text-sm leading-relaxed text-foreground focus:outline-none"
            />
          ) : (
            <pre
              className={cn(
                "flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 font-sans text-sm leading-relaxed text-foreground",
                !note.bodyMarkdown && "text-muted-foreground",
              )}
            >
              {note.bodyMarkdown || tr("detail.bodyEmpty")}
            </pre>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          {/* Clinical corrections. While the 24h window is open these are the
              live constructors from the visit screen — a dosage error must be
              fixable in the same control that created it, not only as free
              text. After the window they render disabled (read-only) and the
              amendment flow in the header takes over. */}
          {/* Frozen while a signature is on its way: an edit made after the
              queue was drained would race the finalize POST again. `inert`
              rather than the cards' `disabled`, which would fold away the
              search box and the open row editor for that second. */}
          <section
            inert={signBusy}
            aria-busy={signBusy}
            className={cn(
              "flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 transition-opacity",
              signBusy && "opacity-60",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {tr("detail.clinicalHeading")}
              </h3>
              {canEdit ? (
                patch.isPending && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2Icon className="size-3 animate-spin" />
                    {tr("detail.saving")}
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <LockIcon className="size-3" />
                  {tr("detail.readOnly")}
                </span>
              )}
            </div>
            {canEdit && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {tr("detail.clinicalHint")}
              </p>
            )}

            <PrescriptionConstructor
              note={note}
              disabled={!canEdit}
              // Presets, the frequent/clinic shortlist and the catalog drawer
              // belong to the live visit flow; a correction is a targeted
              // fix, not a fresh prescribing session, so the surface stays
              // deliberately narrower here.
              presets={[]}
              shortlist={false}
              onSaveRows={(rows: VisitPrescriptionDraft[]) =>
                applyStructuredPatch({ visitPrescriptions: rows })
              }
              onPresetClick={() => {}}
              onRemoveLegacyChip={(chip: string) =>
                // Built on the live cache row, like every replace-all save:
                // two quick removals must both stick (audit VW-01).
                applyStructuredPatch({
                  prescriptions: (
                    qc.getQueryData<VisitNoteRow>(visitNoteKey(note.id))
                      ?.prescriptions ??
                    note.prescriptions ??
                    []
                  ).filter((c) => c !== chip),
                })
              }
              onOpenCatalog={() => {}}
            />
            <DiagnosisCard
              note={note}
              disabled={!canEdit}
              onChange={(code, name) =>
                applyStructuredPatch({
                  diagnosisCode: code,
                  diagnosisName: name,
                })
              }
              // Applying a whole protocol is a visit-time action (it rewrites
              // prescriptions and appends template text) — out of scope for a
              // correction, so the affordance is simply not offered.
              onRequestApplyProtocol={() => {}}
            />
            {(canEdit || note.followUpDays != null) && (
              <FollowUpCard
                note={note}
                disabled={!canEdit}
                onChange={applyStructuredPatch}
              />
            )}
          </section>

          <DetailCard title={tr("detail.structuredFields")}>
            <ChipGroup label={tr("detail.complaints")} items={note.complaints} />
            <ChipGroup label={tr("detail.anamnesis")} items={note.anamnesis} />
            <ChipGroup label={tr("detail.examination")} items={note.examination} />
            {/* Legacy free-text prescriptions are rendered (and removable) by
                the constructor above — showing them twice would suggest two
                separate lists. */}
            <ChipGroup label={tr("detail.advice")} items={note.advice} />
          </DetailCard>

          <DetailCard title={tr("detail.info")}>
            <Row k={tr("detail.patient")} v={note.patient?.fullName ?? "—"} />
            <Row k={tr("detail.startedAt")} v={formatDateTime(note.startedAt)} />
            <Row k={tr("detail.finalizedAtLabel")} v={formatDateTime(note.finalizedAt)} />
            <Row k={tr("detail.updatedAt")} v={formatDateTime(note.updatedAt)} />
            {note.aiGenerated && (
              <Row k={tr("detail.ai")} v={note.aiModel ?? tr("detail.aiGenerated")} />
            )}
          </DetailCard>
        </aside>
      </div>

      {everSigned && (
        <RevisionsSection
          noteId={note.id}
          updatedAt={note.updatedAt}
          locale={locale}
        />
      )}

      {everSigned && (
        <AmendmentsSection
          noteId={note.id}
          locale={locale}
          canAmend={!canEdit}
          formOpen={amendFormOpen}
          onFormOpenChange={setAmendFormOpen}
        />
      )}

      <Dialog
        open={signConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setSignConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("detail.signConfirmTitle")}</DialogTitle>
            <DialogDescription>{tr("detail.signConfirmHint")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5">
            {(signConfirm ?? []).map((section) => (
              <li
                key={section}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
                {tr(`detail.sections.${section}`)}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSignConfirm(null)}
            >
              {tr("detail.signConfirmCancel")}
            </Button>
            <Button
              type="button"
              disabled={signBusy}
              onClick={() => {
                setSignConfirm(null);
                void sign(true);
              }}
            >
              {tr("detail.signConfirmConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function ChipGroup({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-border pb-1 last:border-0">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="truncate text-xs font-medium text-foreground">{v}</span>
    </div>
  );
}

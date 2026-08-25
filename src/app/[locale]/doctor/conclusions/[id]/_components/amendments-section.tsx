"use client";

/**
 * Amendments (исправления) to a finalized conclusion.
 *
 * Shown on the conclusion detail page once the note is FINALIZED. After the
 * 24h edit window closes the note itself becomes read-only (medico-legal:
 * the numbered, QR-stamped paper is already with the patient), and this
 * section becomes the ONLY way to correct it — each correction is appended
 * as an immutable row and lands in the print form and the patient's PDF as
 * a separate «Исправления» block. The original text is never rewritten.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

export type AmendmentRow = {
  id: string;
  visitNoteId: string;
  doctorId: string;
  reason: string;
  text: string;
  createdAt: string;
  doctor: { nameRu: string; nameUz: string } | null;
};

const amendmentsKey = (noteId: string) =>
  ["doctor", "conclusions", "amendments", noteId] as const;

/**
 * Typed POST failure — mirrors VisitNotePatchError: the server's machine
 * `reason` decides the doctor-facing message (window still open vs draft vs
 * not-the-author), which are three very different situations.
 */
class AmendmentCreateError extends Error {
  readonly status: number;
  readonly reason: string | null;
  constructor(status: number, reason: string | null) {
    super(`amendment create ${status}`);
    this.name = "AmendmentCreateError";
    this.status = status;
    this.reason = reason;
  }
}

function useAmendments(noteId: string) {
  return useQuery<AmendmentRow[]>({
    queryKey: amendmentsKey(noteId),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/visit-notes/${noteId}/amendments`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`amendments ${res.status}`);
      return ((await res.json()) as { items: AmendmentRow[] }).items;
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}

function useCreateAmendment(noteId: string) {
  const qc = useQueryClient();
  return useMutation<AmendmentRow, Error, { reason: string; text: string }>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/crm/visit-notes/${noteId}/amendments`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        let reason: string | null = null;
        try {
          reason = ((await res.json()) as { reason?: string }).reason ?? null;
        } catch {
          reason = null;
        }
        throw new AmendmentCreateError(res.status, reason);
      }
      return (await res.json()) as AmendmentRow;
    },
    onSuccess: (row) => {
      // Append locally so the new correction is visible immediately, then
      // refetch to converge with the server ordering.
      qc.setQueryData<AmendmentRow[]>(amendmentsKey(noteId), (prev) =>
        prev ? [...prev, row] : [row],
      );
      qc.invalidateQueries({ queryKey: amendmentsKey(noteId) });
    },
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AmendmentsSection({
  noteId,
  locale,
  canAmend,
  formOpen,
  onFormOpenChange,
}: {
  noteId: string;
  locale: string;
  /** True once the 24h edit window has closed (server enforces it again). */
  canAmend: boolean;
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
}) {
  const tr = useTranslations("doctor.conclusions.amendments");
  const listQuery = useAmendments(noteId);
  const create = useCreateAmendment(noteId);
  const items = listQuery.data ?? [];

  const [reason, setReason] = React.useState("");
  const [text, setText] = React.useState("");

  // Nothing to show yet and nothing can be added — stay out of the way.
  if (!canAmend && !listQuery.isLoading && items.length === 0) return null;

  const onSubmit = async () => {
    if (!reason.trim() || !text.trim()) return;
    try {
      await create.mutateAsync({ reason: reason.trim(), text: text.trim() });
      setReason("");
      setText("");
      onFormOpenChange(false);
      toast.success(tr("created"));
    } catch (e) {
      const err = e instanceof AmendmentCreateError ? e : null;
      toast.error(
        err?.reason === "edit_window_open"
          ? tr("errorWindowOpen")
          : err?.reason === "not_finalized"
            ? tr("errorNotFinalized")
            : err?.status === 403
              ? tr("errorForbidden")
              : tr("errorGeneric"),
      );
    }
  };

  const onCancel = () => {
    setReason("");
    setText("");
    onFormOpenChange(false);
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{tr("title")}</h3>
        {canAmend && !formOpen && (
          <button
            type="button"
            onClick={() => onFormOpenChange(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <PlusIcon className="size-3.5" />
            {tr("add")}
          </button>
        )}
      </div>

      {listQuery.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          {tr("loading")}
        </div>
      ) : listQuery.isError ? (
        <div className="text-xs text-muted-foreground">{tr("loadError")}</div>
      ) : items.length === 0 && !formOpen ? (
        <div className="text-xs text-muted-foreground">{tr("empty")}</div>
      ) : (
        <ol className="flex flex-col">
          {items.map((a) => {
            const author = a.doctor
              ? locale === "uz"
                ? a.doctor.nameUz
                : a.doctor.nameRu
              : null;
            return (
              <li
                key={a.id}
                className="border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {formatDateTime(a.createdAt)}
                  {author ? ` · ${author}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {tr("reasonPrefix")}: {a.reason}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {a.text}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {formOpen && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-background p-3">
          <p className="text-xs text-muted-foreground">{tr("hint")}</p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {tr("reasonLabel")}
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tr("reasonPlaceholder")}
              maxLength={500}
              className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {tr("textLabel")}
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={tr("textPlaceholder")}
              rows={4}
              maxLength={10_000}
              className="resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={create.isPending}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {tr("cancel")}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={
                create.isPending || !reason.trim() || !text.trim()
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {create.isPending ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <CheckIcon className="size-3.5" />
              )}
              {tr("save")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

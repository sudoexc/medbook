"use client";

/**
 * Template text for the conclusion, with no editor on the visit screen.
 *
 * The conclusion editor left the visit screen (clinic request 03.10.2026:
 * nobody wrote in it, «Назначения» took its place). Two things still write
 * into the conclusion text from there: a clinical protocol's conclusion
 * template, and a preset's note template (added with its chip, taken out
 * again when the chip is removed). Both used to go through the editor's
 * draft. This headless component takes the same requests from the
 * reception context and saves them on the note itself, so a protocol
 * applied on the visit screen still reaches the signed document, its print
 * and the preview.
 *
 * Each edit is composed on the body this channel last sent while that
 * request is in flight, not on the cache: `bodyMarkdown` is not written
 * into the cache before the answer (OPTIMISTIC_FIELDS), and an unrelated
 * card's answer landing in between would hand back the older body. A
 * protocol applied and a preset clicked a moment later both stay.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { appendSnippet, removeSnippet } from "@/lib/conclusion-body";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  isEditWindowExpired,
  isVersionConflict,
  usePatchVisitNote,
  useVisitNote,
  visitNoteKey,
  type VisitNoteRow,
} from "../_hooks/use-visit-note";

export function ConclusionTemplateChannel() {
  const t = useTranslations("doctor.reception");
  const { visitNoteId, bodyAppendRequest, bodyRemoveRequest } =
    useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";
  const { mutateAsync } = usePatchVisitNote(visitNoteId);
  const qc = useQueryClient();
  const refetchNote = noteQuery.refetch;

  // The body this channel sent last, while at least one of its requests is
  // still in flight.
  const sentRef = React.useRef<{
    noteId: string;
    body: string;
    inFlight: number;
  } | null>(null);

  const edit = React.useCallback(
    (change: (body: string) => string) => {
      if (!note || isFinalized) return;
      const noteId = note.id;
      const sent = sentRef.current?.noteId === noteId ? sentRef.current : null;
      const base =
        sent?.body ??
        qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId))?.bodyMarkdown ??
        note.bodyMarkdown ??
        "";
      const next = change(base);
      if (next === base) return;
      sentRef.current = {
        noteId,
        body: next,
        inFlight: (sent?.inFlight ?? 0) + 1,
      };
      void mutateAsync({ bodyMarkdown: next })
        .catch((e: unknown) => {
          // Nothing composed on this body can land either: start over from
          // what the server holds.
          sentRef.current = null;
          if (isVersionConflict(e)) {
            // Same contract as every card (use-loud-patch.ts): a conflict
            // asks for a reload and does not refetch.
            toast.error(t("structured.saveErrorConflict"));
            return;
          }
          toast.error(
            isEditWindowExpired(e)
              ? t("structured.saveErrorLocked")
              : t("structured.saveErrorGeneric"),
          );
          void refetchNote();
        })
        .finally(() => {
          const cur = sentRef.current;
          if (cur && cur.noteId === noteId) {
            cur.inFlight -= 1;
            if (cur.inFlight <= 0) sentRef.current = null;
          }
        });
    },
    [note, isFinalized, qc, mutateAsync, refetchNote, t],
  );

  // A request already in the context when this mounts was handled by the
  // mount before (a tab switch remounts the screen): never apply it twice.
  const lastAppend = React.useRef(bodyAppendRequest?.nonce ?? 0);
  React.useEffect(() => {
    if (!bodyAppendRequest || bodyAppendRequest.nonce === lastAppend.current) {
      return;
    }
    lastAppend.current = bodyAppendRequest.nonce;
    const text = bodyAppendRequest.text;
    edit((body) => appendSnippet(body, text));
  }, [bodyAppendRequest, edit]);

  const lastRemove = React.useRef(bodyRemoveRequest?.nonce ?? 0);
  React.useEffect(() => {
    if (!bodyRemoveRequest || bodyRemoveRequest.nonce === lastRemove.current) {
      return;
    }
    lastRemove.current = bodyRemoveRequest.nonce;
    const text = bodyRemoveRequest.text;
    edit((body) => removeSnippet(body, text));
  }, [bodyRemoveRequest, edit]);

  return null;
}

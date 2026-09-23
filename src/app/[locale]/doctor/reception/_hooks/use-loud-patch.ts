"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  isEditWindowExpired,
  isVersionConflict,
  usePatchVisitNote,
  useVisitNote,
  visitNoteKey,
  type VisitNotePatch,
  type VisitNoteRow,
} from "./use-visit-note";

/**
 * The one way structured cards save a visit note. Extracted from
 * StructuredFieldsPanel when the advice panel became a separate column —
 * both panels MUST share this, not mirror it, or their failure behaviour
 * drifts apart (the sidebar-stats lesson).
 *
 * Behaviour it guarantees:
 *  - every error is loud (a silent failure means the doctor believes the
 *    data is recorded when it is not — the worst failure class here);
 *  - a version conflict does NOT refetch: the conclusion editor still holds
 *    this window's stale draft, and a refreshed cache row would hand its
 *    autosave a fresh version token, letting stale text overwrite the other
 *    window. The doctor is told to reload instead — but the fields THIS
 *    patch optimistically wrote are put back to server truth (version token
 *    untouched), or a rejected «+» leaves a prescription row on screen that
 *    was never saved;
 *  - any other failure refetches so every optimistic-looking control snaps
 *    back to server truth.
 */
export function useLoudVisitNotePatch(visitNoteId: string | null) {
  const t = useTranslations("doctor.reception");
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";

  const qc = useQueryClient();
  const noteRefetch = noteQuery.refetch;

  /**
   * Undo an optimistic write without moving the version token: read the
   * server row out-of-band and copy back only the fields `p` touched. The
   * cached `updatedAt` stays stale on purpose, so the editor's next autosave
   * still conflicts instead of overwriting the other window.
   */
  const restoreTouchedFields = React.useCallback(
    async (p: VisitNotePatch) => {
      if (!visitNoteId) return;
      const keys = Object.keys(p).filter((k) => k !== "expectedUpdatedAt");
      try {
        const res = await fetch(`/api/crm/visit-notes/${visitNoteId}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const server = (await res.json()) as Record<string, unknown>;
        qc.setQueryData<VisitNoteRow>(visitNoteKey(visitNoteId), (prev) => {
          if (!prev) return prev;
          const next: Record<string, unknown> = { ...prev };
          for (const k of keys) if (k in server) next[k] = server[k];
          return next as VisitNoteRow;
        });
      } catch {
        // The conflict toast already tells the doctor to reload.
      }
    },
    [visitNoteId, qc],
  );

  const applyPatch = React.useCallback(
    (p: VisitNotePatch) => {
      if (!note || isFinalized) return;
      patch.mutate(p, {
        onError: (e) => {
          if (isVersionConflict(e)) {
            toast.error(t("structured.saveErrorConflict"));
            void restoreTouchedFields(p);
            return;
          }
          toast.error(
            isEditWindowExpired(e)
              ? t("structured.saveErrorLocked")
              : t("structured.saveErrorGeneric"),
          );
          void noteRefetch();
        },
      });
    },
    [note, isFinalized, patch, noteRefetch, restoreTouchedFields, t],
  );

  return { note, isFinalized, applyPatch, patch, noteQuery };
}

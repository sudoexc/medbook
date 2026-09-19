"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  isEditWindowExpired,
  isVersionConflict,
  usePatchVisitNote,
  useVisitNote,
  type VisitNotePatch,
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
 *    window. The doctor is told to reload instead;
 *  - any other failure refetches so every optimistic-looking control snaps
 *    back to server truth.
 */
export function useLoudVisitNotePatch(visitNoteId: string | null) {
  const t = useTranslations("doctor.reception");
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";

  const noteRefetch = noteQuery.refetch;
  const applyPatch = React.useCallback(
    (p: VisitNotePatch) => {
      if (!note || isFinalized) return;
      patch.mutate(p, {
        onError: (e) => {
          if (isVersionConflict(e)) {
            toast.error(t("structured.saveErrorConflict"));
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
    [note, isFinalized, patch, noteRefetch, t],
  );

  return { note, isFinalized, applyPatch, patch, noteQuery };
}

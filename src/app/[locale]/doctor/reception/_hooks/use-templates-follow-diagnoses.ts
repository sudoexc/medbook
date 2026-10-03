"use client";

/**
 * A protocol's conclusion template leaves with the diagnosis it came from.
 *
 * The visit screen has no conclusion editor since 03.10.2026, so the text a
 * protocol puts into the conclusion is out of sight. The doctor applied the
 * migraine protocol, saw the diagnosis was wrong and removed it with its
 * drugs, and the migraine text stayed in the body and went into the signed
 * sheet (review of 03.10.2026). Now, when a diagnosis leaves the visit, the
 * templates of its protocols that no diagnosis still on the visit calls for
 * are taken out of the body, and a toast says so.
 *
 * Only a change seen while the screen is open counts: opening a visit never
 * edits it. Making another diagnosis the main one keeps the old one on the
 * visit, so its template stays.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  orphanedProtocolTemplates,
  templatesInBody,
  type BodyTemplate,
} from "@/lib/conclusion-body";

import {
  clinicalProtocolsQuery,
  type ClinicalProtocolRow,
} from "./use-clinical-protocols";
import { visitNoteKey, type VisitNoteRow } from "./use-visit-note";

/** The codes that were on the visit and are not any more. */
export function goneCodes(
  before: readonly string[],
  now: readonly string[],
): string[] {
  return before.filter((c) => !now.includes(c));
}

/**
 * The templates the departed codes take with them: their protocols' (a
 * failed read gives none), minus those a code still on the visit calls
 * for. `codesNow` is read once the protocols are in, so a diagnosis put
 * back meanwhile keeps its text.
 */
export async function departedTemplates(args: {
  gone: readonly string[];
  load: (code: string) => Promise<readonly ClinicalProtocolRow[]>;
  codesNow: () => readonly string[];
  locale: string;
}): Promise<BodyTemplate[]> {
  const lists = await Promise.all(
    args.gone.map((code) =>
      args.load(code).catch((): readonly ClinicalProtocolRow[] => []),
    ),
  );
  return orphanedProtocolTemplates({
    codes: args.codesNow(),
    protocols: lists.flat().map((p) => ({
      diagnosisCodePrefix: p.diagnosisCodePrefix,
      conclusionTemplateMd: p.conclusionTemplateMd,
      name: (args.locale === "uz" && p.nameUz) || p.nameRu,
    })),
  });
}

export function useTemplatesFollowDiagnoses(args: {
  noteId: string | null;
  /** The ICD codes on the visit now, main first. */
  codes: readonly string[];
  disabled: boolean;
  locale: string;
  /** Take these texts out of the body (one request). */
  removeTexts: (texts: readonly string[]) => void;
  /** The templates that were in the body: say so. */
  onRemoved: (templates: readonly BodyTemplate[]) => void;
}) {
  const { noteId, disabled, locale, removeTexts, onRemoved } = args;
  const qc = useQueryClient();
  const codesKey = args.codes.join("|");
  const seenRef = React.useRef<{ noteId: string | null; codes: string[] } | null>(
    null,
  );

  React.useEffect(() => {
    const codes = codesKey ? codesKey.split("|") : [];
    const before = seenRef.current;
    seenRef.current = { noteId, codes };
    if (!noteId || disabled || !before || before.noteId !== noteId) return;
    const gone = goneCodes(before.codes, codes);
    if (gone.length === 0) return;
    void departedTemplates({
      gone,
      // The departed code's protocols are usually cached (the diagnosis
      // card read them to offer the protocol); otherwise they are fetched.
      load: (code) => qc.ensureQueryData(clinicalProtocolsQuery(code)),
      codesNow: () => seenRef.current?.codes ?? codes,
      locale,
    }).then((orphans) => {
      // Not on the next patient's visit. (No cleanup flag: a re-render
      // re-runs this effect with nothing gone, and must not drop the
      // answer of the run that saw the diagnosis go.)
      if (orphans.length === 0 || seenRef.current?.noteId !== noteId) return;
      // Asked for even when the saved body does not show it yet: a template
      // whose save is still in flight is in the body the channel composes
      // on, and a text the body lacks changes nothing.
      removeTexts(orphans.map((o) => o.text));
      const body =
        qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId))?.bodyMarkdown ?? "";
      const found = templatesInBody(body, orphans);
      if (found.length > 0) onRemoved(found);
    });
  }, [noteId, codesKey, disabled, locale, qc, removeTexts, onRemoved]);
}

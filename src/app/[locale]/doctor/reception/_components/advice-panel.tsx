"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, PlusIcon, XIcon } from "lucide-react";

import { useReceptionContext } from "../_hooks/reception-context";
import { useDoctorPresets } from "../_hooks/use-doctor-presets";
import { useLoudVisitNotePatch } from "../_hooks/use-loud-patch";
import { visitNoteKey, type VisitNoteRow } from "../_hooks/use-visit-note";

// Server-side ChipArray limits (src/server/schemas/visit-note.ts) — enforced
// here too so a paste never dies as a misleading «проверьте связь» 400.
const MAX_LINE_LEN = 500;
const MAX_LINES = 40;

/**
 * «Рекомендации» — the third column of the visit screen, added on the
 * clinic's request: prescriptions and diagnosis live on the left, the
 * conclusion text in the middle, patient-facing advice on the right.
 *
 * Advice lines are already load-bearing downstream: the printed conclusion
 * renders them, and the auto-composed «Памятка пациенту» includes them when
 * the doctor leaves the handout tab empty. This panel is just the missing
 * input for a field the pipeline always supported.
 */
export function AdvicePanel() {
  const t = useTranslations("doctor.reception");
  const { visitNoteId, requestBodyAppend, requestBodyRemove } =
    useReceptionContext();
  const { note, isFinalized, applyPatch, patch } =
    useLoudVisitNotePatch(visitNoteId);
  const presetsQuery = useDoctorPresets();

  const qc = useQueryClient();
  const [draft, setDraft] = React.useState("");

  const advice = React.useMemo(() => note?.advice ?? [], [note?.advice]);

  // Lost-update guard (found by pre-deploy review): building the payload
  // from the render snapshot loses the first of two quick actions — click A,
  // click B within the network round-trip, and B's array never contained A.
  // So every mutation (1) reads the CURRENT cache row, (2) folds its result
  // back into the cache synchronously so the next click composes on top,
  // and (3) sends that same array. A failed PATCH refetches (loud-patch
  // contract), snapping the optimistic fold back to server truth.
  const mutateAdvice = React.useCallback(
    (updater: (cur: string[]) => string[]): boolean => {
      if (!note || isFinalized) return false;
      const key = visitNoteKey(note.id);
      const cur =
        qc.getQueryData<VisitNoteRow>(key)?.advice ?? note.advice ?? [];
      const next = updater(cur);
      if (
        next.length === cur.length &&
        next.every((v, i) => v === cur[i])
      ) {
        return false;
      }
      qc.setQueryData<VisitNoteRow>(key, (prev) =>
        prev ? { ...prev, advice: next } : prev,
      );
      applyPatch({ advice: next });
      return true;
    },
    [note, isFinalized, qc, applyPatch],
  );

  const addLine = React.useCallback(
    (raw: string): boolean => {
      const line = raw.trim().slice(0, MAX_LINE_LEN);
      if (!line) return false;
      return mutateAdvice((cur) =>
        cur.length >= MAX_LINES ||
        cur.some((a) => a.trim().toLowerCase() === line.toLowerCase())
          ? cur
          : [...cur, line],
      );
    },
    [mutateAdvice],
  );

  const presets = React.useMemo(
    () =>
      (presetsQuery.data ?? []).filter(
        (p) => p.field === "ADVICE" && !advice.includes(p.fieldValue),
      ),
    [presetsQuery.data, advice],
  );

  const handlePreset = React.useCallback(
    (preset: { fieldValue: string; noteTemplate: string | null }) => {
      // Template only when the line actually landed — otherwise a dedupe
      // no-op would orphan the template text in the conclusion editor.
      const added = addLine(preset.fieldValue);
      if (added && preset.noteTemplate?.trim())
        requestBodyAppend(preset.noteTemplate);
    },
    [addLine, requestBodyAppend],
  );

  const removeLine = React.useCallback(
    (chip: string) => {
      const removed = mutateAdvice((cur) => cur.filter((a) => a !== chip));
      if (!removed) return;
      const preset = (presetsQuery.data ?? []).find(
        (p) => p.field === "ADVICE" && p.fieldValue === chip && p.noteTemplate,
      );
      if (preset?.noteTemplate) requestBodyRemove(preset.noteTemplate);
    },
    [mutateAdvice, presetsQuery.data, requestBodyRemove],
  );

  return (
    <section className="flex flex-col gap-3 self-start rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <h2 className="shrink-0 text-sm font-semibold text-foreground">
          {t("advicePanel.title")}
          {advice.length > 0 && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {advice.length}
            </span>
          )}
        </h2>
        {patch.isPending && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            {t("editor.saving")}
          </span>
        )}
      </div>

      {!note ? (
        <p className="text-xs text-muted-foreground">{t("structured.empty")}</p>
      ) : (
        <>
          {advice.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {advice.map((line) => (
                <li
                  key={line}
                  className="group flex items-start justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm leading-snug text-foreground"
                >
                  <span className="min-w-0">{line}</span>
                  {!isFinalized && (
                    <button
                      type="button"
                      onClick={() => removeLine(line)}
                      aria-label={t("advicePanel.remove")}
                      className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!isFinalized && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addLine(draft);
                setDraft("");
              }}
              className="flex items-center gap-1.5"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_LINE_LEN}
                placeholder={t("advicePanel.placeholder")}
                className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label={t("advicePanel.add")}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PlusIcon className="size-4" />
              </button>
            </form>
          )}

          {advice.length === 0 && isFinalized && (
            <p className="text-xs text-muted-foreground">
              {t("advicePanel.emptyFinalized")}
            </p>
          )}

          {!isFinalized && presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePreset(p)}
                  className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {p.fieldValue}
                </button>
              ))}
            </div>
          )}

          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("advicePanel.hint")}
          </p>
        </>
      )}
    </section>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  CheckIcon,
  EyeIcon,
  Loader2Icon,
  PencilLineIcon,
  RotateCcwIcon,
} from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  isEditWindowExpired,
  isVersionConflict,
  usePatchVisitNote,
  useVisitNote,
  visitNoteKey,
  type VisitNotePatch,
  type VisitNoteRow,
} from "../_hooks/use-visit-note";

const AUTOSAVE_DEBOUNCE_MS = 1_500;

function formatSavedAt(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function statsOf(text: string): { chars: number; words: number } {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(" ").length;
  return { chars: text.length, words };
}

// Strip the first occurrence of `snippet` from `body`, preferring the
// "\n\n<snippet>" form that the append channel writes. If neither form is
// present (doctor heavily edited around it), returns the body unchanged.
function removeSnippet(body: string, snippet: string): string {
  if (!snippet) return body;
  const withSep = "\n\n" + snippet;
  const idxSep = body.indexOf(withSep);
  if (idxSep >= 0) return body.slice(0, idxSep) + body.slice(idxSep + withSep.length);
  // Snippet at the very start (no leading separator) — strip a trailing
  // separator instead so we don't leave a blank line.
  if (body.startsWith(snippet)) {
    const after = body.slice(snippet.length);
    return after.startsWith("\n\n") ? after.slice(2) : after;
  }
  const idx = body.indexOf(snippet);
  if (idx >= 0) return body.slice(0, idx) + body.slice(idx + snippet.length);
  return body;
}

export function NotesEditorPanel() {
  // The handout tab is gone (clinic decision 21.09.2026): the patient copy
  // is auto-composed at finalize from the structured fields (diagnosis,
  // prescriptions, advice) — see finalize/route.ts. The doctor writes ONE
  // text: the clinical conclusion.
  return (
    <section className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-1 flex-col">
        <ConclusionEditor />
      </div>
    </section>
  );
}

// ── Autosave with visible failure (P0-5) ──────────────────────────────
//
// The editor autosaves on a debounce; a failed PATCH used to be
// swallowed in an empty catch, leaving the status bar spinning «Сохранение…»
// forever — on flaky clinic Wi-Fi the doctor could not tell saved text from
// lost text. This hook owns the debounce for one field, classifies failures,
// auto-retries the transient ones with backoff and exposes the error kind so
// the status bar can render an explicit «Не сохранено» + «Повторить».

type SaveErrorKind = "conflict" | "locked" | "generic";

// Two silent retries before asking the doctor to intervene — enough to ride
// out a Wi-Fi blip without delaying the error banner past ~8s.
const AUTOSAVE_RETRY_DELAYS_MS = [2_000, 5_000];
// Manual «Повторить» should feel immediate, not re-debounced.
const MANUAL_RETRY_DELAY_MS = 300;

function classifySaveError(e: unknown): SaveErrorKind {
  if (isVersionConflict(e)) return "conflict";
  if (isEditWindowExpired(e)) return "locked";
  return "generic";
}

function useFieldAutosave({
  field,
  note,
  isFinalized,
  draft,
  patch,
  lastSentRef,
}: {
  field: "bodyMarkdown";
  note: VisitNoteRow | null;
  isFinalized: boolean;
  draft: string;
  patch: ReturnType<typeof usePatchVisitNote>;
  lastSentRef: React.MutableRefObject<string | null>;
}) {
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saveError, setSaveError] = React.useState<SaveErrorKind | null>(null);
  // Bumped to re-arm the effect when the draft itself hasn't changed:
  // automatic backoff retries and the manual «Повторить» button.
  const [saveTick, setSaveTick] = React.useState(0);
  const autoRetriesRef = React.useRef(0);
  // One-shot delay override for the next scheduled save (backoff / manual
  // retry); null → the regular typing debounce.
  const delayRef = React.useRef<number | null>(null);

  // `patch` is a fresh object every render — go through a ref so the effect
  // below doesn't need it in deps (same pattern as useDraftSafety).
  const patchRef = React.useRef(patch);
  patchRef.current = patch;

  // Fresh typing starts a fresh auto-retry budget.
  React.useEffect(() => {
    autoRetriesRef.current = 0;
  }, [draft]);

  React.useEffect(() => {
    if (!note || isFinalized) return;
    // A version conflict or an expired edit window never resolves by
    // retrying — the server will keep rejecting this window's writes. Freeze
    // the autosave loop entirely: keeps us from spamming 4xx and, more
    // importantly, keeps a later cache refresh from handing this window a
    // fresh version token that would let the stale draft overwrite the other
    // window's text. Editing resumes after the doctor reloads (re-hydration
    // resets this state).
    if (saveError === "conflict" || saveError === "locked") return;
    const current = note[field] ?? "";
    if (
      (draft === current && lastSentRef.current === null) ||
      lastSentRef.current === draft
    ) {
      setDirty(false);
      return;
    }
    setDirty(true);
    const delay = delayRef.current ?? AUTOSAVE_DEBOUNCE_MS;
    delayRef.current = null;
    const timer = setTimeout(async () => {
      try {
        await patchRef.current.mutateAsync({ [field]: draft } as VisitNotePatch);
        lastSentRef.current = draft;
        autoRetriesRef.current = 0;
        setSavedAt(Date.now());
        setDirty(false);
        setSaveError(null);
      } catch (e) {
        // Surface the failure immediately; `dirty` stays true so the flush /
        // beforeunload guards still treat the tail as unsaved.
        const kind = classifySaveError(e);
        setSaveError(kind);
        if (
          kind === "generic" &&
          autoRetriesRef.current < AUTOSAVE_RETRY_DELAYS_MS.length
        ) {
          // Transient (network / 5xx): retry on our own with backoff before
          // the doctor has to press «Повторить». Both state updates batch
          // into one effect re-run, so exactly one timer gets scheduled.
          delayRef.current =
            AUTOSAVE_RETRY_DELAYS_MS[autoRetriesRef.current] ?? null;
          autoRetriesRef.current += 1;
          setSaveTick((t) => t + 1);
        }
      }
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, note?.id, isFinalized, saveTick, saveError]);

  const retrySave = React.useCallback(() => {
    autoRetriesRef.current = 0;
    delayRef.current = MANUAL_RETRY_DELAY_MS;
    setSaveError(null);
    setSaveTick((t) => t + 1);
  }, []);

  // An external flush (finalize / unmount path in useDraftSafety) succeeded —
  // sync the visible state with it.
  const markSaved = React.useCallback(() => {
    autoRetriesRef.current = 0;
    setSavedAt(Date.now());
    setDirty(false);
    setSaveError(null);
  }, []);

  // Immediate save for the preview toggle: push the tail now so the preview
  // isn't one debounce behind. Failures are reported through the same
  // saveError channel; the caller then previews the last saved version.
  const flushNow = React.useCallback(async (): Promise<boolean> => {
    try {
      await patchRef.current.mutateAsync({ [field]: draft } as VisitNotePatch);
      lastSentRef.current = draft;
      autoRetriesRef.current = 0;
      setSavedAt(Date.now());
      setDirty(false);
      setSaveError(null);
      return true;
    } catch (e) {
      setSaveError(classifySaveError(e));
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, field]);

  return { dirty, savedAt, saveError, retrySave, markSaved, flushNow };
}

// ── Draft safety (P0-2 / P0-4) ────────────────────────────────────────
//
// Both editors autosave on a 1.5s debounce, leaving a window where the last
// keystrokes exist only in local state. This hook closes that window:
//  - registers a flush callback in the reception context so «Завершить
//    визит» can push the tail to the server BEFORE finalizing (P0-2);
//  - flushes on unmount so tab switches / SPA navigation don't drop the
//    tail (P0-4a);
//  - warns via beforeunload while unsaved text exists (P0-4b).
function useDraftSafety({
  field,
  note,
  isFinalized,
  draft,
  dirty,
  lastSentRef,
  patch,
  onFlushed,
}: {
  field: "bodyMarkdown";
  note: VisitNoteRow | null;
  isFinalized: boolean;
  draft: string;
  dirty: boolean;
  lastSentRef: React.MutableRefObject<string | null>;
  patch: ReturnType<typeof usePatchVisitNote>;
  onFlushed: () => void;
}) {
  const { registerDraftFlush } = useReceptionContext();
  const qc = useQueryClient();

  // Latest-value snapshot so the unmount cleanup and the registered flush
  // callback never close over a stale draft.
  const stateRef = React.useRef({ note, isFinalized, draft });
  stateRef.current = { note, isFinalized, draft };
  const patchRef = React.useRef(patch);
  patchRef.current = patch;
  const onFlushedRef = React.useRef(onFlushed);
  onFlushedRef.current = onFlushed;

  // Same dirtiness rule as the autosave effect: pending only when the draft
  // differs from both the server copy and the last successfully sent value.
  const pendingText = React.useCallback((): string | null => {
    const s = stateRef.current;
    if (!s.note || s.isFinalized) return null;
    const current = s.note[field] ?? "";
    const clean =
      (s.draft === current && lastSentRef.current === null) ||
      lastSentRef.current === s.draft;
    return clean ? null : s.draft;
  }, [field, lastSentRef]);

  // P0-2 — finalize awaits this via the context registry; a rejected PATCH
  // propagates so the caller aborts the finalize (never sign a note whose
  // text failed to save). No-op when nothing is dirty.
  React.useEffect(
    () =>
      registerDraftFlush(async () => {
        const text = pendingText();
        if (text === null) return;
        // Cast: TS can't narrow a computed union key to VisitNotePatch.
        await patchRef.current.mutateAsync({ [field]: text } as VisitNotePatch);
        lastSentRef.current = text;
        onFlushedRef.current();
      }),
    [registerDraftFlush, pendingText, field, lastSentRef],
  );

  // P0-4a — flush on unmount. `mutate` (not mutateAsync): the mutation and
  // its cache-merge onSuccess keep running after unmount in react-query.
  React.useEffect(() => {
    return () => {
      const s = stateRef.current;
      const text = pendingText();
      if (text === null || !s.note) return;
      const noteId = s.note.id;
      // Fold the tail into the cached row synchronously FIRST: a quick
      // remount re-hydrates the draft from this cache, and without the tail
      // it would resurrect the pre-flush text and autosave it back over the
      // flushed version.
      qc.setQueryData<VisitNoteRow>(visitNoteKey(noteId), (prev) =>
        prev ? { ...prev, [field]: text } : prev,
      );
      patchRef.current.mutate({ [field]: text } as VisitNotePatch);
    };
  }, [pendingText, field, qc]);

  // P0-4b — hard-unload guard while the draft is ahead of the server.
  React.useEffect(() => {
    if (!dirty || isFinalized) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chromium ignores preventDefault without returnValue.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, isFinalized]);
}

// ── Conclusion (clinical bodyMarkdown) ────────────────────────────────

function ConclusionEditor() {
  const t = useTranslations("doctor.reception");
  const {
    visitNoteId,
    bodyInjectVersion,
    bodyAppendRequest,
    bodyRemoveRequest,
  } = useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";

  const [draft, setDraft] = React.useState<string>("");
  const hydratedFor = React.useRef<string | null>(null);
  const hydratedInject = React.useRef<number>(0);

  React.useEffect(() => {
    if (!note) return;
    const sameNote = hydratedFor.current === note.id;
    const sameInject = hydratedInject.current === bodyInjectVersion;
    if (sameNote && sameInject) return;
    hydratedFor.current = note.id;
    hydratedInject.current = bodyInjectVersion;
    setDraft(note.bodyMarkdown ?? "");
  }, [note, bodyInjectVersion]);

  // One-shot append channel — preset chip clicks request a snippet append.
  // Preserves any unsaved typing in the draft; the regular autosave debounce
  // then ships the combined text to the server.
  const lastAppendNonce = React.useRef<number>(0);
  React.useEffect(() => {
    if (!note || isFinalized) return;
    if (!bodyAppendRequest) return;
    if (bodyAppendRequest.nonce === lastAppendNonce.current) return;
    lastAppendNonce.current = bodyAppendRequest.nonce;
    setDraft((d) => {
      const sep = d.trim() ? "\n\n" : "";
      return d + sep + bodyAppendRequest.text;
    });
  }, [bodyAppendRequest, note, isFinalized]);

  // Inverse — when a structured chip with a noteTemplate is removed, strip
  // the matching snippet from the draft. Tries "\n\n<text>" first (the form
  // the append channel writes) and falls back to a bare match if the doctor
  // edited around it. Autosave then ships the updated draft.
  const lastRemoveNonce = React.useRef<number>(0);
  React.useEffect(() => {
    if (!note || isFinalized) return;
    if (!bodyRemoveRequest) return;
    if (bodyRemoveRequest.nonce === lastRemoveNonce.current) return;
    lastRemoveNonce.current = bodyRemoveRequest.nonce;
    setDraft((d) => removeSnippet(d, bodyRemoveRequest.text));
  }, [bodyRemoveRequest, note, isFinalized]);

  const lastSentRef = React.useRef<string | null>(null);
  // P0-5 — debounced autosave with visible failure + retry.
  const { dirty, savedAt, saveError, retrySave, markSaved, flushNow } =
    useFieldAutosave({
      field: "bodyMarkdown",
      note,
      isFinalized,
      draft,
      patch,
      lastSentRef,
    });

  // P0-2/P0-4 — flush-on-finalize registration, flush-on-unmount, unload guard.
  useDraftSafety({
    field: "bodyMarkdown",
    note,
    isFinalized,
    draft,
    dirty,
    lastSentRef,
    patch,
    onFlushed: markSaved,
  });

  // Live-предпросмотр листа: тот же print-роут в iframe (?embed=1 — без
  // панели печати и без audit-шума). key по updatedAt — превью само
  // перерисовывается после каждого автосейва, в т.ч. правок в левой панели.
  const [view, setView] = React.useState<"edit" | "preview">("edit");

  const showPreview = React.useCallback(async () => {
    if (dirty && note && !isFinalized) {
      // Дожимаем несохранённый текст до показа, иначе превью отстаёт на
      // один дебаунс и врач видит «пустой» лист. При ошибке flushNow сам
      // выставит saveError (статус-бар покажет «Не сохранено»), а превью
      // откроется по последней сохранённой версии.
      await flushNow();
    }
    setView("preview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, note?.id, isFinalized, flushNow]);

  const { chars, words } = statsOf(draft);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("editor.tabConclusion")}
        </h2>
        <button
          type="button"
          disabled={!note}
          onClick={view === "edit" ? showPreview : () => setView("edit")}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          {view === "edit" ? (
            <>
              <EyeIcon className="size-3.5" />
              {t("editor.viewPreview")}
            </>
          ) : (
            <>
              <PencilLineIcon className="size-3.5" />
              {t("editor.viewEdit")}
            </>
          )}
        </button>
      </div>

      {view === "preview" && note ? (
        <iframe
          key={`${note.id}:${note.updatedAt}`}
          src={`/api/crm/visit-notes/${note.id}/print?embed=1`}
          title={t("editor.viewPreview")}
          className="flex-1 w-full border-0 bg-white"
        />
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-3 bg-muted/40 p-3 sm:p-4">
            {saveError && !patch.isPending && (
              <SaveErrorBanner error={saveError} onRetry={retrySave} />
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!note || isFinalized}
              placeholder={
                note
                  ? t("editor.conclusionPlaceholder")
                  : t("editor.conclusionPlaceholderEmpty")
              }
              className="w-full flex-1 resize-none rounded-xl border border-border bg-card px-5 py-4 text-[15px] leading-7 text-foreground placeholder:text-muted-foreground/70 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:bg-muted/30 disabled:opacity-70"
            />
          </div>

          <EditorFooter
            chars={chars}
            words={words}
            isFinalized={isFinalized}
            saving={patch.isPending}
            dirty={dirty}
            error={saveError}
            savedAt={savedAt}
            updatedAt={note?.updatedAt ?? null}
          />
        </>
      )}
    </div>
  );
}

// ── Shared bars ───────────────────────────────────────────────────────

// A save failure gets a loud strip right above the text — not a line lost in
// a status bar. It appears only when something is actually wrong, so the
// everyday layout carries zero warning chrome (P0-5 visibility, reworked).
function SaveErrorBanner({
  error,
  onRetry,
}: {
  error: SaveErrorKind;
  onRetry: () => void;
}) {
  const t = useTranslations("doctor.reception");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs">
      <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 font-medium text-destructive">
        {error === "conflict"
          ? t("editor.saveErrorConflict")
          : error === "locked"
            ? t("editor.saveErrorLocked")
            : t("editor.saveErrorGeneric")}
      </span>
      {error === "generic" && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-destructive/40 bg-card px-2.5 font-semibold text-destructive transition-colors hover:bg-destructive/10"
        >
          <RotateCcwIcon className="size-3" />
          {t("editor.retry")}
        </button>
      )}
    </div>
  );
}

// Stats + autosave state share one slim footer, Google-Docs style. The
// spinner/saved-time precedence matches the old status bar: an in-flight
// PATCH shows «Сохранение…» so retries are visible; `dirty` alone must not
// mask an error, otherwise a dead network reads as eternal saving.
function EditorFooter({
  chars,
  words,
  isFinalized,
  saving,
  dirty,
  error,
  savedAt,
  updatedAt,
}: {
  chars: number;
  words: number;
  isFinalized: boolean;
  saving: boolean;
  dirty: boolean;
  error: SaveErrorKind | null;
  savedAt: number | null;
  updatedAt: string | null;
}) {
  const t = useTranslations("doctor.reception");
  const showError = !saving && error !== null;
  const showSpinner = saving || (dirty && !showError);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {t("editor.stats", {
          chars: chars.toLocaleString("ru-RU"),
          words: words.toLocaleString("ru-RU"),
        })}
      </span>
      <span className="inline-flex min-w-0 items-center gap-2">
        {isFinalized && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("editor.finalizedBadge")}
          </span>
        )}
        {showSpinner ? (
          <>
            <Loader2Icon className="size-3 animate-spin" />
            <span>{t("editor.saving")}</span>
          </>
        ) : showError ? (
          <span className="font-medium text-destructive">
            {t("editor.saveErrorGeneric")}
          </span>
        ) : savedAt || updatedAt ? (
          <>
            <span className="inline-flex size-4 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckIcon className="size-3" />
            </span>
            <span>
              {t("editor.savedAt", {
                time: formatSavedAt(
                  savedAt ?? (updatedAt ? new Date(updatedAt).getTime() : null),
                ),
              })}
            </span>
          </>
        ) : (
          <span>{t("editor.noChanges")}</span>
        )}
      </span>
    </div>
  );
}

"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";

import { useReceptionContext } from "../_hooks/reception-context";
import { usePatchVisitNote, useVisitNote } from "../_hooks/use-visit-note";

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

export function NotesEditorPanel() {
  const { visitNoteId, bodyInjectVersion } = useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";

  // Local draft, hydrated when the note arrives OR when AI injects new body.
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

  // Debounced autosave.
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const lastSentRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!note || isFinalized) return;
    const current = note.bodyMarkdown ?? "";
    if (draft === current && lastSentRef.current === null) {
      setDirty(false);
      return;
    }
    if (lastSentRef.current === draft) {
      // already saved
      setDirty(false);
      return;
    }
    setDirty(true);
    const t = setTimeout(async () => {
      try {
        await patch.mutateAsync({ bodyMarkdown: draft });
        lastSentRef.current = draft;
        setSavedAt(Date.now());
        setDirty(false);
      } catch {
        // network/perm error — keep dirty flag so the user knows
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, note?.id, isFinalized]);

  const { chars, words } = statsOf(draft);

  return (
    <section className="flex min-h-[640px] flex-col rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">
          Markdown · автосохранение каждые 1,5 секунды
        </span>
        <span className="inline-flex items-center gap-1.5">
          {patch.isPending || dirty ? (
            <>
              <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Сохраняем…</span>
            </>
          ) : savedAt || note?.updatedAt ? (
            <>
              <span className="inline-flex size-4 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckIcon className="size-3" />
              </span>
              <span className="text-muted-foreground">
                Сохранено · {formatSavedAt(savedAt ?? (note ? new Date(note.updatedAt).getTime() : null))}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Без изменений</span>
          )}
        </span>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={!note || isFinalized}
        placeholder={
          note
            ? "Жалобы, анамнез, статус, диагноз, назначения, рекомендации…"
            : "Откройте активный приём, чтобы начать запись."
        }
        className="flex-1 resize-none border-0 bg-transparent px-5 py-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
      />

      <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          ~ {chars.toLocaleString("ru-RU")} символов · {words.toLocaleString("ru-RU")} слов
        </span>
        {isFinalized && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Заключение зафиксировано
          </span>
        )}
      </div>
    </section>
  );
}

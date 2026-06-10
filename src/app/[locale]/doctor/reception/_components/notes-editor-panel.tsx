"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BookOpenIcon,
  CheckIcon,
  Loader2Icon,
  PrinterIcon,
  SparklesIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  composePatientHandout,
  type HandoutLocale,
} from "@/lib/catalogs/handout-composer";

import { useReceptionContext } from "../_hooks/reception-context";
import {
  pickGuideText,
  useDiagnosisGuide,
} from "../_hooks/use-diagnosis-guide";
import { usePatchVisitNote, useVisitNote } from "../_hooks/use-visit-note";
import { HandoutLibraryDrawer } from "./handout-library-drawer";

const AUTOSAVE_DEBOUNCE_MS = 1_500;

type EditorTab = "conclusion" | "handout";

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
  const t = useTranslations("doctor.reception");
  const [tab, setTab] = React.useState<EditorTab>("conclusion");

  return (
    <section className="flex min-h-[640px] flex-col rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <TabButton active={tab === "conclusion"} onClick={() => setTab("conclusion")}>
          {t("editor.tabConclusion")}
        </TabButton>
        <TabButton active={tab === "handout"} onClick={() => setTab("handout")}>
          {t("editor.tabHandout")}
        </TabButton>
      </div>

      {tab === "conclusion" ? <ConclusionEditor /> : <HandoutEditor />}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
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
      setDirty(false);
      return;
    }
    setDirty(true);
    const timer = setTimeout(async () => {
      try {
        await patch.mutateAsync({ bodyMarkdown: draft });
        lastSentRef.current = draft;
        setSavedAt(Date.now());
        setDirty(false);
      } catch {
        // keep dirty so the user sees something's wrong
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, note?.id, isFinalized]);

  const { chars, words } = statsOf(draft);

  return (
    <div className="flex flex-1 flex-col">
      <SaveStatusBar
        pending={patch.isPending || dirty}
        savedAt={savedAt}
        updatedAt={note?.updatedAt ?? null}
        label={t("editor.autosaveLabel")}
      />

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={!note || isFinalized}
        placeholder={
          note
            ? t("editor.conclusionPlaceholder")
            : t("editor.conclusionPlaceholderEmpty")
        }
        className="flex-1 resize-none border-0 bg-transparent px-5 py-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
      />

      <StatsFooter chars={chars} words={words} isFinalized={isFinalized} />
    </div>
  );
}

// ── Handout (patient-facing) ──────────────────────────────────────────

function HandoutEditor() {
  const t = useTranslations("doctor.reception");
  const rawLocale = useLocale();
  const locale: HandoutLocale = rawLocale === "uz" ? "uz" : "ru";
  const { visitNoteId, handoutAppendRequest } = useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const note = noteQuery.data ?? null;
  const isFinalized = note?.status === "FINALIZED";
  const guideQuery = useDiagnosisGuide(note?.diagnosisCode);
  const guide = guideQuery.data?.[0] ?? null;

  const [draft, setDraft] = React.useState<string>("");
  const hydratedFor = React.useRef<string | null>(null);
  const hydratedAt = React.useRef<number>(0);

  // Hydrate from the server copy whenever the note changes.
  React.useEffect(() => {
    if (!note) return;
    if (hydratedFor.current === note.id) return;
    hydratedFor.current = note.id;
    hydratedAt.current = Date.now();
    setDraft(note.patientHandoutMarkdown ?? "");
  }, [note]);

  // One-shot append channel — «Вставить в памятку» from the diagnosis guide
  // card (Ф1). Same contract as the conclusion's bodyAppendRequest.
  const lastAppendNonce = React.useRef<number>(0);
  React.useEffect(() => {
    if (!note || isFinalized) return;
    if (!handoutAppendRequest) return;
    if (handoutAppendRequest.nonce === lastAppendNonce.current) return;
    lastAppendNonce.current = handoutAppendRequest.nonce;
    setDraft((d) => {
      const sep = d.trim() ? "\n\n" : "";
      return d + sep + handoutAppendRequest.text;
    });
  }, [handoutAppendRequest, note, isFinalized]);

  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const lastSentRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!note || isFinalized) return;
    const current = note.patientHandoutMarkdown ?? "";
    if (draft === current && lastSentRef.current === null) {
      setDirty(false);
      return;
    }
    if (lastSentRef.current === draft) {
      setDirty(false);
      return;
    }
    setDirty(true);
    const timer = setTimeout(async () => {
      try {
        await patch.mutateAsync({ patientHandoutMarkdown: draft });
        lastSentRef.current = draft;
        setSavedAt(Date.now());
        setDirty(false);
      } catch {
        // surface stays dirty until next attempt
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, note?.id, isFinalized]);

  const generate = React.useCallback(() => {
    if (!note) return;
    const composed = composePatientHandout({
      locale,
      patientName: note.patient?.fullName ?? null,
      doctorName: note.doctor?.user?.name ?? null,
      doctorSpecialty:
        locale === "uz"
          ? note.doctor?.specializationUz ?? note.doctor?.specializationRu ?? null
          : note.doctor?.specializationRu ?? note.doctor?.specializationUz ?? null,
      clinicName:
        locale === "uz"
          ? note.clinic?.nameUz ?? note.clinic?.nameRu ?? null
          : note.clinic?.nameRu ?? note.clinic?.nameUz ?? null,
      visitDate: note.appointment?.date ? new Date(note.appointment.date) : new Date(),
      diagnosisName: note.diagnosisName,
      complaints: note.complaints,
      prescriptions: note.prescriptions,
      advice: note.advice,
      guide: guide
        ? {
            whatToDo: pickGuideText(locale, guide.whatToDoRu, guide.whatToDoUz),
            care: pickGuideText(locale, guide.careRu, guide.careUz),
            lifestyle: pickGuideText(locale, guide.lifestyleRu, guide.lifestyleUz),
            redFlags: pickGuideText(locale, guide.redFlagsRu, guide.redFlagsUz),
          }
        : null,
    });
    if (composed) setDraft(composed);
  }, [note, guide, locale]);

  const { chars, words } = statsOf(draft);
  const hasStructured =
    !!note &&
    ((note.complaints?.length ?? 0) > 0 ||
      (note.prescriptions?.length ?? 0) > 0 ||
      (note.advice?.length ?? 0) > 0 ||
      !!note.diagnosisName);

  const [libraryOpen, setLibraryOpen] = React.useState(false);

  const handleLibraryPick = React.useCallback(
    (bodyMd: string, mode: "APPEND" | "REPLACE") => {
      if (!bodyMd.trim()) return;
      if (mode === "REPLACE") {
        setDraft(bodyMd);
        return;
      }
      setDraft((prev) => {
        const trimmed = prev.trimEnd();
        return trimmed ? `${trimmed}\n\n${bodyMd}` : bodyMd;
      });
    },
    [],
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <SparklesIcon className="size-3.5 text-primary" />
          {t("editor.handoutComposedHint")}
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            disabled={!note || isFinalized}
            onClick={() => setLibraryOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BookOpenIcon className="size-3.5" />
            {t("editor.library")}
          </button>
          <button
            type="button"
            disabled={!note || isFinalized || !hasStructured}
            onClick={generate}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SparklesIcon className="size-3.5" />
            {draft ? t("editor.rebuild") : t("editor.build")}
          </button>
          <a
            href={
              note ? `/api/crm/visit-notes/${note.id}/print?type=handout` : "#"
            }
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!note || !draft.trim()}
            onClick={(e) => {
              if (!note || !draft.trim()) e.preventDefault();
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          >
            <PrinterIcon className="size-3.5" />
            {t("editor.print")}
          </a>
        </div>
      </div>

      <SaveStatusBar
        pending={patch.isPending || dirty}
        savedAt={savedAt}
        updatedAt={note?.updatedAt ?? null}
        label={t("editor.handoutLabel")}
      />

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={!note || isFinalized}
        placeholder={
          note
            ? hasStructured
              ? t("editor.handoutPlaceholder")
              : t("editor.handoutPlaceholderNoFields")
            : t("editor.handoutPlaceholderEmpty")
        }
        className="flex-1 resize-none border-0 bg-transparent px-5 py-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
      />

      <StatsFooter chars={chars} words={words} isFinalized={isFinalized} />

      <HandoutLibraryDrawer
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        diagnosisCode={note?.diagnosisCode ?? null}
        onPick={handleLibraryPick}
      />
    </div>
  );
}

// ── Shared bars ───────────────────────────────────────────────────────

function SaveStatusBar({
  pending,
  savedAt,
  updatedAt,
  label,
}: {
  pending: boolean;
  savedAt: number | null;
  updatedAt: string | null;
  label: string;
}) {
  const t = useTranslations("doctor.reception");
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1.5">
        {pending ? (
          <>
            <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("editor.saving")}</span>
          </>
        ) : savedAt || updatedAt ? (
          <>
            <span className="inline-flex size-4 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckIcon className="size-3" />
            </span>
            <span className="text-muted-foreground">
              {t("editor.savedAt", {
                time: formatSavedAt(
                  savedAt ?? (updatedAt ? new Date(updatedAt).getTime() : null),
                ),
              })}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{t("editor.noChanges")}</span>
        )}
      </span>
    </div>
  );
}

function StatsFooter({
  chars,
  words,
  isFinalized,
}: {
  chars: number;
  words: number;
  isFinalized: boolean;
}) {
  const t = useTranslations("doctor.reception");
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {t("editor.stats", {
          chars: chars.toLocaleString("ru-RU"),
          words: words.toLocaleString("ru-RU"),
        })}
      </span>
      {isFinalized && (
        <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("editor.finalizedBadge")}
        </span>
      )}
    </div>
  );
}

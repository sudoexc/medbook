"use client";

/**
 * Version history of a signed conclusion (audit G1-01).
 *
 * Inside the 24h window the doctor corrects the conclusion in place; the
 * server keeps every signed state as an immutable revision. This section is
 * where the clinic sees them: who signed or corrected, when, what changed,
 * the content of each version and the PDF issued for it, so the original
 * signed document can always be produced.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ChevronDownIcon, FileTextIcon, Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatPrescriptionLine,
  type PrescriptionLikeRow,
  type PrescriptionLocale,
} from "@/lib/catalogs/prescription-format";

type RevisionKind = "SIGNED" | "EDITED" | "PRE_EDIT";

type RevisionContent = {
  diagnosisCode: string | null;
  diagnosisName: string | null;
  prescriptions: string[];
  visitPrescriptions: PrescriptionLikeRow[];
  advice: string[];
  followUpDays: number | null;
  bodyMarkdown: string | null;
};

export type RevisionRow = {
  id: string;
  revision: number;
  kind: RevisionKind;
  changedFields: string[];
  content: RevisionContent;
  authorName: string | null;
  createdAt: string;
  pdfHref: string | null;
};

export const revisionsKey = (noteId: string) =>
  ["doctor", "conclusions", "revisions", noteId] as const;

function useRevisions(noteId: string, updatedAt: string) {
  return useQuery<RevisionRow[]>({
    // Keyed on the note's version too: every accepted correction writes a
    // revision, so a newer note means a longer history.
    queryKey: [...revisionsKey(noteId), updatedAt],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/visit-notes/${noteId}/revisions`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`revisions ${res.status}`);
      return ((await res.json()) as { items: RevisionRow[] }).items;
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}

/** Revision field → the label group it belongs to (several fields share one). */
const FIELD_GROUP: Record<string, string> = {
  diagnosisCode: "diagnosis",
  diagnosisName: "diagnosis",
  visitPrescriptions: "prescriptions",
  prescriptions: "prescriptions",
  advice: "advice",
  complaints: "complaints",
  anamnesis: "anamnesis",
  examination: "examination",
  bodyMarkdown: "body",
  followUpDays: "followUp",
  followUpNote: "followUp",
  patientHandoutMarkdown: "handout",
  dynamics: "dynamics",
  dynamicsNote: "dynamics",
  bodyMap: "bodyMap",
  documentNumber: "number",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RevisionsSection({
  noteId,
  updatedAt,
  locale,
}: {
  noteId: string;
  /** The note's current version; refreshes the list after a correction. */
  updatedAt: string;
  locale: string;
}) {
  const tr = useTranslations("doctor.conclusions.revisions");
  const query = useRevisions(noteId, updatedAt);
  const items = query.data ?? [];
  const [open, setOpen] = React.useState<string | null>(null);
  const rxLocale: PrescriptionLocale = locale === "uz" ? "uz" : "ru";

  // A correction with no author was made by a data fix, not by a person; a
  // PRE_EDIT row has no author of its own (it only keeps an earlier state).
  const authorOf = (r: RevisionRow): string | null =>
    r.authorName ?? (r.kind === "EDITED" ? tr("systemAuthor") : null);

  const changedLabel = (fields: string[]): string => {
    const groups = Array.from(
      new Set(fields.map((f) => FIELD_GROUP[f] ?? "other")),
    );
    return groups.map((g) => tr(`fields.${g}`)).join(", ");
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-foreground">{tr("title")}</h3>
        <p className="text-xs text-muted-foreground">{tr("hint")}</p>
      </div>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          {tr("loading")}
        </div>
      ) : query.isError ? (
        <div className="text-xs text-muted-foreground">{tr("loadError")}</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{tr("empty")}</div>
      ) : (
        <ol className="flex flex-col">
          {[...items].reverse().map((r) => {
            const expanded = open === r.id;
            const c = r.content;
            const diagnosis = [c.diagnosisCode, c.diagnosisName]
              .filter((v) => Boolean(v && v.trim()))
              .join(" · ");
            const rxLines = [
              ...(c.visitPrescriptions ?? []).map((row) =>
                formatPrescriptionLine(row, rxLocale),
              ),
              ...(c.prescriptions ?? []),
            ];
            return (
              <li
                key={r.id}
                className="border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {tr(`kind.${r.kind}`)}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {tr("number", { n: r.revision })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                      {authorOf(r) ? ` · ${authorOf(r)}` : ""}
                    </div>
                    {r.changedFields.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {tr("changed", { fields: changedLabel(r.changedFields) })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.pdfHref && (
                      <a
                        href={r.pdfHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <FileTextIcon className="size-3.5" />
                        {tr("pdf")}
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : r.id)}
                      aria-expanded={expanded}
                      className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary/5"
                    >
                      <ChevronDownIcon
                        className={cn(
                          "size-3.5 transition-transform",
                          expanded ? "" : "-rotate-90",
                        )}
                      />
                      {expanded ? tr("hide") : tr("show")}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <dl className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-background p-3 text-xs">
                    <Entry label={tr("fields.diagnosis")}>
                      {diagnosis || tr("none")}
                    </Entry>
                    <Entry label={tr("fields.prescriptions")}>
                      {rxLines.length > 0 ? (
                        <ul className="list-disc pl-4">
                          {rxLines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        tr("none")
                      )}
                    </Entry>
                    <Entry label={tr("fields.advice")}>
                      {(c.advice ?? []).length > 0 ? (
                        <ul className="list-disc pl-4">
                          {c.advice.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        tr("none")
                      )}
                    </Entry>
                    <Entry label={tr("fields.followUp")}>
                      {c.followUpDays != null
                        ? tr("followUpDays", { n: c.followUpDays })
                        : tr("none")}
                    </Entry>
                    <Entry label={tr("fields.body")}>
                      <span className="whitespace-pre-wrap">
                        {c.bodyMarkdown?.trim() || tr("none")}
                      </span>
                    </Entry>
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Entry({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="leading-relaxed text-foreground">{children}</dd>
    </div>
  );
}

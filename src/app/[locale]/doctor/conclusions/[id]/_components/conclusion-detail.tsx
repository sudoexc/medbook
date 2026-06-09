"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  CheckIcon,
  FileTextIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  PrinterIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  usePatchVisitNote,
  useVisitNote,
} from "../../../reception/_hooks/use-visit-note";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function editableWindowEndsAt(finalizedAt: string | null): number | null {
  if (!finalizedAt) return null;
  return new Date(finalizedAt).getTime() + EDIT_WINDOW_MS;
}

function formatRemaining(
  ms: number,
  tr: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (ms <= 0) return tr("detail.remainingExpired");
  const h = Math.floor(ms / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (h > 0) return tr("detail.remainingHoursMinutes", { h, m });
  return tr("detail.remainingMinutes", { m });
}

export function ConclusionDetail({
  noteId,
  locale,
}: {
  noteId: string;
  locale: string;
}) {
  const tr = useTranslations("doctor.conclusions");
  const noteQuery = useVisitNote(noteId);
  const patch = usePatchVisitNote(noteId);
  const note = noteQuery.data ?? null;

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const hydratedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!note) return;
    if (hydratedFor.current === note.id) return;
    hydratedFor.current = note.id;
    setDraft(note.bodyMarkdown ?? "");
  }, [note]);

  const isFinalized = note?.status === "FINALIZED";
  const editsEndAt = editableWindowEndsAt(note?.finalizedAt ?? null);
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!editsEndAt) return;
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [editsEndAt]);
  const canEdit = !isFinalized || (editsEndAt != null && nowTick < editsEndAt);
  const remainingMs = editsEndAt ? editsEndAt - nowTick : null;

  if (noteQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {tr("detail.loading")}
      </div>
    );
  }

  if (noteQuery.isError || !note) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        {tr("detail.loadError")}
      </div>
    );
  }

  const onSave = async () => {
    try {
      await patch.mutateAsync({ bodyMarkdown: draft });
      setEditing(false);
    } catch {
      // surface as banner if needed later
    }
  };

  const onCancel = () => {
    setDraft(note.bodyMarkdown ?? "");
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-4 xl:gap-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileTextIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {note.diagnosisCode
                ? `${note.diagnosisCode} · ${note.diagnosisName ?? ""}`
                : tr("noDiagnosis")}
            </div>
            <div className="text-xs text-muted-foreground">
              {note.status === "FINALIZED"
                ? tr("detail.finalizedAt", { date: formatDateTime(note.finalizedAt) })
                : tr("detail.statusDraft")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isFinalized && canEdit && remainingMs != null && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {tr("detail.editAvailable", { remaining: formatRemaining(remainingMs, tr) })}
            </span>
          )}
          {isFinalized && !canEdit && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <LockIcon className="size-3" />
              {tr("detail.editWindowClosed")}
            </span>
          )}
          <a
            href={`/api/crm/visit-notes/${note.id}/print?lang=${locale === "uz" ? "uz" : "ru"}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <PrinterIcon className="size-4" />
            {tr("detail.print")}
          </a>
          {note.status === "DRAFT" && (
            <Link
              href={`/${locale}/doctor/reception`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <PencilIcon className="size-4" />
              {tr("detail.openInReception")}
            </Link>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] xl:gap-5">
        <section className="flex min-h-[480px] flex-col rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs">
            <span className="font-medium text-foreground">{tr("detail.bodyHeading")}</span>
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={!canEdit}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                <PencilIcon className="size-3" />
                {canEdit ? tr("detail.edit") : tr("detail.readOnly")}
              </button>
            ) : (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={patch.isPending}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {tr("detail.cancel")}
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={patch.isPending}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {patch.isPending ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <CheckIcon className="size-3" />
                  )}
                  {tr("detail.save")}
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 resize-none border-0 bg-transparent px-5 py-4 text-sm leading-relaxed text-foreground focus:outline-none"
            />
          ) : (
            <pre
              className={cn(
                "flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 font-sans text-sm leading-relaxed text-foreground",
                !note.bodyMarkdown && "text-muted-foreground",
              )}
            >
              {note.bodyMarkdown || tr("detail.bodyEmpty")}
            </pre>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <DetailCard title={tr("detail.structuredFields")}>
            <ChipGroup label={tr("detail.complaints")} items={note.complaints} />
            <ChipGroup label={tr("detail.anamnesis")} items={note.anamnesis} />
            <ChipGroup label={tr("detail.examination")} items={note.examination} />
            <ChipGroup label={tr("detail.prescriptions")} items={note.prescriptions} />
            <ChipGroup label={tr("detail.advice")} items={note.advice} />
          </DetailCard>

          <DetailCard title={tr("detail.info")}>
            <Row k={tr("detail.patient")} v={note.patient?.fullName ?? "—"} />
            <Row k={tr("detail.startedAt")} v={formatDateTime(note.startedAt)} />
            <Row k={tr("detail.finalizedAtLabel")} v={formatDateTime(note.finalizedAt)} />
            <Row k={tr("detail.updatedAt")} v={formatDateTime(note.updatedAt)} />
            {note.aiGenerated && (
              <Row k={tr("detail.ai")} v={note.aiModel ?? tr("detail.aiGenerated")} />
            )}
          </DetailCard>
        </aside>
      </div>
    </div>
  );
}

function DetailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function ChipGroup({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-border pb-1 last:border-0">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="truncate text-xs font-medium text-foreground">{v}</span>
    </div>
  );
}

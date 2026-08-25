"use client";

import * as React from "react";
import {
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";

import { toast } from "@/components/ui/sonner";

import {
  canEditDocument,
  DOCUMENT_TYPE_LABEL_KEY,
  RenameDocumentDialog,
  ReplaceDocumentFileDialog,
} from "../../../_components/document-edit-dialogs";
import { useDoctorProfile } from "../../../settings/_hooks/use-doctor-profile";
import type { DocumentType } from "../../../documents/_hooks/use-doctor-documents";
import {
  doctorPatientDocumentsKey,
  flattenDocuments,
  useDoctorPatientDocuments,
  type DoctorPatientDocumentRow,
} from "../../_hooks/use-doctor-patient-documents";

const RU_MONTHS_SHORT = [
  "янв.",
  "февр.",
  "мар.",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

function ruDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatBytes(
  n: number | null,
  units: { b: string; kb: string; mb: string },
): string {
  if (!n) return "";
  if (n < 1024) return `${n} ${units.b}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ${units.kb}`;
  return `${(n / 1024 / 1024).toFixed(1)} ${units.mb}`;
}

export function DocumentsSection({ patientId }: { patientId: string }) {
  const t = useTranslations("doctor.patients");
  const list = useDoctorPatientDocuments(patientId);
  const rows = flattenDocuments(list.data);
  // Own uploads become editable; someone else's / rendered PDFs stay view-only.
  const profile = useDoctorProfile();
  const myUserId = profile.data?.id ?? null;
  const byteUnits = {
    b: t("documents.bytes.b"),
    kb: t("documents.bytes.kb"),
    mb: t("documents.bytes.mb"),
  };

  const sentinel = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          list.hasNextPage &&
          !list.isFetchingNextPage
        ) {
          list.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [list]);

  if (list.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {t("documents.loading")}
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-destructive">
        {t("documents.loadError")}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        {t("documents.empty")}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {rows.map((d) => (
          <DocumentRow
            key={d.id}
            doc={d}
            patientId={patientId}
            myUserId={myUserId}
            byteUnits={byteUnits}
          />
        ))}
      </ul>
      <div ref={sentinel} />
      {list.isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          {t("loadingMore")}
        </div>
      )}
    </section>
  );
}

function DocumentRow({
  doc,
  patientId,
  myUserId,
  byteUnits,
}: {
  doc: DoctorPatientDocumentRow;
  patientId: string;
  myUserId: string | null;
  byteUnits: { b: string; kb: string; mb: string };
}) {
  const t = useTranslations("doctor.patients");
  // Type labels / edit strings live in the documents namespace — reuse them
  // instead of duplicating the dictionary under doctor.patients.
  const tDocs = useTranslations("doctor.documents");
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [replaceOpen, setReplaceOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const editable = canEditDocument(doc, myUserId);

  const typeLabelKey =
    DOCUMENT_TYPE_LABEL_KEY[doc.type as DocumentType] ?? "type.other";
  const meta = [
    tDocs(typeLabelKey),
    doc.uploadedBy?.name,
    formatBytes(doc.sizeBytes, byteUnits),
  ].filter(Boolean);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: doctorPatientDocumentsKey(patientId),
    });

  const handleDelete = async () => {
    if (busy) return;
    if (!confirm(tDocs("row.deleteConfirm", { title: doc.title }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/documents/${doc.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? tDocs("edit.errorForbidden")
            : tDocs("row.deleteError", { detail: res.status }),
        );
        return;
      }
      await invalidate();
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FileTextIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {doc.title}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {ruDate(doc.createdAt)}
          {meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}
        </div>
      </div>
      <a
        href={doc.fileUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={t("documents.open")}
      >
        <DownloadIcon className="size-4" />
      </a>
      {editable ? (
        <div className="relative">
          <button
            type="button"
            aria-label={tDocs("row.moreActions")}
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                aria-label={tDocs("row.closeMenu")}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 top-9 z-20 min-w-[180px] overflow-hidden rounded-lg border border-border bg-popover py-1 text-sm shadow-md">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenameOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-foreground transition-colors hover:bg-muted"
                >
                  <PencilIcon className="size-4 text-muted-foreground" />
                  {tDocs("row.rename")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setReplaceOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-foreground transition-colors hover:bg-muted"
                >
                  <RefreshCwIcon className="size-4 text-muted-foreground" />
                  {tDocs("row.replace")}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                >
                  <Trash2Icon className="size-4" />
                  {busy ? tDocs("row.deleting") : tDocs("row.delete")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {renameOpen ? (
        <RenameDocumentDialog
          open={renameOpen}
          onClose={() => setRenameOpen(false)}
          doc={doc}
          onSaved={invalidate}
        />
      ) : null}
      {replaceOpen ? (
        <ReplaceDocumentFileDialog
          open={replaceOpen}
          onClose={() => setReplaceOpen(false)}
          doc={{ id: doc.id, title: doc.title, patientId }}
          onSaved={invalidate}
        />
      ) : null}
    </li>
  );
}

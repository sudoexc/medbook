"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { useDocumentsFilters } from "../_hooks/documents-context";
import type { DocumentType } from "../_hooks/use-doctor-documents";

type PatientLite = { id: string; fullName: string; phone: string };

const TYPES: Array<{ value: DocumentType; labelKey: string }> = [
  { value: "REFERRAL", labelKey: "type.referral" },
  { value: "PRESCRIPTION", labelKey: "type.prescription" },
  { value: "RESULT", labelKey: "type.result" },
  { value: "CONSENT", labelKey: "type.consent" },
  { value: "CONTRACT", labelKey: "type.contract" },
  { value: "RECEIPT", labelKey: "type.receipt" },
  { value: "OTHER", labelKey: "type.other" },
];

export function UploadDocumentDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("doctor.documents");
  const { filters } = useDocumentsFilters();
  const queryClient = useQueryClient();

  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<DocumentType>("RESULT");
  const [patient, setPatient] = React.useState<PatientLite | null>(null);
  const [patientQuery, setPatientQuery] = React.useState("");
  const [patientResults, setPatientResults] = React.useState<PatientLite[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset on open.
  React.useEffect(() => {
    if (open) {
      setFile(null);
      setTitle("");
      setType("RESULT");
      setPatient(null);
      setPatientQuery("");
      setPatientResults([]);
      setError(null);
    }
  }, [open]);

  // Search patients (debounced).
  React.useEffect(() => {
    if (!open) return;
    if (patient) return;
    const term = patientQuery.trim();
    if (term.length < 2) {
      setPatientResults([]);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const qs = new URLSearchParams({ q: term, limit: "10" });
        const res = await fetch(`/api/crm/doctors/me/patients?${qs.toString()}`, {
          credentials: "include",
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { rows: PatientLite[] };
        setPatientResults(data.rows ?? []);
      } catch {
        // ignore aborts
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [patientQuery, patient, open]);

  if (!open) return null;

  const canSubmit = !!file && !!patient && title.trim().length > 0;

  const handleFileChange = (f: File | null) => {
    setFile(f);
    if (f && !title.trim()) setTitle(f.name);
  };

  const handleSubmit = async () => {
    if (!file || !patient || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1) Upload bytes — server stores via uploadObject() (MinIO/S3 in prod,
      //    local stub root in dev) and returns a real `fileUrl` either way.
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientId", patient.id);
      const uploadRes = await fetch("/api/crm/documents/upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!uploadRes.ok) {
        let detail = `upload: ${uploadRes.status}`;
        try {
          const body = (await uploadRes.json()) as { error?: string };
          if (body?.error) detail = body.error;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }
      const uploaded = (await uploadRes.json()) as {
        fileUrl: string;
      };
      const fileUrl = uploaded.fileUrl;

      // 2) Persist metadata.
      const metaRes = await fetch("/api/crm/documents", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: patient.id,
          type,
          title: title.trim(),
          fileUrl,
          mimeType: file.type || null,
          sizeBytes: file.size,
        }),
      });
      if (!metaRes.ok) {
        const txt = await metaRes.text();
        throw new Error(`metadata: ${txt || metaRes.status}`);
      }

      await queryClient.invalidateQueries({
        queryKey: ["doctor", "me", "documents", filters],
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("upload.genericError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("upload.title")}</DialogTitle>
          <DialogDescription>
            {t("upload.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Patient picker */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              {t("upload.patientLabel")}
            </label>
            {patient ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {patient.fullName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground tabular-nums">
                    {patient.phone}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPatient(null)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {t("upload.change")}
                </button>
              </div>
            ) : (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder={t("upload.patientSearchPlaceholder")}
                  className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
                {patientQuery.trim().length >= 2 ? (
                  <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-popover">
                    {searching ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        {t("upload.searching")}
                      </div>
                    ) : patientResults.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        {t("upload.noPatients")}
                      </div>
                    ) : (
                      <ul>
                        {patientResults.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setPatient(p);
                                setPatientResults([]);
                                setPatientQuery("");
                              }}
                              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted"
                            >
                              <span className="text-sm font-medium text-foreground">
                                {p.fullName}
                              </span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {p.phone}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              {t("upload.typeLabel")}
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as DocumentType)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              {TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* File */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              {t("upload.fileLabel")}
            </label>
            <input
              type="file"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="block w-full cursor-pointer rounded-lg border border-dashed border-border bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:bg-muted/40"
            />
            {file ? (
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {t("upload.filePicked", {
                  name: file.name,
                  size: (file.size / 1024).toFixed(1),
                })}
              </div>
            ) : null}
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              {t("upload.titleLabel")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("upload.titlePlaceholder")}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </div>

          {error ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="min-w-0">{error}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {t("upload.retry")}
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            {t("upload.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            {submitting ? t("upload.submitting") : t("actions.upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

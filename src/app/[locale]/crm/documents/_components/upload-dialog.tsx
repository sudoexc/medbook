"use client";

/**
 * Upload dialog — multipart byte upload via `/api/crm/documents/upload`.
 *
 * Flow on submit (file mode):
 *   1. POST the File as `multipart/form-data` to `/api/crm/documents/upload`.
 *      The server stores it through `uploadObject()` (MinIO/S3 in prod, local
 *      stub root in dev) and returns a real `fileUrl` either way.
 *   2. Track XHR progress so the operator sees a live progress bar.
 *   3. POST /api/crm/documents with that `fileUrl` + metadata.
 *
 * URL mode is unchanged — the operator pastes an existing URL straight into
 * the metadata payload.
 *
 * Audit CM-05: the patient is picked by name or phone (the field used to
 * ask for the internal id «cmXXX…»), and comes pre-filled from the page's
 * `?patientId=` filter; the upload's `mimeType` and `sizeBytes` reach the
 * document (the list showed «—» for the size and the patient card could not
 * preview the file); and when saving the document fails, the stored bytes
 * are taken back instead of staying in the bucket as an orphan.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { FileIcon, UploadCloudIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { CreateDocumentSchema } from "@/server/schemas/document";
import { PatientPicker } from "@/components/appointments/new-appointment-dialog/patient-picker";
import type { PatientHit } from "@/components/appointments/new-appointment-dialog/types";

import type { DocumentType } from "../_hooks/use-documents";

const DOC_TYPES: DocumentType[] = [
  "REFERRAL",
  "PRESCRIPTION",
  "RESULT",
  "CONSENT",
  "CONTRACT",
  "RECEIPT",
  "OTHER",
];

const MAX_BYTES = 25 * 1024 * 1024; // 25MB ceiling — keeps uploads quick.

type FieldErrors = Partial<Record<"patientId" | "title" | "fileUrl", string>>;
type Mode = "file" | "url";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Take back bytes whose document was not saved. Best effort: a failure
 * here leaves the object as it was before this fix, never breaks the dialog.
 */
async function discardUpload(fileUrl: string, uploadToken: string | null): Promise<void> {
  if (!uploadToken) return;
  try {
    await fetch("/api/crm/documents/upload", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ fileUrl, uploadToken }),
    });
  } catch {
    // ignore: see above
  }
}

/** The card behind the page's `?patientId=` filter, as a picker hit. */
async function fetchPatientHit(id: string): Promise<PatientHit | null> {
  const res = await fetch(`/api/crm/patients/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  const p = (await res.json()) as {
    id: string;
    fullName: string;
    phone: string;
    phoneNormalized: string;
    phoneVerifiedAt?: string | null;
    photoUrl: string | null;
    segment: string;
  };
  return {
    id: p.id,
    fullName: p.fullName,
    phone: p.phone,
    phoneNormalized: p.phoneNormalized,
    phoneVerifiedAt: p.phoneVerifiedAt ?? null,
    photoUrl: p.photoUrl,
    segment: p.segment,
  };
}

function uploadFileWithProgress(
  patientId: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<{
  fileUrl: string;
  uploadToken: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    if (patientId) fd.append("patientId", patientId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/crm/documents/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as {
            fileUrl: string;
            uploadToken?: string | null;
            mimeType: string | null;
            sizeBytes: number | null;
          };
          resolve({ ...parsed, uploadToken: parsed.uploadToken ?? null });
        } catch {
          reject(new Error("upload.parse"));
        }
      } else {
        let detail = `upload.${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body?.error) detail = body.error;
        } catch {
          // ignore
        }
        reject(new Error(detail));
      }
    };
    xhr.onerror = () => reject(new Error("upload.network"));
    xhr.send(fd);
  });
}

export function UploadDialog({
  open,
  onOpenChange,
  onUploaded,
  initialPatientId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUploaded: () => void;
  /** The page's `?patientId=` filter: the dialog opens with that patient. */
  initialPatientId?: string;
}) {
  const t = useTranslations("docsLibrary");
  const [patient, setPatient] = React.useState<PatientHit | null>(null);
  const patientId = patient?.id ?? "";
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<DocumentType>("OTHER");
  const [file, setFile] = React.useState<File | null>(null);
  const [fileUrl, setFileUrl] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("file");
  const [progress, setProgress] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  // Pre-fill from the page filter once per opening; clearing the picker
  // afterwards keeps it clear.
  const prefilledRef = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      prefilledRef.current = false;
      return;
    }
    if (prefilledRef.current || !initialPatientId) return;
    prefilledRef.current = true;
    void fetchPatientHit(initialPatientId).then((hit) => {
      // A patient the user already picked wins over the late answer.
      if (hit) setPatient((cur) => cur ?? hit);
    });
  }, [open, initialPatientId]);

  const reset = () => {
    setPatient(null);
    setTitle("");
    setType("OTHER");
    setFile(null);
    setFileUrl("");
    setMode("file");
    setProgress(0);
    setErrors({});
  };

  const acceptFile = React.useCallback((f: File) => {
    if (f.size > MAX_BYTES) {
      toast.error(t("toastTooLarge", { max: "25 MB" }));
      return;
    }
    setFile(f);
    // Auto-fill title from filename (drop extension) when empty so the
    // operator only has to type once for most uploads.
    setTitle((current) => {
      if (current.trim()) return current;
      return f.name.replace(/\.[^.]+$/, "");
    });
  }, [t]);

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  const submit = async () => {
    setErrors({});
    // Resolve fileUrl: either a fresh presigned upload, or the URL the
    // operator pasted in `url` mode (still validated by the same schema).
    let resolvedUrl = fileUrl.trim();
    // The upload's receipt: the server attaches a stored file only with it
    // (audit CD-08). A pasted link has none and must be https.
    let uploadToken: string | null = null;
    let usedFile: File | null = null;
    let mimeType: string | null = null;
    let sizeBytes: number | null = null;
    // Bytes this attempt stored: taken back if the document is not saved.
    let storedUrl: string | null = null;

    if (mode === "file") {
      if (!file) {
        toast.error(t("toastSelectFile"));
        return;
      }
      usedFile = file;
    }

    if (!patientId || !title.trim()) {
      const fieldErrors: FieldErrors = {};
      if (!patientId) fieldErrors.patientId = t("errorRequired");
      if (!title.trim()) fieldErrors.title = t("errorRequired");
      setErrors(fieldErrors);
      toast.error(t("toastMissingFields"));
      return;
    }

    setSaving(true);
    setProgress(0);
    try {
      if (usedFile) {
        const uploaded = await uploadFileWithProgress(
          patientId,
          usedFile,
          setProgress,
        );
        resolvedUrl = uploaded.fileUrl;
        uploadToken = uploaded.uploadToken;
        mimeType = uploaded.mimeType;
        sizeBytes = uploaded.sizeBytes;
        storedUrl = uploaded.fileUrl;
      }

      const parsed = CreateDocumentSchema.safeParse({
        patientId,
        title,
        type,
        fileUrl: resolvedUrl,
        uploadToken,
        mimeType,
        sizeBytes,
      });
      if (!parsed.success) {
        if (storedUrl) void discardUpload(storedUrl, uploadToken);
        const fieldErrors: FieldErrors = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path[0];
          if (key === "patientId" || key === "title" || key === "fileUrl") {
            fieldErrors[key] = issue.message;
          }
        }
        setErrors(fieldErrors);
        toast.error(t("toastMissingFields"));
        return;
      }

      const res = await fetch("/api/crm/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        if (storedUrl) void discardUpload(storedUrl, uploadToken);
        const reason = ((await res.json().catch(() => null)) as {
          reason?: string;
        } | null)?.reason;
        toast.error(
          mode === "url" &&
            (reason === "external_url_not_https" || reason === "file_not_issued")
            ? t("toastUrlRejected")
            : t("toastUploadError"),
        );
        return;
      }
      storedUrl = null;
      reset();
      onUploaded();
    } catch (e) {
      if (storedUrl) void discardUpload(storedUrl, uploadToken);
      toast.error((e as Error).message ?? t("toastUploadError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("uploadTitle")}</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">{t("uploadHint")}</p>

        <div className="space-y-3">
          <div>
            <PatientPicker
              value={patient}
              onChangePatient={setPatient}
              label={t("columns.patient")}
              disabled={saving}
            />
            {errors.patientId ? (
              <p className="mt-1 text-xs text-destructive">{errors.patientId}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="up-title" className="mb-1 block text-xs font-medium">
              {t("columns.title")}
            </label>
            <Input
              id="up-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={!!errors.title}
            />
            {errors.title ? (
              <p className="mt-1 text-xs text-destructive">{errors.title}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="up-type" className="mb-1 block text-xs font-medium">
              {t("columns.type")}
            </label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as DocumentType)}
            >
              <SelectTrigger id="up-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((tp) => (
                  <SelectItem key={tp} value={tp}>
                    {t(`types.${tp}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="inline-flex rounded-lg bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => setMode("file")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                mode === "file"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("modeFile")}
            </button>
            <button
              type="button"
              onClick={() => setMode("url")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                mode === "url"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("modeUrl")}
            </button>
          </div>

          {mode === "file" ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) acceptFile(f);
                }}
              />
              {file ? (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <FileIcon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="motion-press inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("removeFile")}
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="up-file-pick"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                    dragOver
                      ? "border-primary bg-primary-soft"
                      : "border-border bg-muted/30 hover:bg-muted/50",
                  )}
                >
                  <UploadCloudIcon className="size-8 text-muted-foreground" />
                  <div className="text-sm font-medium text-foreground">
                    {t("dropPrompt")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("maxSizeHint", { max: "25 MB" })}
                  </div>
                </label>
              )}
              {progress > 0 && progress < 100 ? (
                <div className="mt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                    {progress}%
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div>
              <label htmlFor="up-url" className="mb-1 block text-xs font-medium">
                {t("fileUrl")}
              </label>
              <Input
                id="up-url"
                value={fileUrl}
                onChange={(e) => setFileUrl(e.target.value)}
                placeholder="https://…"
                aria-invalid={!!errors.fileUrl}
              />
              {errors.fileUrl ? (
                <p className="mt-1 text-xs text-destructive">{errors.fileUrl}</p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? t("uploading") : t("upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

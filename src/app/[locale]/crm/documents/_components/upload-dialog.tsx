"use client";

/**
 * Upload dialog — real MinIO presigned-URL upload.
 *
 * Flow on submit:
 *   1. POST /api/crm/documents/upload-url → { uploadUrl, publicUrl, stub }
 *   2. If `stub` is true (MINIO_ENDPOINT unset), surface a message and ask
 *      the operator to paste a URL manually instead of failing silently.
 *   3. Otherwise PUT the File bytes directly to the presigned URL while
 *      tracking progress via XHR (fetch can't report upload progress).
 *   4. POST /api/crm/documents with the resulting publicUrl + metadata.
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

async function requestUploadUrl(
  patientId: string,
  file: File,
): Promise<{
  uploadUrl: string | null;
  publicUrl: string | null;
  stub: boolean;
  hint?: string;
}> {
  const res = await fetch("/api/crm/documents/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      patientId: patientId || undefined,
    }),
  });
  if (!res.ok) throw new Error(`upload-url.${res.status}`);
  return (await res.json()) as {
    uploadUrl: string | null;
    publicUrl: string | null;
    stub: boolean;
    hint?: string;
  };
}

function putFileWithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`put.${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("put.network"));
    xhr.send(file);
  });
}

export function UploadDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUploaded: () => void;
}) {
  const t = useTranslations("docsLibrary");
  const [patientId, setPatientId] = React.useState("");
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

  const reset = () => {
    setPatientId("");
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
    let usedFile: File | null = null;

    if (mode === "file") {
      if (!file) {
        toast.error(t("toastSelectFile"));
        return;
      }
      usedFile = file;
    }

    if (!patientId.trim() || !title.trim()) {
      const fieldErrors: FieldErrors = {};
      if (!patientId.trim()) fieldErrors.patientId = t("errorRequired");
      if (!title.trim()) fieldErrors.title = t("errorRequired");
      setErrors(fieldErrors);
      toast.error(t("toastMissingFields"));
      return;
    }

    setSaving(true);
    setProgress(0);
    try {
      if (usedFile) {
        const { uploadUrl, publicUrl, stub, hint } = await requestUploadUrl(
          patientId,
          usedFile,
        );
        if (stub || !uploadUrl || !publicUrl) {
          toast.error(hint ?? t("toastStubMode"));
          setMode("url");
          return;
        }
        await putFileWithProgress(uploadUrl, usedFile, setProgress);
        resolvedUrl = publicUrl;
      }

      const parsed = CreateDocumentSchema.safeParse({
        patientId,
        title,
        type,
        fileUrl: resolvedUrl,
      });
      if (!parsed.success) {
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
        toast.error(t("toastUploadError"));
        return;
      }
      reset();
      onUploaded();
    } catch (e) {
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
            <label htmlFor="up-patient" className="mb-1 block text-xs font-medium">
              {t("columns.patient")} (ID)
            </label>
            <Input
              id="up-patient"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              placeholder="cmXXX..."
              aria-invalid={!!errors.patientId}
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

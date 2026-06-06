"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  PenToolIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/atoms/empty-state";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import type { Patient } from "../../_hooks/use-patient";
import {
  flattenDocuments,
  useCreateDocument,
  useDeleteDocument,
  usePatientDocumentsInfinite,
  type DocumentTypeFilter,
  type PatientDocument,
} from "../../_hooks/use-patient-documents";

const DOC_TYPES = [
  "REFERRAL",
  "PRESCRIPTION",
  "RESULT",
  "CONSENT",
  "CONTRACT",
  "RECEIPT",
  "OTHER",
] as const;

function typeIcon(type: PatientDocument["type"]) {
  if (type === "RESULT" || type === "REFERRAL")
    return <FileTextIcon className="size-4" />;
  if (type === "CONSENT" || type === "CONTRACT")
    return <PenToolIcon className="size-4" />;
  return <FileIcon className="size-4" />;
}

/**
 * Stored `fileUrl` is the raw MinIO URL (private bucket → AccessDenied on
 * direct GET) or a signature `data:` URL. Route everything stored in MinIO
 * through `/api/crm/documents/file` which streams via the internal endpoint
 * and enforces tenant scoping. We extract the canonical S3 key from
 * `/clinics/…` onwards, matching how it was written by the upload route.
 */
function downloadHref(fileUrl: string): string {
  if (fileUrl.startsWith("data:")) return fileUrl;
  const idx = fileUrl.indexOf("/clinics/");
  if (idx < 0) return fileUrl;
  const key = fileUrl.slice(idx + 1);
  return `/api/crm/documents/file?key=${encodeURIComponent(key)}`;
}

export interface DocumentsTabProps {
  patient: Patient;
}

export function DocumentsTab({ patient }: DocumentsTabProps) {
  const t = useTranslations("patientCard.documents");
  const tType = useTranslations("patientCard.documents.types");
  const locale = useLocale() as Locale;

  const [searchInput, setSearchInput] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<DocumentTypeFilter>("ALL");
  // Debounce the search input so each keystroke doesn't trigger a request.
  const [searchDebounced, setSearchDebounced] = React.useState("");
  React.useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(searchInput), 250);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const q = usePatientDocumentsInfinite(patient.id, {
    q: searchDebounced,
    type: typeFilter,
  });
  const create = useCreateDocument(patient.id);
  const remove = useDeleteDocument(patient.id);
  const [signOpen, setSignOpen] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [deleteTarget, setDeleteTarget] =
    React.useState<PatientDocument | null>(null);

  const docs = React.useMemo(() => flattenDocuments(q.data), [q.data]);
  const hasFilters = searchDebounced.trim().length > 0 || typeFilter !== "ALL";

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      toast.success(t("deleted"));
      setDeleteTarget(null);
    } catch (err) {
      const e = err as Error;
      if (e.message === "FORBIDDEN") toast.error(t("deleteForbidden"));
      else toast.error(t("deleteError"));
    }
  }, [deleteTarget, remove, t]);

  const uploadOne = React.useCallback(
    async (file: File): Promise<{
      fileUrl: string;
      mimeType: string | null;
      sizeBytes: number | null;
    }> => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientId", patient.id);
      const res = await fetch("/api/crm/documents/upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        let detail = `upload HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) detail = body.error;
        } catch {
          // ignore non-json error bodies
        }
        throw new Error(detail);
      }
      const data = (await res.json()) as {
        fileUrl: string;
        mimeType: string | null;
        sizeBytes: number | null;
      };
      return {
        fileUrl: data.fileUrl,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
      };
    },
    [patient.id],
  );

  const handleFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setUploading(true);
      try {
        for (const file of arr) {
          const uploaded = await uploadOne(file);
          await create.mutateAsync({
            patientId: patient.id,
            title: file.name,
            fileUrl: uploaded.fileUrl,
            type: "OTHER",
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.sizeBytes,
          });
        }
        toast.success(t("uploaded", { count: arr.length }));
      } catch (err) {
        const e = err as Error;
        toast.error(t("uploadError", { message: e.message }));
      } finally {
        setUploading(false);
      }
    },
    [create, patient.id, t, uploadOne],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (uploading) return;
          if (e.dataTransfer?.files) void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-card/60 p-6 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border",
          uploading && "pointer-events-none opacity-70",
        )}
      >
        <UploadCloudIcon className="size-8 text-muted-foreground" />
        <div className="text-sm font-medium">
          {uploading ? t("uploadingTitle") : t("dropzoneTitle")}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("dropzoneHint")}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <label
            className={cn(
              buttonVariants({ size: "sm" }),
              uploading ? "pointer-events-none opacity-60" : "cursor-pointer",
            )}
            aria-disabled={uploading}
          >
            <UploadCloudIcon className="size-4" />
            {uploading ? t("uploading") : t("upload")}
            <input
              type="file"
              className="hidden"
              multiple
              disabled={uploading}
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSignOpen(true)}
            disabled={uploading}
          >
            <PenToolIcon className="size-4" />
            {t("sign")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-9 max-w-xs"
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as DocumentTypeFilter)}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder={t("typeFilterPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("typeFilterAll")}</SelectItem>
            {DOC_TYPES.map((dt) => (
              <SelectItem key={dt} value={dt}>
                {tType(
                  dt.toLowerCase() as
                    | "referral"
                    | "prescription"
                    | "result"
                    | "consent"
                    | "contract"
                    | "receipt"
                    | "other",
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              setTypeFilter("ALL");
            }}
          >
            {t("clearFilters")}
          </Button>
        ) : null}
      </div>

      {q.isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          …
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileIcon />}
          title={hasFilters ? t("emptyFiltered") : t("empty")}
          description={hasFilters ? undefined : t("emptyDescription")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex gap-3 rounded-xl border border-border bg-card p-3"
            >
              <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {doc.mimeType?.startsWith("image/") ? (
                  <ImageIcon className="size-4" />
                ) : (
                  typeIcon(doc.type)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {doc.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {DOC_TYPES.includes(
                      doc.type as (typeof DOC_TYPES)[number],
                    )
                      ? tType(
                          doc.type.toLowerCase() as
                            | "referral"
                            | "prescription"
                            | "result"
                            | "consent"
                            | "contract"
                            | "receipt"
                            | "other"
                            | "signature",
                        )
                      : doc.type}
                  </span>
                  <span>·</span>
                  <span>{formatDate(doc.createdAt, locale, "short")}</span>
                </div>
                <div className="mt-2 flex gap-1">
                  {doc.fileUrl.startsWith("http") ||
                  doc.fileUrl.startsWith("/api/") ||
                  doc.fileUrl.startsWith("data:") ? (
                    <a
                      href={downloadHref(doc.fileUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                      )}
                    >
                      <DownloadIcon className="size-3" />
                      {t("download")}
                    </a>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <DownloadIcon className="size-3" />
                      {t("download")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(doc)}
                    aria-label={t("deleteAria")}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {q.hasNextPage ? (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? "…" : t("loadMore")}
          </Button>
        </div>
      ) : null}

      <SignaturePadDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        onSave={async (dataUrl) => {
          await create.mutateAsync({
            patientId: patient.id,
            title: `Signature-${new Date().toISOString().slice(0, 10)}.png`,
            fileUrl: dataUrl,
            type: "CONSENT",
            mimeType: "image/png",
          });
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription", { name: deleteTarget?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("deleteCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending ? t("deleting") : t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Minimal signature pad using native <canvas>. Saves PNG as base64 data URL. */
function SignaturePadDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (dataUrl: string) => Promise<void>;
}) {
  const t = useTranslations("patientCard.documents.signature");
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = React.useState(false);
  const [hasInk, setHasInk] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const clear = React.useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    setHasInk(false);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const c = canvasRef.current;
    if (!c) return;
    c.width = c.offsetWidth * 2;
    c.height = c.offsetHeight * 2;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(2, 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, [open]);

  const pointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border border-border bg-white">
          <canvas
            ref={canvasRef}
            className="block h-[220px] w-full cursor-crosshair touch-none"
            onPointerDown={(e) => {
              setDrawing(true);
              const p = pointer(e);
              const ctx = canvasRef.current?.getContext("2d");
              if (!ctx) return;
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (!drawing) return;
              const p = pointer(e);
              const ctx = canvasRef.current?.getContext("2d");
              if (!ctx) return;
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
              setHasInk(true);
            }}
            onPointerUp={() => setDrawing(false)}
            onPointerLeave={() => setDrawing(false)}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <DialogFooter>
          <Button variant="outline" onClick={clear}>
            {t("clear")}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!hasInk || saving}
            onClick={async () => {
              const c = canvasRef.current;
              if (!c) return;
              setSaving(true);
              try {
                const dataUrl = c.toDataURL("image/png");
                await onSave(dataUrl);
                onOpenChange(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

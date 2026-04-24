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
import { EmptyState } from "@/components/atoms/empty-state";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { Patient } from "../../_hooks/use-patient";
import {
  useCreateDocument,
  usePatientDocuments,
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

export interface DocumentsTabProps {
  patient: Patient;
}

export function DocumentsTab({ patient }: DocumentsTabProps) {
  const t = useTranslations("patientCard.documents");
  const tType = useTranslations("patientCard.documents.types");
  const locale = useLocale() as Locale;

  const q = usePatientDocuments(patient.id);
  const create = useCreateDocument(patient.id);
  const [signOpen, setSignOpen] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const docs = q.data?.rows ?? [];

  const handleFiles = React.useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      // Phase 4 will do the MinIO upload here. For now we persist metadata
      // only with a placeholder fileUrl so the card acquires a real row.
      Promise.all(
        arr.map((file) =>
          create.mutateAsync({
            patientId: patient.id,
            title: file.name,
            fileUrl: `pending://${encodeURIComponent(file.name)}`,
            type: "OTHER",
            mimeType: file.type || null,
            sizeBytes: file.size ?? null,
          }),
        ),
      )
        .then(() =>
          toast.success(
            t("uploadStub", { count: arr.length }),
          ),
        )
        .catch(() => {
          /* useCreateDocument already toasts */
        });
    },
    [create, patient.id, t],
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
          if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-card/60 p-6 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <UploadCloudIcon className="size-8 text-muted-foreground" />
        <div className="text-sm font-medium">{t("dropzoneTitle")}</div>
        <div className="text-xs text-muted-foreground">
          {t("dropzoneHint")}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <label
            className={cn(
              buttonVariants({ size: "sm" }),
              "cursor-pointer",
            )}
          >
            <UploadCloudIcon className="size-4" />
            {t("upload")}
            <input
              type="file"
              className="hidden"
              multiple
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <Button size="sm" variant="outline" onClick={() => setSignOpen(true)}>
            <PenToolIcon className="size-4" />
            {t("sign")}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("noFile")}
        </p>
      </div>

      {docs.length === 0 ? (
        <EmptyState
          icon={<FileIcon />}
          title={t("empty")}
          description={t("emptyDescription")}
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
                  {doc.fileUrl.startsWith("http") ? (
                    <a
                      href={doc.fileUrl}
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
                    onClick={() => toast.info(t("deleteSoon"))}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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

"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BanIcon,
  DownloadIcon,
  EyeIcon,
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
import { Textarea } from "@/components/ui/textarea";
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
  DialogDescription,
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

import {
  canVoidDocument,
  documentDeleteLock,
  isPatientDocument,
  isVoidedDocument,
} from "@/lib/document-guards";
import { uploadDocumentFile } from "@/lib/document-upload-client";
import { tashkentToday } from "@/lib/tashkent-time";

import type { Patient } from "../../_hooks/use-patient";
import { useCurrentRole } from "../../_hooks/use-current-role";
import {
  documentDownloadHref,
  flattenDocuments,
  useCreateDocument,
  useDeleteDocument,
  usePatientDocumentsInfinite,
  usePendingConsents,
  useSaveSignature,
  useVoidDocument,
  type DocumentTypeFilter,
  type PatientDocument,
  type SaveSignatureError,
} from "../../_hooks/use-patient-documents";
import { IssuedFormsSection } from "./issued-forms-section";
import {
  DocumentPreviewDialog,
  type DocumentPreviewTarget,
} from "../document-preview-dialog";

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
  const saveSignature = useSaveSignature(patient.id);
  const voidDocument = useVoidDocument(patient.id);
  // CD-09: a signed record is never deleted; ADMIN voids a misfiled one.
  // Cosmetic: the void route answers 403 to anyone else.
  const canVoid = useCurrentRole() === "ADMIN";
  const [voidTarget, setVoidTarget] = React.useState<PatientDocument | null>(
    null,
  );
  const [voidReason, setVoidReason] = React.useState("");
  const [signOpen, setSignOpen] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [deleteTarget, setDeleteTarget] =
    React.useState<PatientDocument | null>(null);
  const [previewTarget, setPreviewTarget] =
    React.useState<DocumentPreviewTarget | null>(null);

  const openDocumentPreview = React.useCallback((d: PatientDocument) => {
    if (!d.fileUrl) return;
    setPreviewTarget({
      id: d.id,
      title: d.title,
      seq: d.seq,
      previewUrl: documentDownloadHref(d.fileUrl),
      mimeType: d.mimeType,
    });
  }, []);

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
      else if (e.message === "LOCKED") toast.error(t("deleteLocked"));
      else toast.error(t("deleteError"));
    }
  }, [deleteTarget, remove, t]);

  const confirmVoid = React.useCallback(async () => {
    const reason = voidReason.trim();
    if (!voidTarget || reason.length < VOID_REASON_MIN) return;
    try {
      await voidDocument.mutateAsync({ documentId: voidTarget.id, reason });
      toast.success(t("voided"));
      setVoidTarget(null);
      setVoidReason("");
    } catch {
      toast.error(t("voidError"));
    }
  }, [voidDocument, voidReason, voidTarget, t]);

  const uploadOne = React.useCallback(
    (file: File) => uploadDocumentFile(file, patient.id),
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
            uploadToken: uploaded.uploadToken,
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
            {/* Not an upload type, but the chart's most common document
                (audit CD-17); the list API accepts it as a filter. */}
            <SelectItem value="CONCLUSION">{tType("conclusion")}</SelectItem>
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
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                    #{doc.seq}
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {doc.title}
                  </span>
                  {/* CD-06: a patient's own upload is unverified, whatever
                      type it carries. */}
                  {isPatientDocument(doc) ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      {t("patientBadge")}
                    </span>
                  ) : null}
                  {/* CD-09: a voided record no longer counts as signed. */}
                  {isVoidedDocument(doc) ? (
                    <span
                      title={
                        doc.voidReason
                          ? t("voidedReason", { reason: doc.voidReason })
                          : undefined
                      }
                      className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive"
                    >
                      {t("voidedBadge")}
                    </span>
                  ) : doc.signedAt ? (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                      {t("signedBadge")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {doc.type === "CONCLUSION"
                      ? tType("conclusion")
                      : DOC_TYPES.includes(
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
                  <span>
                    {formatDate(doc.createdAt, locale, "dayMonthTime")}
                  </span>
                </div>
                <div className="mt-2 flex gap-1">
                  {doc.fileUrl.startsWith("http") ||
                  doc.fileUrl.startsWith("/api/") ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openDocumentPreview(doc)}
                      >
                        <EyeIcon className="size-3" />
                        {t("preview")}
                      </Button>
                      <a
                        href={`${documentDownloadHref(doc.fileUrl)}&download=1`}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                        )}
                      >
                        <DownloadIcon className="size-3" />
                        {t("download")}
                      </a>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <DownloadIcon className="size-3" />
                      {t("download")}
                    </Button>
                  )}
                  {/* CD-09: conclusions, referral PDFs and signed consents
                      are legal records; the API refuses to delete them. */}
                  {documentDeleteLock(doc) ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(doc)}
                      aria-label={t("deleteAria")}
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  )}
                  {canVoid && canVoidDocument(doc) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setVoidReason("");
                        setVoidTarget(doc);
                      }}
                      aria-label={t("voidAria")}
                      title={t("voidAria")}
                    >
                      <BanIcon className="size-3" />
                    </Button>
                  ) : null}
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

      <IssuedFormsSection patientId={patient.id} />

      <SignaturePadDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        patientId={patient.id}
        onSave={async ({ canvas, consent }) => {
          await saveSignature.mutateAsync({
            canvas,
            title: consent
              ? // Room for the prefix inside the 300-character title.
                t("signature.docTitleFor", { title: consent.title.slice(0, 280) })
              : t("signature.docTitle", {
                  date: formatDate(new Date(), locale, "short"),
                }),
            fileName: `signature-${tashkentToday()}.png`,
            signsDocumentId: consent?.id ?? null,
          });
        }}
      />

      <DocumentPreviewDialog
        open={previewTarget !== null}
        onOpenChange={(v) => {
          if (!v) setPreviewTarget(null);
        }}
        target={previewTarget}
      />

      <Dialog
        open={voidTarget !== null}
        onOpenChange={(v) => !v && setVoidTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("voidTitle", { name: voidTarget?.title ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("voidHint")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder={t("voidReasonPlaceholder")}
            aria-label={t("voidReasonPlaceholder")}
            rows={3}
            maxLength={500}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVoidTarget(null)}
              disabled={voidDocument.isPending}
            >
              {t("voidBack")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmVoid()}
              disabled={
                voidReason.trim().length < VOID_REASON_MIN ||
                voidDocument.isPending
              }
            >
              {t("voidConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

/**
 * Minimal signature pad using native <canvas>. The PNG is uploaded as a file
 * (CD-05). Picking one of the patient's unsigned consents files it as that
 * consent's signature, and both become signed records. With none picked it
 * is filed as «Прочее», unsigned and deletable, and the dialog says so: a
 * bare signature is not a signed consent. The canvas is drawn at 1x: the
 * signature is a record, not artwork, and a 2x bitmap only doubled the
 * upload.
 */
function SignaturePadDialog({
  open,
  onOpenChange,
  patientId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  onSave: (input: {
    canvas: HTMLCanvasElement;
    consent: PatientDocument | null;
  }) => Promise<void>;
}) {
  const t = useTranslations("patientCard.documents.signature");
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = React.useState(false);
  const [hasInk, setHasInk] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [consentId, setConsentId] = React.useState<string>(NO_CONSENT);
  const pending = usePendingConsents(patientId, open);
  const consents = pending.data ?? [];

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
    setConsentId(NO_CONSENT);
    setHasInk(false);
    const c = canvasRef.current;
    if (!c) return;
    c.width = c.offsetWidth;
    c.height = c.offsetHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return;
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
        {consents.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {t("consentLabel")}
            </span>
            <Select value={consentId} onValueChange={setConsentId}>
              <SelectTrigger className="h-9" aria-label={t("consentLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONSENT}>{t("consentNone")}</SelectItem>
                {consents.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
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
        {consentId === NO_CONSENT && pending.isSuccess ? (
          <p className="text-xs text-muted-foreground">
            {consents.length === 0 ? `${t("noPendingConsents")} ` : null}
            {t("hintUnbound")}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={clear} disabled={saving}>
            {t("clear")}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("cancel")}
          </Button>
          <Button
            disabled={!hasInk || saving}
            onClick={async () => {
              const c = canvasRef.current;
              if (!c) return;
              setSaving(true);
              try {
                await onSave({
                  canvas: c,
                  consent: consents.find((d) => d.id === consentId) ?? null,
                });
                toast.success(t("saved"));
                onOpenChange(false);
              } catch (err) {
                // The dialog stays open with the drawing, so a retry does
                // not ask the patient to sign again.
                const e = err as SaveSignatureError;
                toast.error(
                  e.reason === "consent_not_signable"
                    ? t("errorConsent")
                    : t("error"),
                );
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

/** Select value for «not tied to a consent»: filed as «Прочее», unsigned. */
const NO_CONSENT = "__new";

/** Same floor as the void route's schema. */
const VOID_REASON_MIN = 3;

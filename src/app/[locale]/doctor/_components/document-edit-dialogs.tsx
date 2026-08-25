"use client";

/**
 * Shared edit dialogs for *uploaded* patient documents (rename / replace
 * file). Used from two places — the /doctor/documents table and the
 * "Документы" tab on the patient card — so they live in the cabinet-level
 * _components folder rather than inside either page.
 *
 * CONCLUSION documents and worker-rendered PDFs (visitNoteId/referralId set)
 * are read-only: the server rejects PATCH for them, and callers use
 * `canEditDocument` to not render the buttons in the first place.
 */

import * as React from "react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

import type { DocumentType } from "../documents/_hooks/use-doctor-documents";

/** Full label map — includes CONCLUSION so rendered handouts display right. */
export const DOCUMENT_TYPE_LABEL_KEY: Record<DocumentType, string> = {
  REFERRAL: "type.referral",
  PRESCRIPTION: "type.prescription",
  RESULT: "type.result",
  CONCLUSION: "type.conclusion",
  CONSENT: "type.consent",
  CONTRACT: "type.contract",
  RECEIPT: "type.receipt",
  OTHER: "type.other",
};

/** Types a doctor may assign by hand — CONCLUSION is worker-only. */
export const EDITABLE_DOCUMENT_TYPES: Array<{
  value: Exclude<DocumentType, "CONCLUSION">;
  labelKey: string;
}> = [
  { value: "REFERRAL", labelKey: "type.referral" },
  { value: "PRESCRIPTION", labelKey: "type.prescription" },
  { value: "RESULT", labelKey: "type.result" },
  { value: "CONSENT", labelKey: "type.consent" },
  { value: "CONTRACT", labelKey: "type.contract" },
  { value: "RECEIPT", labelKey: "type.receipt" },
  { value: "OTHER", labelKey: "type.other" },
];

export type EditableDocumentCheck = {
  type: string;
  uploadedById?: string | null;
  /** `uploadedBy.id` where the API returns the relation instead of the FK. */
  uploadedBy?: { id: string } | null;
  visitNoteId?: string | null;
  referralId?: string | null;
};

/**
 * Mirror of the server-side PATCH/DELETE guards so the UI never shows a
 * button the API would reject: doctor edits only their own uploads, and
 * rendered documents (conclusions, referral PDFs) are never editable.
 */
export function canEditDocument(
  doc: EditableDocumentCheck,
  myUserId: string | null | undefined,
): boolean {
  if (!myUserId) return false;
  if (doc.type === "CONCLUSION") return false;
  if (doc.visitNoteId || doc.referralId) return false;
  const ownerId = doc.uploadedById ?? doc.uploadedBy?.id ?? null;
  return ownerId === myUserId;
}

/**
 * Map a failed PATCH response to a human message. The server speaks in error
 * codes; the doctor should read plain language, not "409 conflict".
 */
async function patchErrorMessage(
  res: Response,
  t: (key: string) => string,
): Promise<string> {
  let code: string | null = null;
  try {
    const body = (await res.json()) as { error?: string };
    code = body?.error ?? null;
  } catch {
    // Non-JSON body — fall through to the generic message.
  }
  if (code === "ReadOnlyRenderedDocument") return t("edit.errorReadOnly");
  if (res.status === 403) return t("edit.errorForbidden");
  return t("edit.errorGeneric");
}

async function patchDocument(
  id: string,
  patch: Record<string, unknown>,
): Promise<Response> {
  return fetch(`/api/crm/documents/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

// ---------------------------------------------------------------------------
// Rename (title + type)
// ---------------------------------------------------------------------------

export function RenameDocumentDialog({
  open,
  onClose,
  doc,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  doc: { id: string; title: string; type: string };
  onSaved: () => void;
}) {
  const t = useTranslations("doctor.documents");
  const [title, setTitle] = React.useState(doc.title);
  const [type, setType] = React.useState(doc.type);
  const [submitting, setSubmitting] = React.useState(false);

  // Re-seed the form each time the dialog opens for a (possibly different) row.
  React.useEffect(() => {
    if (open) {
      setTitle(doc.title);
      setType(doc.type);
    }
  }, [open, doc.title, doc.type]);

  if (!open) return null;

  const canSubmit = title.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await patchDocument(doc.id, {
        title: title.trim(),
        type,
      });
      if (!res.ok) {
        toast.error(await patchErrorMessage(res, t));
        return;
      }
      toast.success(t("edit.renamed"));
      onSaved();
      onClose();
    } catch {
      toast.error(t("edit.errorGeneric"));
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("edit.renameTitle")}</DialogTitle>
          <DialogDescription>{t("edit.renameDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              {t("edit.titleLabel")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              {t("edit.typeLabel")}
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              {EDITABLE_DOCUMENT_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            {t("edit.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? t("edit.saving") : t("edit.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Replace file
// ---------------------------------------------------------------------------

export function ReplaceDocumentFileDialog({
  open,
  onClose,
  doc,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  doc: { id: string; title: string; patientId: string };
  onSaved: () => void;
}) {
  const t = useTranslations("doctor.documents");
  const [file, setFile] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setFile(null);
  }, [open]);

  if (!open) return null;

  const canSubmit = !!file && !submitting;

  const handleSubmit = async () => {
    if (!file || submitting) return;
    setSubmitting(true);
    try {
      // 1) Upload the new bytes first (same flow as the upload dialog). If the
      //    PATCH below fails, the fresh blob is orphaned — acceptable, same
      //    trade-off the create flow makes; the row never points at nothing.
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientId", doc.patientId);
      const uploadRes = await fetch("/api/crm/documents/upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!uploadRes.ok) {
        toast.error(t("edit.uploadError"));
        return;
      }
      const uploaded = (await uploadRes.json()) as {
        fileUrl: string;
        mimeType: string | null;
        sizeBytes: number;
      };

      // 2) Point the document row at the new file; the server deletes the
      //    old blob after a successful update.
      const res = await patchDocument(doc.id, {
        fileUrl: uploaded.fileUrl,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
      });
      if (!res.ok) {
        toast.error(await patchErrorMessage(res, t));
        return;
      }
      toast.success(t("edit.replaced"));
      onSaved();
      onClose();
    } catch {
      toast.error(t("edit.errorGeneric"));
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("edit.replaceTitle")}</DialogTitle>
          <DialogDescription>
            {t("edit.replaceDescription", { title: doc.title })}
          </DialogDescription>
        </DialogHeader>

        <div>
          <label className="mb-1 block text-xs font-semibold text-foreground">
            {t("edit.fileLabel")}
          </label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full cursor-pointer rounded-lg border border-dashed border-border bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:bg-muted/40"
          />
          {file ? (
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {t("edit.filePicked", {
                name: file.name,
                size: (file.size / 1024).toFixed(1),
              })}
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
            {t("edit.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? t("edit.replacing") : t("edit.replace")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

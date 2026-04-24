"use client";

/**
 * Upload dialog — metadata-only stub. Phase 6 will replace the `fileUrl`
 * input with a real MinIO presigned upload flow.
 */
import * as React from "react";
import { useTranslations } from "next-intl";

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
  const [fileUrl, setFileUrl] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const submit = async () => {
    if (!patientId || !title || !fileUrl) {
      toast.error(t("toastMissingFields"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/crm/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          patientId,
          title,
          type,
          fileUrl,
        }),
      });
      if (!res.ok) {
        toast.error(t("toastUploadError"));
        return;
      }
      setPatientId("");
      setTitle("");
      setType("OTHER");
      setFileUrl("");
      onUploaded();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            />
          </div>
          <div>
            <label htmlFor="up-title" className="mb-1 block text-xs font-medium">
              {t("columns.title")}
            </label>
            <Input
              id="up-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
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
          <div>
            <label htmlFor="up-url" className="mb-1 block text-xs font-medium">
              File URL
            </label>
            <Input
              id="up-url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
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
            {saving ? "…" : t("upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

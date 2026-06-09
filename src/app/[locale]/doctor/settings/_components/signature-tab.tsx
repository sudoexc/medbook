"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ImageIcon,
  Loader2Icon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";

import {
  useDoctorProfile,
  useRemoveDoctorSignature,
  useSetDoctorSignature,
} from "../_hooks/use-doctor-profile";

const MAX_BYTES = 1_024 * 1_024; // 1 MB
const ACCEPTED = "image/png,image/jpeg";

async function uploadSignature(file: File): Promise<{ fileUrl: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/crm/documents/upload", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    let detail = `upload: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return (await res.json()) as { fileUrl: string };
}

export function SignatureTab() {
  const t = useTranslations("doctor.settings");
  const profile = useDoctorProfile();
  const setSignature = useSetDoctorSignature();
  const removeSignature = useRemoveDoctorSignature();

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const signatureUrl = profile.data?.signatureUrl ?? null;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("signature.errorFormat"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("signature.errorTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadSignature(file);
      await setSignature.mutateAsync(uploaded.fileUrl);
      toast.success(t("signature.saved"));
    } catch (e) {
      toast.error(t("signature.uploadError"));
      console.error(e);
    } finally {
      setUploading(false);
    }
  };

  const onPick = () => inputRef.current?.click();
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = ""; // reset so the same file can be re-selected
  };
  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  if (profile.isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <Skeleton className="h-40 w-full max-w-md" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-1 text-sm font-semibold text-foreground">
        {t("signature.heading")}
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        {t("signature.subheading")}
      </p>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_auto] md:items-start">
        <label
          htmlFor="signature-file"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 text-center transition-colors",
            dragOver && "border-primary bg-primary/5",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          <input
            ref={inputRef}
            id="signature-file"
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={onChange}
          />
          {uploading ? (
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <UploadIcon className="size-6 text-muted-foreground" />
          )}
          <div className="text-sm font-medium text-foreground">
            {uploading ? t("signature.uploading") : t("signature.dropzone")}
          </div>
          <div className="text-xs text-muted-foreground">{t("signature.formatHint")}</div>
        </label>

        <div className="flex flex-col items-stretch gap-2 md:w-56">
          <div className="flex h-44 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30 p-2">
            {signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={signatureUrl}
                alt={t("signature.currentAlt")}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                <ImageIcon className="size-5" />
                {t("signature.empty")}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onPick}
              disabled={uploading}
            >
              {signatureUrl ? t("signature.replace") : t("signature.upload")}
            </Button>
            {signatureUrl ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  removeSignature.mutate(undefined, {
                    onSuccess: () => toast.success(t("signature.removed")),
                    onError: () => toast.error(t("signature.removeError")),
                  });
                }}
                disabled={removeSignature.isPending}
                aria-label={t("signature.removeAria")}
              >
                <Trash2Icon className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

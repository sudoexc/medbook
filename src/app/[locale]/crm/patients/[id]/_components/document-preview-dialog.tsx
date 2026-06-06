"use client";

/**
 * Inline document preview — the user-facing "Посмотреть" action.
 *
 * Why a modal instead of `<a target="_blank">`:
 *   - For PDFs, Chrome's "Always download" content setting can hijack a
 *     plain `<a href=…pdf>` and trigger Save-As even with
 *     `Content-Disposition: inline`. The preview button then becomes
 *     indistinguishable from the download button — the exact complaint
 *     ("предпросмотр не отличается от скачивания").
 *   - An `<iframe>` reliably renders the PDF inside the page via the
 *     browser's built-in viewer regardless of that setting, because the
 *     fetch happens through the embed pipeline, not the download
 *     pipeline.
 *   - For images we render a plain `<img>` so the preview is instant
 *     and respects the dialog's max-height.
 *
 * Fallback: for unknown/unsupported mime types we surface the
 * download CTA in the dialog body. No surprise downloads when the user
 * asked for a preview.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { DownloadIcon, ExternalLinkIcon, FileIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type DocumentPreviewTarget = {
  id: string;
  title: string;
  /** Per-patient sequence (`#1` oldest, `#N` newest). */
  seq: number;
  /** Already-resolved URL (e.g. via `documentDownloadHref`). */
  previewUrl: string;
  mimeType: string | null;
};

export interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DocumentPreviewTarget | null;
}

/** PDF: same URL works as iframe source (Chromium / Firefox / WebKit). */
function isPdf(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime === "application/pdf" || mime === "application/x-pdf";
}

function isImage(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("image/");
}

/**
 * Attach `&download=1` (or `?download=1` when no query is present) so the
 * stream route flips `Content-Disposition` to `attachment`. `data:` URLs
 * have no server to hint at, so we pass them through unchanged — the
 * browser handles the save itself.
 */
function withDownloadFlag(url: string): string {
  if (url.startsWith("data:")) return url;
  return url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
}

export function DocumentPreviewDialog({
  open,
  onOpenChange,
  target,
}: DocumentPreviewDialogProps) {
  const t = useTranslations("patientCard.documents");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] max-h-[900px] w-[min(100vw-2rem,1100px)] max-w-none flex-col gap-3 p-3 sm:max-w-none"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <DialogTitle className="truncate">
              {target ? (
                <>
                  <span className="mr-1.5 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                    #{target.seq}
                  </span>
                  {target.title}
                </>
              ) : (
                t("previewDialogTitle")
              )}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/40">
          {target ? <PreviewBody target={target} /> : null}
        </div>

        <DialogFooter className="px-1 pb-0 sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center justify-start">
            {target ? (
              <a
                href={target.previewUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                )}
              >
                <ExternalLinkIcon className="size-3.5" />
                {t("previewOpenInTab")}
              </a>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {target ? (
              <a
                href={withDownloadFlag(target.previewUrl)}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                )}
              >
                <DownloadIcon className="size-3.5" />
                {t("download")}
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("previewClose")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ target }: { target: DocumentPreviewTarget }) {
  const t = useTranslations("patientCard.documents");

  if (isImage(target.mimeType)) {
    return (
      // `object-contain` keeps the aspect ratio inside the modal's flex slot,
      // and `bg-checkerboard` (via inline gradient) helps users see the bounds
      // of transparent PNGs/signature images.
      <div className="flex h-full w-full items-center justify-center overflow-auto bg-background">
        {/* The MinIO stream is an auth-scoped, opaque binary; next/image's
            optimizer doesn't apply (no public CDN URL to cache + auth-bound
            requests). A plain <img> is the correct primitive here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={target.previewUrl}
          alt={target.title}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (isPdf(target.mimeType)) {
    return (
      // `#toolbar=1` is a Chromium hint that surfaces the built-in PDF toolbar
      // even in tight containers. `#view=FitH` zooms the document to the
      // iframe width so users don't have to scroll horizontally first.
      <iframe
        src={`${target.previewUrl}#toolbar=1&view=FitH`}
        title={target.title}
        className="size-full"
      />
    );
  }

  // Unknown / unsupported mime — explain rather than silently downloading.
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <FileIcon className="size-10 text-muted-foreground/60" />
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("previewUnsupported")}
      </p>
    </div>
  );
}

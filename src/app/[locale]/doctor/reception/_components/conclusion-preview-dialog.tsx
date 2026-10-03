"use client";

/**
 * «Предпросмотр» of the conclusion sheet, in a dialog.
 *
 * It used to be a toggle on the conclusion editor in the middle column. The
 * editor went (clinic request 03.10.2026) and the sheet is now composed
 * from the visit's fields alone (diagnoses, prescriptions, advice, control
 * visit, plus any text an older note or a protocol template carries), but
 * the doctor still wants to see the sheet before he signs it. Same print
 * route in an iframe (`?embed=1`: no print toolbar, no audit noise), keyed
 * by `updatedAt` so it redraws after every save.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConclusionPreviewDialog({
  open,
  onOpenChange,
  noteId,
  updatedAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  updatedAt: string;
}) {
  const t = useTranslations("doctor.reception");
  const tDialogs = useTranslations("doctor.receptionDialogs");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A flex column instead of the dialog's default grid, and a width of
          its own: the sheet needs the room, and on a phone it fills the
          screen minus the 16px gutters. */}
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(92dvh,64rem)] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <DialogHeader className="min-w-0 flex-1 gap-0.5">
            <DialogTitle className="text-base font-semibold">
              {t("actionBar.previewTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t("actionBar.previewHint")}
            </DialogDescription>
          </DialogHeader>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={tDialogs("actions.close")}
            title={tDialogs("actions.close")}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        {open ? (
          <iframe
            key={`${noteId}:${updatedAt}`}
            src={`/api/crm/visit-notes/${noteId}/print?embed=1`}
            title={t("actionBar.previewTitle")}
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

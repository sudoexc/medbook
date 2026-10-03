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
 *
 * It is also where a template's text can be taken out again (review of
 * 03.10.2026): with the editor gone, the text a protocol or a preset put in
 * the conclusion is seen only here. Each template the text holds is named
 * above the sheet with «Убрать текст шаблона», which goes through the same
 * channel that wrote it (conclusion-template-channel.tsx). That channel
 * lives on the visit tab, so the offer does too.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { WandSparklesIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { templatesInBody, type BodyTemplate } from "@/lib/conclusion-body";
import { visitDiagnosisCodes } from "@/lib/visit-diagnoses";

import { useReceptionContext } from "../_hooks/reception-context";
import { useVisitProtocols } from "../_hooks/use-clinical-protocols";
import { useDoctorPresets } from "../_hooks/use-doctor-presets";
import { useVisitNote } from "../_hooks/use-visit-note";

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
        {open ? <TemplatesInText noteId={noteId} updatedAt={updatedAt} /> : null}
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

/**
 * The templates the conclusion text holds, each with «Убрать текст
 * шаблона». The candidates are the protocols of the visit's diagnoses and
 * the doctor's presets with a note template: the only things that write
 * into the text from the visit screen.
 */
function TemplatesInText({
  noteId,
  updatedAt,
}: {
  noteId: string;
  updatedAt: string;
}) {
  const t = useTranslations("doctor.reception");
  const locale = useLocale();
  const { activeTab, requestBodyRemove } = useReceptionContext();
  const note = useVisitNote(noteId).data ?? null;
  const editable = !!note && note.status !== "FINALIZED" && activeTab === "session";
  const codes = editable ? visitDiagnosisCodes(note) : [];
  const protocols = useVisitProtocols(codes);
  const presets = useDoctorPresets().data;
  // Clicked since the last save: the button waits for the body to change
  // (or for the failed save's refetch) instead of sending it twice.
  const [clicked, setClicked] = React.useState<{ at: string; texts: string[] }>({
    at: updatedAt,
    texts: [],
  });
  const pending = clicked.at === updatedAt ? clicked.texts : [];

  if (!editable) return null;
  const candidates: BodyTemplate[] = [
    ...protocols.map((p) => ({
      name: (locale === "uz" && p.nameUz) || p.nameRu,
      text: p.conclusionTemplateMd ?? "",
    })),
    ...(presets ?? []).map((p) => ({ name: p.label, text: p.noteTemplate ?? "" })),
  ];
  const found = templatesInBody(note.bodyMarkdown ?? "", candidates);
  if (found.length === 0) return null;

  return (
    <ul className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/40 px-4 py-3">
      {found.map((tpl) => (
        <li key={tpl.text} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-[15px] text-foreground">
            <WandSparklesIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words">
              {t("actionBar.templateInText", { name: tpl.name })}
            </span>
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4 text-sm"
            disabled={pending.includes(tpl.text)}
            onClick={() => {
              setClicked({ at: updatedAt, texts: [...pending, tpl.text] });
              requestBodyRemove(tpl.text);
            }}
          >
            <XIcon className="size-4" />
            {t("actionBar.removeTemplateText")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

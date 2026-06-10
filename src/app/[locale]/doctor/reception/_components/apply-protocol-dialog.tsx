"use client";

/**
 * Phase G2 / Ф3 — protocol apply dialog.
 *
 * Shows the protocol's full bundle (complaints/anamnesis/exam/prescriptions/
 * advice + recommended labs + conclusion preview) before the doctor commits.
 * Ф3: structured `prescriptionItems` render via the shared line formatter;
 * the legacy free-text lines show only when there are no structured items —
 * mirroring the apply semantics. On confirm: merges each template array into
 * the corresponding visit-note field (preserving existing chips, no
 * duplicates), appends structured rows to the prescription constructor, and
 * appends the conclusion markdown to the editor body.
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarClockIcon,
  CheckIcon,
  ClipboardListIcon,
  FileTextIcon,
  PillIcon,
  ScrollTextIcon,
  SparklesIcon,
  StethoscopeIcon,
  TestTube2Icon,
  WandSparklesIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";

import {
  protocolItemToDraft,
  type ClinicalProtocolRow,
} from "../_hooks/use-clinical-protocols";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  protocol: ClinicalProtocolRow | null;
  onApply: (protocol: ClinicalProtocolRow) => void;
};

export function ApplyProtocolDialog({
  open,
  onOpenChange,
  protocol,
  onApply,
}: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const locale = useLocale() === "uz" ? "uz" : "ru";
  if (!protocol) return null;

  const items = protocol.prescriptionItems ?? [];
  const itemLines = items.map((it) =>
    formatPrescriptionLine(protocolItemToDraft(it), locale),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="px-5 pb-3 pt-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SparklesIcon className="size-4" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">{protocol.nameRu}</DialogTitle>
              {protocol.summaryRu ? (
                <DialogDescription className="text-xs">
                  {protocol.summaryRu}
                </DialogDescription>
              ) : (
                <DialogDescription className="text-xs">
                  {t("applyProtocol.fallbackSummary")}
                </DialogDescription>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                {protocol.diagnosisCodePrefix}
              </span>
              {protocol.doctorId ? (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {t("applyProtocol.scopePersonal")}
                </span>
              ) : protocol.clinicId ? (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {t("applyProtocol.scopeClinic")}
                </span>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto border-y px-5 py-3 text-xs">
          <PreviewSection
            Icon={ClipboardListIcon}
            label={t("applyProtocol.sections.complaints")}
            items={protocol.complaintsTemplate}
          />
          <PreviewSection
            Icon={ScrollTextIcon}
            label={t("applyProtocol.sections.anamnesis")}
            items={protocol.anamnesisTemplate}
          />
          <PreviewSection
            Icon={StethoscopeIcon}
            label={t("applyProtocol.sections.examination")}
            items={protocol.examinationTemplate}
          />
          {itemLines.length > 0 ? (
            <PreviewSection
              Icon={PillIcon}
              label={t("applyProtocol.sections.rxItems")}
              items={itemLines}
              hint={t("applyProtocol.rxItemsHint")}
            />
          ) : (
            <PreviewSection
              Icon={PillIcon}
              label={t("applyProtocol.sections.prescriptions")}
              items={protocol.prescriptionsTemplate}
            />
          )}
          <PreviewSection
            Icon={WandSparklesIcon}
            label={t("applyProtocol.sections.advice")}
            items={protocol.adviceTemplate}
          />
          {protocol.recommendedLabs.length > 0 ? (
            <PreviewSection
              Icon={TestTube2Icon}
              label={t("applyProtocol.sections.recommendedLabs")}
              items={protocol.recommendedLabs}
              hint={t("applyProtocol.labsHint")}
            />
          ) : null}
          {protocol.followUpDays ? (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              <CalendarClockIcon className="size-3" />
              {t("applyProtocol.followUp", { days: protocol.followUpDays })}
            </div>
          ) : null}
          {protocol.conclusionTemplateMd ? (
            <div>
              <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                <FileTextIcon className="size-3" />
                {t("applyProtocol.conclusionAddendum")}
              </div>
              <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-sans text-[11px] leading-snug text-muted-foreground">
                {protocol.conclusionTemplateMd}
              </pre>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 px-5 py-3">
          <p className="text-[11px] text-muted-foreground">
            {t("applyProtocol.footerHint")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t("actions.cancel")}
            </Button>
            <Button size="sm" onClick={() => onApply(protocol)}>
              <CheckIcon className="mr-1 size-3.5" />
              {t("actions.apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewSection({
  Icon,
  label,
  items,
  hint,
}: {
  Icon: typeof ClipboardListIcon;
  label: string;
  items: string[];
  hint?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
        <Icon className="size-3" />
        {label}
        <span className="rounded-md bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
          {items.length}
        </span>
      </div>
      <ul className="space-y-0.5 text-muted-foreground">
        {items.map((it) => (
          <li key={it} className="flex gap-1.5">
            <span className="select-none text-foreground/40">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
      {hint ? (
        <p className="mt-0.5 text-[10px] italic text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarPlusIcon,
  DownloadIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { Patient } from "../_hooks/use-patient";
import { useCurrentRole } from "../_hooks/use-current-role";
import { TelegramInviteDialog } from "./telegram-invite-dialog";

export interface PatientQuickActionsProps {
  patient: Patient;
  onOpenSmsDialog: () => void;
  onOpenDeleteDialog: () => void;
  onOpenNewAppointmentDialog: () => void;
}

/**
 * Quick actions bar. The "Позвонить" action uses a `tel:` URL as a first-pass
 * integration — the real TelephonyAdapter lands in Phase 3c.
 *
 * Telegram is only a direct inbox jump once we have a conversation for this
 * patient (Phase 3b). Until then, we toast with an explanatory message.
 */
export function PatientQuickActions({
  patient,
  onOpenSmsDialog,
  onOpenDeleteDialog,
  onOpenNewAppointmentDialog,
}: PatientQuickActionsProps) {
  const t = useTranslations("patientCard.quickActions");
  const locale = useLocale();
  const role = useCurrentRole();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const [exporting, setExporting] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const phoneHref = patient.phone
    ? `tel:${patient.phone.replace(/\s/g, "")}`
    : "#";

  const onExportData = React.useCallback(
    async (deliverToPatient: boolean) => {
      if (exporting) return;
      setExporting(true);
      try {
        const res = await fetch(
          `/api/crm/patients/${encodeURIComponent(patient.id)}/data-export`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ deliverToPatient }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          jobId?: string;
          error?: string;
        };
        if (!res.ok) {
          if (body.error === "no_telegram_chat") {
            toast.error(t("exportNoTelegramChat"));
          } else {
            toast.error(t("exportError"));
          }
          return;
        }
        toast.success(t("exportSuccess"));
      } catch {
        toast.error(t("exportError"));
      } finally {
        setExporting(false);
      }
    },
    [exporting, patient.id, t],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
      <Button size="sm" onClick={onOpenNewAppointmentDialog}>
        <CalendarPlusIcon className="size-4" />
        {t("newAppointment")}
      </Button>
      <a
        href={phoneHref}
        className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
      >
        <PhoneIcon className="size-4" />
        {t("call")}
      </a>
      <Button size="sm" variant="outline" onClick={onOpenSmsDialog}>
        <MessageSquareIcon className="size-4" />
        {t("sms")}
      </Button>
      {patient.telegramUsername || patient.telegramId ? (
        <Link
          href={`/${locale}/crm/telegram?patientId=${encodeURIComponent(patient.id)}`}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          <SendIcon className="size-4" />
          {t("telegram")}
        </Link>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setInviteOpen(true)}
        >
          <SendIcon className="size-4" />
          {t("telegram")}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="outline" aria-label={t("more")}>
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => toast.info(t("mergeDuplicatesSoon"))}
          >
            {t("mergeDuplicates")}
          </DropdownMenuItem>
          {/* Phase 17 Wave 3 — DSAR data export, ADMIN only. */}
          {isAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={exporting}
                onClick={() => onExportData(true)}
              >
                <DownloadIcon className="size-4" />
                {t("exportDataToPatient")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={exporting}
                onClick={() => onExportData(false)}
              >
                <DownloadIcon className="size-4" />
                {t("exportDataToAdmin")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onOpenDeleteDialog}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2Icon className="size-4" />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TelegramInviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        patientId={patient.id}
      />
    </div>
  );
}

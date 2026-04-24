"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarPlusIcon,
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

  const phoneHref = patient.phone
    ? `tel:${patient.phone.replace(/\s/g, "")}`
    : "#";

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
          onClick={() => toast.info(t("inviteToBot"))}
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
    </div>
  );
}

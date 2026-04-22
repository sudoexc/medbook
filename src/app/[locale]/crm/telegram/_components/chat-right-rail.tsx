"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlusIcon,
  ExternalLinkIcon,
  Loader2Icon,
  UserIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/atoms/empty-state";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { PhoneText } from "@/components/atoms/phone-text";
import { DateText } from "@/components/atoms/date-text";
import { MoneyText } from "@/components/atoms/money-text";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import type { InboxConversation } from "../_hooks/types";
import { conversationsKey } from "../_hooks/use-conversations";

export interface ChatRightRailProps {
  conversation: InboxConversation | null;
}

type PatientDetails = {
  id: string;
  fullName: string;
  phone: string;
  photoUrl: string | null;
  segment: string | null;
  balance: number | bigint | null;
  lifetimeSpend: number | bigint | null;
  lastVisitAt: string | null;
  appointments?: Array<{
    id: string;
    date: string;
  }>;
};

/**
 * Right rail on the inbox. Three shapes:
 *  1. No conversation → empty-state.
 *  2. Conversation without linked patient → "Create patient" mini form.
 *  3. Linked patient → preview card + quick actions.
 *
 * The Create Patient form is intentionally minimal — fullName + phone.
 * Operators who need more fields can jump to the patient card after
 * creation. Once created, the conversation is attached via PATCH so the
 * next refetch shows the linked state.
 */
export function ChatRightRail({ conversation }: ChatRightRailProps) {
  const t = useTranslations("tgInbox.rail");
  const locale = useLocale();

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={<UserIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </div>
    );
  }

  if (!conversation.patientId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <CreatePatientForm conversation={conversation} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <LinkedPatientCard
        conversation={conversation}
        locale={locale}
        t={t}
      />
    </div>
  );
}

function LinkedPatientCard({
  conversation,
  locale,
  t,
}: {
  conversation: InboxConversation;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const detailsQuery = useQuery<PatientDetails>({
    queryKey: ["patient-mini", conversation.patientId],
    queryFn: async () => {
      const res = await fetch(`/api/crm/patients/${conversation.patientId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      return (await res.json()) as PatientDetails;
    },
    enabled: Boolean(conversation.patientId),
    staleTime: 30_000,
  });

  const p = detailsQuery.data;
  const displayName =
    p?.fullName ?? conversation.patient?.fullName ?? t("anonymous");
  const phone = p?.phone ?? conversation.patient?.phone ?? null;
  const photo = p?.photoUrl ?? conversation.patient?.photoUrl ?? null;
  const lastVisit =
    p?.lastVisitAt ??
    p?.appointments?.find((a) => new Date(a.date) < new Date())?.date ??
    null;

  return (
    <div className="flex flex-col">
      {/* Header card */}
      <div className="flex flex-col items-center gap-3 border-b border-border bg-muted/20 p-4 text-center">
        <AvatarWithStatus name={displayName} src={photo} size="lg" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{displayName}</div>
          {phone ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              <PhoneText phone={phone} />
            </div>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2">
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="w-full"
          >
            <CalendarPlusIcon className="size-3" />
            {t("newAppointment")}
          </Button>
          <Link
            href={`/${locale}/crm/patients/${conversation.patientId}`}
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "w-full",
            )}
          >
            <ExternalLinkIcon className="size-3" />
            {t("openPatient")}
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <dl className="divide-y divide-border text-xs">
        {detailsQuery.isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        ) : (
          <>
            {p?.segment ? (
              <RailRow label={t("segment")}>
                <span className="font-medium">{p.segment}</span>
              </RailRow>
            ) : null}
            <RailRow label={t("balance")}>
              <MoneyText amount={p?.balance ?? 0} currency="UZS" />
            </RailRow>
            <RailRow label={t("lifetimeSpend")}>
              <MoneyText amount={p?.lifetimeSpend ?? 0} currency="UZS" />
            </RailRow>
            <RailRow label={t("lastVisit")}>
              {lastVisit ? (
                <DateText date={lastVisit} style="short" />
              ) : (
                <span className="text-muted-foreground">{t("never")}</span>
              )}
            </RailRow>
            {conversation.assignedTo ? (
              <RailRow label={t("assignedTo")}>
                <span>{conversation.assignedTo.name}</span>
              </RailRow>
            ) : null}
            {conversation.tags.length > 0 ? (
              <RailRow label={t("tags")}>
                <div className="flex flex-wrap justify-end gap-1">
                  {conversation.tags.map((tg) => (
                    <span
                      key={tg}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px]"
                    >
                      {tg}
                    </span>
                  ))}
                </div>
              </RailRow>
            ) : null}
          </>
        )}
      </dl>

      <NewAppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={conversation.patientId}
        onCreated={() => {
          setDialogOpen(false);
          toast.success(t("appointmentCreated"));
        }}
      />
    </div>
  );
}

function RailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function CreatePatientForm({
  conversation,
}: {
  conversation: InboxConversation;
}) {
  const t = useTranslations("tgInbox.rail");
  const qc = useQueryClient();

  const [fullName, setFullName] = React.useState("");
  const [phone, setPhone] = React.useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!fullName.trim()) {
        throw new Error("NAME_REQUIRED");
      }
      if (!phone.trim()) {
        throw new Error("PHONE_REQUIRED");
      }
      const res = await fetch(`/api/crm/patients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          source: "TELEGRAM",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const patient = (await res.json()) as { id: string };

      const patchRes = await fetch(
        `/api/crm/conversations/${conversation.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ patientId: patient.id }),
        },
      );
      if (!patchRes.ok) {
        throw new Error(`Link failed: ${patchRes.status}`);
      }
      return patient;
    },
    onSuccess: () => {
      toast.success(t("patientCreated"));
      void qc.invalidateQueries({ queryKey: ["tg-conversations"] });
      void qc.invalidateQueries({
        queryKey: conversationsKey({ q: "", mode: "all", unreadOnly: false }),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Create failed");
    },
  });

  return (
    <div className="space-y-4">
      <EmptyState
        icon={<UserPlusIcon />}
        title={t("noPatientTitle")}
        description={t("noPatientDescription")}
      />
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="tg-new-patient-name" className="text-xs">
            {t("fullNameLabel")}
          </Label>
          <Input
            id="tg-new-patient-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("fullNamePlaceholder")}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tg-new-patient-phone" className="text-xs">
            {t("phoneLabel")}
          </Label>
          <Input
            id="tg-new-patient-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+998 ..."
            className="h-8"
          />
        </div>
        <Button
          onClick={() => create.mutate()}
          disabled={
            create.isPending || fullName.trim() === "" || phone.trim() === ""
          }
          size="sm"
          className="w-full"
        >
          {create.isPending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <UserPlusIcon className="size-3" />
          )}
          {t("createPatient")}
        </Button>
      </div>
    </div>
  );
}

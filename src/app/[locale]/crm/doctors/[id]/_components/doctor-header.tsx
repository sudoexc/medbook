"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  CalendarPlusIcon,
  DoorOpenIcon,
  StarIcon,
  StethoscopeIcon,
  TicketIcon,
  Trash2Icon,
  UserCheckIcon,
  UserMinusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentRole } from "@/app/[locale]/crm/patients/[id]/_hooks/use-current-role";

import { usePatchDoctor, type DoctorDetail } from "../_hooks/use-doctor";
import { CabinetPickerDialog } from "./cabinet-picker-dialog";
import { TicketPrefixDialog } from "./ticket-prefix-dialog";

function parseRating(r: DoctorDetail["rating"]): number | null {
  if (r === null || r === undefined) return null;
  const n = typeof r === "string" ? Number(r) : Number(r);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface DoctorHeaderProps {
  doctor: DoctorDetail;
  onNewAppointment: () => void;
}

export function DoctorHeader({ doctor, onNewAppointment }: DoctorHeaderProps) {
  const t = useTranslations("crmDoctors");
  const locale = useLocale();
  const role = useCurrentRole();
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const spec = locale === "uz" ? doctor.specializationUz : doctor.specializationRu;
  const bio = locale === "uz" ? doctor.bioUz : doctor.bioRu;
  const rating = parseRating(doctor.rating);
  const cabinetName =
    doctor.cabinet
      ? (locale === "uz" ? doctor.cabinet.nameUz : doctor.cabinet.nameRu) ??
        null
      : null;
  const [cabinetOpen, setCabinetOpen] = React.useState(false);
  const [prefixOpen, setPrefixOpen] = React.useState(false);
  const patch = usePatchDoctor(doctor.id);

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
      <div className="flex items-start gap-4">
        <AvatarWithStatus
          src={doctor.photoUrl}
          name={name}
          size="xl"
          status={doctor.isActive ? "online" : "offline"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-foreground">
              {name}
            </h1>
            {!doctor.isActive ? (
              <Badge variant="muted">{t("profile.inactive")}</Badge>
            ) : null}
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
              style={{ color: doctor.color }}
              aria-label="color"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: doctor.color }}
              />
              {doctor.color}
            </span>
            {doctor.cabinet ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                <DoorOpenIcon className="size-3.5" />
                <span className="font-medium text-foreground">
                  {t("profile.cabinetLabel")} № {doctor.cabinet.number}
                </span>
                {cabinetName ? <span>· {cabinetName}</span> : null}
              </span>
            ) : null}
            {/* The letter on this doctor's queue tickets (Q-12): reception
                and the board tell the doctors' tickets apart by it. */}
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
              <TicketIcon className="size-3.5" />
              <span className="font-medium text-foreground">
                {doctor.ticketPrefix
                  ? t("profile.ticketPrefixLabel", { prefix: doctor.ticketPrefix })
                  : t("profile.ticketPrefixUnset")}
              </span>
            </span>
          </div>
          <div
            className={cn(
              "mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1">
              <StethoscopeIcon className="size-4" />
              {spec}
            </span>
            {rating !== null ? (
              <span className="inline-flex items-center gap-1">
                <StarIcon className="size-4 fill-warning text-warning" />
                <span className="font-medium text-foreground">
                  {rating.toFixed(1)}
                </span>
                <span>
                  · {t("profile.reviewsShort", { count: doctor.reviewCount })}
                </span>
              </span>
            ) : null}
          </div>
          {bio ? (
            <p className="mt-3 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">
              {bio}
            </p>
          ) : (
            <p className="mt-3 text-xs italic text-muted-foreground">
              {t("profile.bioEmpty")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2">
          <Button onClick={onNewAppointment} disabled={!doctor.isActive}>
            <CalendarPlusIcon className="size-4" />
            {t("newAppointment")}
          </Button>
          {role === "ADMIN" || role === "SUPER_ADMIN" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCabinetOpen(true)}
              >
                <DoorOpenIcon className="size-4" />
                {t("profile.cabinetChange")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPrefixOpen(true)}
              >
                <TicketIcon className="size-4" />
                {t("profile.ticketPrefixChange")}
              </Button>
              <Button
                variant={doctor.isActive ? "outline" : "default"}
                size="sm"
                disabled={patch.isPending}
                onClick={() => {
                  if (
                    doctor.isActive &&
                    !window.confirm(t("profile.deactivateConfirm"))
                  ) {
                    return;
                  }
                  patch.mutate(
                    { isActive: !doctor.isActive },
                    {
                      onSuccess: () =>
                        toast.success(
                          doctor.isActive
                            ? t("profile.deactivated")
                            : t("profile.activated"),
                        ),
                    },
                  );
                }}
              >
                {doctor.isActive ? (
                  <UserMinusIcon className="size-4" />
                ) : (
                  <UserCheckIcon className="size-4" />
                )}
                {doctor.isActive
                  ? t("profile.deactivate")
                  : t("profile.activate")}
              </Button>
              {/* Permanent delete is offered only for a doctor already taken
                  out of service — it is the exit for a row created by
                  mistake, never a shortcut past deactivation. The server
                  refuses when any clinical history exists. */}
              {!doctor.isActive ? <PurgeDoctorButton doctor={doctor} /> : null}
            </>
          ) : null}
        </div>
      </div>
      {role === "ADMIN" || role === "SUPER_ADMIN" ? (
        <>
          <CabinetPickerDialog
            open={cabinetOpen}
            onOpenChange={setCabinetOpen}
            doctorId={doctor.id}
            currentCabinetId={doctor.cabinetId}
          />
          <TicketPrefixDialog
            open={prefixOpen}
            onOpenChange={setPrefixOpen}
            doctorId={doctor.id}
            current={doctor.ticketPrefix}
          />
        </>
      ) : null}
    </section>
  );
}

/**
 * «Удалить навсегда» — the exit for a doctor row that should never have
 * existed (typo, test entry, a hire who never started). Everything with
 * clinical history is refused by the server with the counts, which we show
 * verbatim: the admin then knows deactivation is the only correct tool.
 */
function PurgeDoctorButton({ doctor }: { doctor: DoctorDetail }) {
  const t = useTranslations("crmDoctors");
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const purge = async () => {
    // Prefer whichever name is actually filled: `nameUz` is required by the
    // schema but may be an empty string, which would leave a UZ-locale admin
    // confirming an empty surname.
    const localised = locale === "uz" ? doctor.nameUz : doctor.nameRu;
    const name = (localised?.trim() || doctor.nameRu?.trim() || "").trim();
    // Typing the surname is the same guard the patient delete uses: a
    // permanent delete must never be one stray click away.
    const surname = name.split(/\s+/)[0] ?? "";
    if (!surname) {
      toast.error(t("profile.purgeFailed"));
      return;
    }
    const answer = window.prompt(t("profile.purgeConfirm", { surname }), "");
    if (answer === null) return;
    // Uzbek Latin surnames carry the modifier letter in «Gʻafurov» /
    // «Oʻrazov» (U+02BB), which nobody types — every keyboard produces an
    // ASCII quote or a typographic one. Cyrillic ё/е is the same class of
    // trap. Compare on a folded form so the confirmation is about intent,
    // not about hitting the exact codepoint.
    const fold = (v: string) =>
      v
        .trim()
        .toLowerCase()
        .replace(/[\u02bb\u02bc\u2018\u2019`']/g, "'")
        .replace(/ё/g, "е");
    if (fold(answer) !== fold(surname)) {
      toast.error(t("profile.purgeSurnameMismatch"));
      return;
    }

    setPending(true);
    try {
      const res = await fetch(`/api/crm/doctors/${doctor.id}?purge=true`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          reason?: string;
          blockers?: { appointments: number; visitNotes: number };
        } | null;
        if (j?.reason === "doctor_has_history") {
          toast.error(
            t("profile.purgeHasHistory", {
              appointments: j.blockers?.appointments ?? 0,
              notes: j.blockers?.visitNotes ?? 0,
            }),
            { duration: 10_000 },
          );
          return;
        }
        toast.error(t("profile.purgeFailed"));
        return;
      }
      toast.success(t("profile.purged"));
      router.push(`/${locale}/crm/doctors`);
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={purge}
      className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
    >
      <Trash2Icon className="size-4" />
      {t("profile.purge")}
    </Button>
  );
}

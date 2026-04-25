"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlusIcon, StarIcon, StethoscopeIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { DoctorDetail } from "../_hooks/use-doctor";

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
  const name = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const spec = locale === "uz" ? doctor.specializationUz : doctor.specializationRu;
  const bio = locale === "uz" ? doctor.bioUz : doctor.bioRu;
  const rating = parseRating(doctor.rating);

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
        <div className="shrink-0">
          <Button onClick={onNewAppointment} disabled={!doctor.isActive}>
            <CalendarPlusIcon className="size-4" />
            {t("newAppointment")}
          </Button>
        </div>
      </div>
    </section>
  );
}

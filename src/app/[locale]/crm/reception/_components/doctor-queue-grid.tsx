"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { StethoscopeIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/atoms/empty-state";
import { SkeletonCard } from "@/components/atoms/skeleton-card";

import { DoctorQueueCard } from "./doctor-queue-card";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorRef } from "../_hooks/use-reception-live";

export interface DoctorQueueGridProps {
  doctors: DoctorRef[];
  appointmentsByDoctor: Map<string, AppointmentRow[]>;
  isLoading: boolean;
  onRowClick: (appointmentId: string) => void;
  className?: string;
}

/**
 * Responsive grid of `DoctorQueueCard`s (TZ §6.1.3, screen #1).
 *
 * Columns scale with viewport width:
 *   1280–1439 : 2 columns
 *   1440–1679 : 3 columns
 *   1680+     : 4 columns
 *
 * Doctors who have at least one appointment today are shown first; completely
 * idle doctors follow so the receptionist can still hand off a walk-in.
 */
export function DoctorQueueGrid({
  doctors,
  appointmentsByDoctor,
  isLoading,
  onRowClick,
  className,
}: DoctorQueueGridProps) {
  const t = useTranslations("reception.doctorQueue");

  const sorted = React.useMemo(() => {
    const withCount = doctors.map((d) => ({
      doctor: d,
      count: appointmentsByDoctor.get(d.id)?.length ?? 0,
    }));
    withCount.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.doctor.nameRu.localeCompare(b.doctor.nameRu);
    });
    return withCount;
  }, [doctors, appointmentsByDoctor]);

  if (isLoading && doctors.length === 0) {
    return (
      <div
        className={cn(
          "grid gap-3",
          "grid-cols-1 sm:grid-cols-2 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]",
          className,
        )}
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonCard key={i} className="h-[280px]" />
        ))}
      </div>
    );
  }

  const visible = sorted.filter(
    ({ count, doctor }) => count > 0 || doctor.isActive,
  );

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<StethoscopeIcon />}
        title={t("emptyTitle")}
        description={t("emptyHint")}
      />
    );
  }

  return (
    <div
      aria-label={t("title")}
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "grid gap-3",
        "grid-cols-1 sm:grid-cols-2 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]",
        className,
      )}
    >
      {visible.map(({ doctor }) => (
        <DoctorQueueCard
          key={doctor.id}
          doctor={doctor}
          appointments={appointmentsByDoctor.get(doctor.id) ?? []}
          onRowClick={onRowClick}
        />
      ))}
    </div>
  );
}

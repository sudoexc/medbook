"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { MessageSquareIcon, StarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/atoms/empty-state";

/**
 * Doctor reviews tab.
 *
 * The `Review` model in `prisma/schema.prisma` (Phase 0) is tied to patients
 * and not to doctors. Until a `/api/crm/doctors/[id]/reviews` aggregation
 * endpoint exists (TODO for api-builder), this renders an informative empty
 * state so the tab is still discoverable.
 */
export interface DoctorReviewsProps {
  doctorId: string;
  className?: string;
}

export function DoctorReviews({ doctorId, className }: DoctorReviewsProps) {
  const t = useTranslations("crmDoctors.reviews");
  // Reference `doctorId` so lint doesn't complain — future endpoint will need it.
  void doctorId;

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>
      <EmptyState
        icon={<MessageSquareIcon />}
        title={t("empty")}
        description={
          <span className="inline-flex items-center gap-1">
            <StarIcon className="size-3.5" />
            {t("todoHint")}
          </span>
        }
      />
    </section>
  );
}

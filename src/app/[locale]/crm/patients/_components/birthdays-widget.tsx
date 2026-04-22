"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { GiftIcon } from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { formatDate, type Locale } from "@/lib/format";

import type { PatientsStats } from "../_hooks/use-patients-stats";

export interface BirthdaysWidgetProps {
  stats: PatientsStats | undefined;
  isLoading: boolean;
}

export function BirthdaysWidget({ stats, isLoading }: BirthdaysWidgetProps) {
  const t = useTranslations("patients.widgets");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const list = stats?.birthdays ?? [];

  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <GiftIcon className="size-3.5" />
        {t("birthdaysTitle")}
      </h4>
      {isLoading ? (
        <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
          …
        </div>
      ) : list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("birthdaysEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((b) => {
            const relative =
              b.daysUntil === 0
                ? t("today")
                : t("inDays", { days: b.daysUntil });
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/${locale}/crm/patients/${b.id}`)}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60 focus:bg-muted focus:outline-none"
                >
                  <AvatarWithStatus
                    size="sm"
                    name={b.fullName}
                    src={b.photoUrl ?? undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">
                      {b.fullName}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {formatDate(b.birthDate, locale, "short")} · {relative}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

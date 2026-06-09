"use client";

/**
 * P1.2 — patient lab-results screen (Mini App).
 *
 * Lists the patient's REVIEWED lab results. Each card leads with the value
 * tinted by its flag tone and a coloured flag pill, so "out of range" reads
 * at a glance; the reference range + who reviewed it + when sit underneath.
 * The server already filters to REVIEWED, so nothing un-vetted can surface.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";

import { MCard, MEmpty, MSection } from "./mini-ui";
import { SkeletonList } from "./skeleton";
import { useLang, useT } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { getLabFlagTone } from "./mini-app-tokens";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useLabs, type MiniAppLabResult } from "../_hooks/use-labs";
import { formatDate } from "@/lib/format";

function LabCard({ lab }: { lab: MiniAppLabResult }) {
  const t = useT();
  const lang = useLang();
  const flag = lab.flag;
  const tone = flag ? getLabFlagTone(flag) : null;

  const meta: string[] = [];
  if (lab.reviewedAt) {
    meta.push(
      t.labs.reviewedOn.replace(
        "{date}",
        formatDate(lab.reviewedAt, lang === "UZ" ? "uz" : "ru", "dayMonthTime"),
      ),
    );
  }
  if (lab.doctorName) meta.push(lab.doctorName);

  return (
    <MCard className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-semibold">{lab.testName}</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span
              className="text-lg font-bold tabular-nums"
              style={{ color: tone ? tone.label : "var(--tg-text)" }}
            >
              {lab.value}
            </span>
            {lab.unit ? (
              <span className="text-sm" style={{ color: "var(--tg-hint)" }}>
                {lab.unit}
              </span>
            ) : null}
          </div>
        </div>
        {flag && tone ? (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: tone.tint, color: tone.label }}
          >
            {t.labs.flags[flag]}
          </span>
        ) : null}
      </div>
      {lab.refRange ? (
        <div className="text-xs" style={{ color: "var(--tg-hint)" }}>
          {t.labs.refRange.replace("{range}", lab.refRange)}
        </div>
      ) : null}
      {meta.length > 0 ? (
        <div className="text-xs" style={{ color: "var(--tg-hint)" }}>
          {meta.join(" · ")}
        </div>
      ) : null}
    </MCard>
  );
}

export function LabsScreen() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const query = useLabs();

  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
  }, [tg, router, clinicSlug]);

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t.labs.title}</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--tg-hint)" }}>
        {t.labs.subtitle}
      </p>
      {query.isLoading ? (
        <SkeletonList rows={4} variant="card" />
      ) : query.isError ? (
        <MEmpty>{t.common.error}</MEmpty>
      ) : query.data && query.data.length > 0 ? (
        <MSection>
          {query.data.map((lab) => (
            <LabCard key={lab.id} lab={lab} />
          ))}
        </MSection>
      ) : (
        <MEmpty icon={FlaskConical}>{t.labs.empty}</MEmpty>
      )}
    </div>
  );
}

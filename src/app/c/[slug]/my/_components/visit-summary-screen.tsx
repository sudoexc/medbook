"use client";

/**
 * Wave 3c — «Что сказал врач» (Mini App).
 *
 * Renders the FINALIZED VisitNote in patient language: diagnosis, the
 * doctor-composed handout (tiny markdown subset via `parseHandoutBlocks`),
 * follow-up CTA and the conclusion PDF link. While the note is still DRAFT
 * the server returns `summary: null` and we show a "готовится" placeholder —
 * the patient typically lands here right after the visit from the home hero.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, FileText, Hourglass } from "lucide-react";

import {
  parseHandoutBlocks,
  type HandoutBlock,
} from "@/server/visit-notes/render-handout";
import { MButton, MCard, MEmpty, MSpinner, formatDateISO } from "./mini-ui";
import { useT, useLang } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useActiveContext } from "../_hooks/use-active-context";
import { useBookingDraft } from "../_hooks/use-booking-draft";
import { useVisitSummary } from "../_hooks/use-visit-summary";

function renderItalic(text: string, keyPrefix: string): React.ReactNode[] {
  const re = /(^|[\s(])_([^_]+)_(?=$|[\s.,;:!?)])/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    out.push(<em key={`${keyPrefix}-i${i}`}>{m[2]}</em>);
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** `**bold**` / `_italic_` → React nodes (escaping-free: no innerHTML). */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const re = /\*\*([^*]+)\*\*/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      out.push(...renderItalic(text.slice(last, m.index), `${keyPrefix}-t${i}`));
    }
    out.push(
      <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) {
    out.push(...renderItalic(text.slice(last), `${keyPrefix}-tail`));
  }
  return out;
}

function HandoutBlocks({ blocks }: { blocks: HandoutBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, idx) => {
        if (b.kind === "h1") {
          return (
            <h2 key={idx} className="pt-1 text-base font-bold">
              {renderInline(b.text, `h1-${idx}`)}
            </h2>
          );
        }
        if (b.kind === "h2") {
          return (
            <h3
              key={idx}
              className="pt-1 text-sm font-semibold"
              style={{ color: "var(--tg-accent)" }}
            >
              {renderInline(b.text, `h2-${idx}`)}
            </h3>
          );
        }
        if (b.kind === "bullets") {
          return (
            <ul key={idx} className="space-y-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2 text-sm leading-relaxed">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: "var(--tg-accent)" }}
                  />
                  <span>{renderInline(item, `b-${idx}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx} className="text-sm leading-relaxed">
            {renderInline(b.text, `p-${idx}`)}
          </p>
        );
      })}
    </div>
  );
}

export function VisitSummaryScreen({ appointmentId }: { appointmentId: string }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { clinicSlug, initData } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const { onBehalfOf } = useActiveContext();
  const { setDraft } = useBookingDraft(clinicSlug);

  const query = useVisitSummary(appointmentId, onBehalfOf);

  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
  }, [tg, router, clinicSlug]);
  React.useEffect(() => {
    return tg.setMainButton({ visible: false });
  }, [tg]);

  const summary = query.data ?? null;

  const bookFollowUp = React.useCallback(() => {
    if (!summary) return;
    setDraft({
      specialization: summary.doctor.specializationRu.trim() || null,
      serviceIds: [],
      doctorId: summary.doctor.id,
      date: null,
      time: null,
    });
    router.push(`/c/${clinicSlug}/my/book/doctor`);
  }, [summary, setDraft, router, clinicSlug]);

  if (query.isLoading) return <MSpinner label={t.common.loading} />;
  if (query.isError) return <MEmpty>{t.common.error}</MEmpty>;

  if (!summary) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-bold">{t.visit.title}</h1>
        <MEmpty icon={Hourglass}>
          <div className="font-semibold">{t.visit.notReadyTitle}</div>
          <div className="mt-1 text-xs" style={{ color: "var(--tg-hint)" }}>
            {t.visit.notReadyHint}
          </div>
        </MEmpty>
      </div>
    );
  }

  const blocks = parseHandoutBlocks(summary.handoutMarkdown);
  const doctorName = lang === "UZ" ? summary.doctor.nameUz : summary.doctor.nameRu;
  const specialization =
    lang === "UZ"
      ? summary.doctor.specializationUz
      : summary.doctor.specializationRu;
  // `<a target="_blank">` opens without our custom headers, so the PDF link
  // carries init-data via query — same pattern as the documents screen.
  const conclusionHref = summary.conclusionUrl
    ? `${summary.conclusionUrl}${initData ? `&initData=${encodeURIComponent(initData)}` : ""}`
    : null;

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">{t.visit.title}</h1>

      <MCard className="mb-3">
        <div className="text-sm font-semibold">{doctorName}</div>
        <div className="text-xs" style={{ color: "var(--tg-hint)" }}>
          {specialization}
        </div>
        <div className="mt-2 text-sm" style={{ color: "var(--tg-accent)" }}>
          {formatDateISO(summary.date, lang)}
          {summary.time ? ` · ${summary.time}` : ""}
        </div>
        {summary.documentNumber ? (
          <div className="mt-1 text-xs" style={{ color: "var(--tg-hint)" }}>
            {t.visit.docNumber.replace("{number}", summary.documentNumber)}
          </div>
        ) : null}
      </MCard>

      {summary.diagnosisName ? (
        <MCard className="mb-3">
          <div
            className="text-xs font-medium"
            style={{ color: "var(--tg-hint)" }}
          >
            {t.visit.diagnosis}
          </div>
          <div className="mt-0.5 text-sm font-semibold">
            {summary.diagnosisName}
          </div>
        </MCard>
      ) : null}

      {blocks.length > 0 ? (
        <MCard className="mb-3">
          <HandoutBlocks blocks={blocks} />
        </MCard>
      ) : null}

      <div className="grid grid-cols-1 gap-2">
        {conclusionHref ? (
          <a href={conclusionHref} target="_blank" rel="noreferrer">
            <MButton variant="primary" className="w-full">
              <span className="inline-flex items-center gap-2">
                <FileText className="h-4 w-4" aria-hidden />
                {t.visit.openPdf}
              </span>
            </MButton>
          </a>
        ) : null}
        {summary.followUpAt ? (
          <MButton variant="secondary" onClick={bookFollowUp}>
            <span className="inline-flex items-center gap-2">
              <CalendarPlus className="h-4 w-4" aria-hidden />
              {t.visit.followUp.replace(
                "{date}",
                formatDateISO(summary.followUpAt, lang),
              )}
            </span>
          </MButton>
        ) : null}
      </div>
    </div>
  );
}

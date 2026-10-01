import {
  CalendarIcon,
  ClockIcon,
  FilePenLineIcon,
  SparklesIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { formatDate, type Locale } from "@/lib/format";
import { visitDiagnosesOf, type VisitDiagnosis } from "@/lib/visit-diagnoses";

type Note = {
  id: string;
  status: "DRAFT" | "FINALIZED";
  startedAt: string | null;
  finalizedAt: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  /** The diagnoses after the main one, in the doctor's order. */
  additionalDiagnoses: VisitDiagnosis[];
  complaints: string[];
  anamnesis: string[];
  examination: string[];
  prescriptions: string[];
  advice: string[];
  bodyMarkdown: string | null;
  aiGenerated: boolean;
  /** Corrections appended after signing, oldest first (audit DC-06). */
  amendments: Array<{
    id: string;
    reason: string;
    text: string;
    createdAt: string;
    author: string | null;
  }>;
  appointment: {
    date: string;
    endDate: string;
    time: string | null;
    serviceName: string | null;
  } | null;
};

export async function VisitNoteReadOnly({ note }: { note: Note }) {
  const t = await getTranslations("doctor.visits");
  // A server component: `getHours()` here reads the server's zone, which is
  // UTC in production, so a 10:00 visit showed 05:00 and a note signed at
  // 01:30 showed the day before (audit UX-05). formatDate pins the clinic's
  // zone, and the month names follow the doctor's language.
  const locale: Locale = (await getLocale()) === "uz" ? "uz" : "ru";
  const day = (iso: string) => formatDate(iso, locale, "long");
  const hhmm = (iso: string) => formatDate(iso, locale, "time");
  const appt = note.appointment;
  // Saving settles the set so the main one is always first; reading it by
  // position keeps every diagnosis on screen even for a hand-made row.
  const [main = null, ...others] = visitDiagnosesOf(note);
  return (
    <article className="flex flex-col gap-4">
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {appt && (
            <>
              <Meta icon={<CalendarIcon className="size-4" />} label={t("note.date")}>
                {day(appt.date)}
              </Meta>
              <Meta icon={<ClockIcon className="size-4" />} label={t("note.time")}>
                {hhmm(appt.date)}–{hhmm(appt.endDate)}
              </Meta>
              {appt.serviceName && (
                <Meta label={t("note.appointmentType")}>{appt.serviceName}</Meta>
              )}
            </>
          )}
          {note.finalizedAt && (
            <Meta label={t("note.finalizedAt")}>
              {day(note.finalizedAt)} · {hhmm(note.finalizedAt)}
            </Meta>
          )}
          {note.aiGenerated && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-violet/10 px-2 py-1 text-[11px] font-semibold text-violet">
              <SparklesIcon className="size-3.5" />
              {t("note.aiGenerated")}
            </span>
          )}
        </div>
      </section>

      {/* DC-06: a correction outranks the text it corrects, so it sits above
          the original fields (never merged into them: the signed text stays
          what the patient holds on paper). */}
      {note.amendments.length > 0 && (
        <section className="rounded-2xl border border-info/30 bg-info/5 px-5 py-4">
          <h3 className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--info)]">
            <FilePenLineIcon className="size-3.5" />
            {t("note.amendments")}
          </h3>
          <p className="mb-2 text-xs text-muted-foreground">
            {t("note.amendmentsHint")}
          </p>
          <ol className="flex flex-col">
            {note.amendments.map((a) => (
              <li
                key={a.id}
                className="border-t border-info/20 py-2.5 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {day(a.createdAt)} · {hhmm(a.createdAt)}
                  {a.author ? ` · ${a.author}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("note.amendmentReason", { reason: a.reason })}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {a.text}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Every diagnosis of the visit: the main one as before, the others
          (up to three since 29.09.2026) under a «Сопутствующие» label, so
          the page reads the whole set the doctor signed. */}
      {main && (
        <Block title={t("note.diagnosisIcd10")}>
          <div className="flex items-baseline gap-2">
            {main.code && (
              <span className="font-mono text-base font-bold text-primary">
                {main.code}
              </span>
            )}
            {main.name && main.name !== main.code && (
              <span className="text-sm text-foreground">{main.name}</span>
            )}
          </div>
          {others.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("note.additionalDiagnoses")}
              </div>
              <ul className="flex flex-col gap-1">
                {others.map((d, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    {d.code && (
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {d.code}
                      </span>
                    )}
                    {d.name && d.name !== d.code && (
                      <span className="text-sm text-foreground">{d.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Block>
      )}

      <Block title={t("note.complaints")}>
        <Chips items={note.complaints} />
      </Block>
      <Block title={t("note.anamnesis")}>
        <Chips items={note.anamnesis} />
      </Block>
      <Block title={t("note.examination")}>
        <Chips items={note.examination} />
      </Block>
      <Block title={t("note.prescriptions")}>
        <Chips items={note.prescriptions} />
      </Block>
      <Block title={t("note.advice")}>
        <Chips items={note.advice} />
      </Block>

      <Block title={t("note.bodyText")}>
        {note.bodyMarkdown && note.bodyMarkdown.trim().length > 0 ? (
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background px-4 py-3 font-sans text-sm leading-relaxed text-foreground">
            {note.bodyMarkdown}
          </pre>
        ) : (
          <Empty />
        )}
      </Block>
    </article>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <Empty />;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <li
          key={`${it}-${i}`}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground"
        >
          {it}
        </li>
      ))}
    </ul>
  );
}

function Empty() {
  return <span className="text-xs italic text-muted-foreground">—</span>;
}

function Meta({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}:
      </span>
      <span className="text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

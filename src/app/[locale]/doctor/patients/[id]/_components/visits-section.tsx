"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FlaskConicalIcon,
  Loader2Icon,
  PaperclipIcon,
  PillIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import {
  flattenVisits,
  useDoctorPatientVisits,
  type DoctorPatientVisitRow,
} from "../../_hooks/use-doctor-patient-visits";

const RU_MONTHS_SHORT = [
  "янв.",
  "февр.",
  "мар.",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

function ruDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Visit history as the single place where a patient's past lives.
 *
 * Documents, lab orders and prescriptions used to sit in three sibling tabs,
 * flat and divorced from the visit that produced them — so answering «что я
 * назначал в прошлый раз» meant opening three lists and matching them up by
 * date in your head. Everything a visit produced now hangs under that visit,
 * which is the shape the data already had (`Document.appointmentId`,
 * `LabOrder.appointmentId`, `VisitPrescription.visitNoteId`).
 *
 * Rows are collapsed by default: the doctor scans dates and diagnoses, then
 * opens the one visit he needs. A row with nothing attached does not expand —
 * an empty drawer reads as a bug.
 */
export function VisitsSection({
  patientId,
  locale,
}: {
  patientId: string;
  locale: string;
}) {
  const t = useTranslations("doctor.patients");
  const list = useDoctorPatientVisits(patientId);
  const rows = flattenVisits(list.data);
  const [openId, setOpenId] = React.useState<string | null>(null);
  // First page carries patient artefacts tied to no visit. Folding the flat
  // tabs into this timeline must not orphan them.
  const unattached = list.data?.pages?.[0]?.unattached ?? null;
  const hasUnattached = Boolean(
    unattached && unattached.documents.length + unattached.labs.length > 0,
  );

  const sentinel = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          list.hasNextPage &&
          !list.isFetchingNextPage
        ) {
          list.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [list]);

  if (list.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {t("visits.loading")}
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-destructive">
        {t("visits.loadError")}
      </div>
    );
  }

  // «Empty» only when BOTH the timeline and the unattached bucket are empty —
  // otherwise the bucket (the only home of visit-less documents now that the
  // flat tabs are gone) would be hidden by this early return.
  if (rows.length === 0 && !hasUnattached) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        {t("visits.empty")}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      {hasUnattached && unattached ? (
        <div className="border-b border-border bg-muted/20 px-4 py-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("visits.unattached")}
          </div>
          <ul className="space-y-1 text-xs">
            {unattached.documents.map((d) => (
              <li key={d.id}>
                <a
                  href={d.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                >
                  <PaperclipIcon className="size-3" />
                  {d.title}
                </a>
              </li>
            ))}
            {unattached.labs.map((l) => (
              <li key={l.id} className="inline-flex items-center gap-1.5 text-foreground">
                <FlaskConicalIcon className="size-3 text-muted-foreground" />
                {l.orderNumber}
                <span className="text-muted-foreground">
                  · {t("visits.labTests", { n: l.tests })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="divide-y divide-border">
        {rows.map((v) => (
          <VisitEntry
            key={v.id}
            visit={v}
            patientId={patientId}
            locale={locale}
            isOpen={openId === v.id}
            onToggle={() => setOpenId((cur) => (cur === v.id ? null : v.id))}
          />
        ))}
      </ul>
      <div ref={sentinel} />
      {list.isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          {t("loadingMore")}
        </div>
      )}
    </section>
  );
}

function VisitEntry({
  visit: v,
  patientId,
  locale,
  isOpen,
  onToggle,
}: {
  visit: DoctorPatientVisitRow;
  patientId: string;
  locale: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("doctor.patients");

  const meds = v.medications.length + v.prescriptions.length;
  const docs = v.documents.length;
  const labs = v.labs.length;
  const hasDetail = meds + docs + labs + v.advice.length > 0;

  // The conclusion opens by VisitNote id — the appointment id 404s here.
  const noteHref = v.visitNoteId
    ? `/${locale}/doctor/visits/${patientId}/${v.visitNoteId}`
    : null;
  const isDraft = v.noteStatus === "DRAFT";

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3",
          hasDetail && "cursor-pointer transition-colors hover:bg-muted/60",
        )}
        onClick={hasDetail ? onToggle : undefined}
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FileTextIcon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium text-foreground">
              {v.diagnosisCode || v.diagnosisName ? (
                [v.diagnosisCode, v.diagnosisName].filter(Boolean).join(" · ")
              ) : (
                <span className="text-muted-foreground">
                  {t("visits.noDiagnosis")}
                </span>
              )}
            </span>
            {/* A draft means the visit was never signed. Surfacing it here is
                the point: an unsigned conclusion is not a document yet. */}
            {isDraft ? (
              <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-text">
                {t("visits.draft")}
              </span>
            ) : null}
          </div>

          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {ruDate(v.date)} ·{" "}
            {t("visits.durationMin", { min: v.durationMin })} ·{" "}
            {v.type === "repeat"
              ? t("visits.type.repeat")
              : t("visits.type.consultation")}
            {v.serviceName ? ` · ${v.serviceName}` : ""}
          </div>

          {hasDetail ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {meds > 0 ? (
                <Chip icon={PillIcon} label={t("visits.medsCount", { n: meds })} />
              ) : null}
              {docs > 0 ? (
                <Chip
                  icon={PaperclipIcon}
                  label={t("visits.docsCount", { n: docs })}
                />
              ) : null}
              {labs > 0 ? (
                <Chip
                  icon={FlaskConicalIcon}
                  label={t("visits.labsCount", { n: labs })}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {hasDetail ? (
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-180",
            )}
          />
        ) : noteHref ? (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : null}
      </div>

      {isOpen ? (
        <div className="space-y-3 border-t border-border/60 bg-muted/20 px-4 py-3">
          {meds > 0 ? (
            <DetailBlock icon={PillIcon} title={t("visits.medications")}>
              {v.medications.map((m) => (
                <li key={m.id} className="text-foreground">
                  {m.name}
                  {m.strength ? ` ${m.strength}` : ""}
                  {m.dose ? (
                    <span className="text-muted-foreground"> · {m.dose}</span>
                  ) : null}
                </li>
              ))}
              {/* Quick-entry lane: free text the doctor typed under the
                  patient's name during the visit. */}
              {v.prescriptions.map((p, i) => (
                <li key={`free-${i}`} className="text-foreground">
                  {p}
                </li>
              ))}
            </DetailBlock>
          ) : null}

          {docs > 0 ? (
            <DetailBlock icon={PaperclipIcon} title={t("visits.documents")}>
              {v.documents.map((d) => (
                <li key={d.id}>
                  {/* A document you cannot open is a document you do not
                      have — the flat tab this replaced opened files, so the
                      timeline must too. */}
                  <a
                    href={d.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {d.title}
                  </a>
                </li>
              ))}
            </DetailBlock>
          ) : null}

          {labs > 0 ? (
            <DetailBlock icon={FlaskConicalIcon} title={t("visits.labs")}>
              {v.labs.map((l) => (
                <li key={l.id} className="text-foreground">
                  {l.orderNumber}
                  <span className="text-muted-foreground">
                    {" · "}
                    {t("visits.labTests", { n: l.tests })}
                  </span>
                </li>
              ))}
            </DetailBlock>
          ) : null}

          {v.advice.length > 0 ? (
            <DetailBlock icon={FileTextIcon} title={t("visits.advice")}>
              {v.advice.map((a, i) => (
                <li key={i} className="text-foreground">
                  {a}
                </li>
              ))}
            </DetailBlock>
          ) : null}

          {noteHref ? (
            <Link
              href={noteHref}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {t("visits.openConclusion")}
              <ChevronRightIcon className="size-3.5" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Chip({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function DetailBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" />
        {title}
      </div>
      <ul className="ml-4 list-disc space-y-0.5 text-xs">{children}</ul>
    </div>
  );
}

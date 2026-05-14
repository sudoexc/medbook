import { CalendarIcon, ClockIcon, SparklesIcon } from "lucide-react";

type Note = {
  id: string;
  status: "DRAFT" | "FINALIZED";
  startedAt: string | null;
  finalizedAt: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  complaints: string[];
  anamnesis: string[];
  examination: string[];
  prescriptions: string[];
  advice: string[];
  bodyMarkdown: string | null;
  aiGenerated: boolean;
  appointment: {
    date: string;
    endDate: string;
    time: string | null;
    serviceName: string | null;
  } | null;
};

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function ruDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()] ?? ""} ${d.getFullYear()}`;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function VisitNoteReadOnly({ note }: { note: Note }) {
  const appt = note.appointment;
  return (
    <article className="flex flex-col gap-4">
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {appt && (
            <>
              <Meta icon={<CalendarIcon className="size-4" />} label="Дата">
                {ruDate(appt.date)}
              </Meta>
              <Meta icon={<ClockIcon className="size-4" />} label="Время">
                {hhmm(appt.date)}–{hhmm(appt.endDate)}
              </Meta>
              {appt.serviceName && (
                <Meta label="Тип приёма">{appt.serviceName}</Meta>
              )}
            </>
          )}
          {note.finalizedAt && (
            <Meta label="Финализировано">
              {ruDate(note.finalizedAt)} · {hhmm(note.finalizedAt)}
            </Meta>
          )}
          {note.aiGenerated && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-violet/10 px-2 py-1 text-[11px] font-semibold text-violet">
              <SparklesIcon className="size-3.5" />
              Сформировано с участием AI
            </span>
          )}
        </div>
      </section>

      {(note.diagnosisCode || note.diagnosisName) && (
        <Block title="Диагноз (МКБ-10)">
          <div className="flex items-baseline gap-2">
            {note.diagnosisCode && (
              <span className="font-mono text-base font-bold text-primary">
                {note.diagnosisCode}
              </span>
            )}
            {note.diagnosisName && (
              <span className="text-sm text-foreground">
                {note.diagnosisName}
              </span>
            )}
          </div>
        </Block>
      )}

      <Block title="Жалобы">
        <Chips items={note.complaints} />
      </Block>
      <Block title="Анамнез">
        <Chips items={note.anamnesis} />
      </Block>
      <Block title="Осмотр">
        <Chips items={note.examination} />
      </Block>
      <Block title="Назначения">
        <Chips items={note.prescriptions} />
      </Block>
      <Block title="Рекомендации">
        <Chips items={note.advice} />
      </Block>

      <Block title="Текст заключения">
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

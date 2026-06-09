"use client";

import { PhoneIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

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

function ageFromBirthIso(iso: string): number {
  const b = new Date(iso);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  const md = now.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < b.getDate())) years -= 1;
  return Math.max(0, years);
}

function ddmmyyyy(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function ruShort(iso: string, time: string | null): string {
  const d = new Date(iso);
  const day = d.getDate();
  const m = RU_MONTHS_SHORT[d.getMonth()] ?? "";
  const t = time ?? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${day} ${m}, ${t}`;
}

function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

type Props = {
  fullName: string;
  phone: string;
  birthDateIso: string | null;
  photoUrl: string | null;
  hasActiveAppointment: boolean;
  lastVisit: { dateIso: string; time: string | null } | null;
  cardNumber: string;
};

export function PatientHeaderLive(props: Props) {
  const t = useTranslations("doctor.visits");
  const age = props.birthDateIso ? ageFromBirthIso(props.birthDateIso) : null;
  const birth = props.birthDateIso ? ddmmyyyy(props.birthDateIso) : null;
  const status = props.hasActiveAppointment
    ? { tone: "success" as const, label: t("header.statusInReception") }
    : { tone: "muted" as const, label: t("header.statusCompleted") };

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-5">
        <Avatar className="size-14 shrink-0">
          {props.photoUrl ? <AvatarImage src={props.photoUrl} alt="" /> : null}
          <AvatarFallback className="bg-primary/10 text-base font-bold text-primary">
            {initials(props.fullName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 shrink-0">
          <div className="truncate text-lg font-bold text-foreground">
            {props.fullName}
          </div>
          <span
            className={cn(
              "mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              props.hasActiveAppointment
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                props.hasActiveAppointment ? "bg-success" : "bg-muted-foreground/50",
              )}
            />
            {props.hasActiveAppointment
              ? t("header.activeReception")
              : t("header.patient")}
          </span>
        </div>

        <div className="ml-auto grid grid-cols-2 items-center gap-x-7 gap-y-2 md:grid-cols-3 xl:grid-cols-6">
          <Field
            label={t("header.age")}
            value={
              age !== null && birth
                ? t("header.ageValue", { age, birth })
                : "—"
            }
          />
          <Field
            label={t("header.phone")}
            value={
              <span className="inline-flex items-center gap-1">
                {props.phone}
                <PhoneIcon className="size-3 text-muted-foreground" />
              </span>
            }
          />
          <Field label={t("header.appointmentType")} value="—" />
          <Field
            label={t("header.status")}
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    status.tone === "success" ? "bg-success" : "bg-muted-foreground/50",
                  )}
                />
                {status.label}
              </span>
            }
          />
          <Field
            label={t("header.lastVisit")}
            value={
              props.lastVisit
                ? ruShort(props.lastVisit.dateIso, props.lastVisit.time)
                : "—"
            }
          />
          <Field label={t("header.cardNumber")} value={props.cardNumber} />
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

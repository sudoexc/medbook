"use client";

import { PhoneIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MOCK_PATIENT } from "../_mocks";

const STATUS_TONE: Record<"success" | "warning" | "muted", string> = {
  success: "bg-success",
  warning: "bg-warning",
  muted: "bg-muted-foreground/40",
};

export function PatientHeader() {
  const p = MOCK_PATIENT;
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-5">
        <Avatar className="size-14 shrink-0">
          <AvatarFallback className="bg-primary/10 text-base font-bold text-primary">
            {p.initials}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 shrink-0">
          <div className="truncate text-lg font-bold text-foreground">
            {p.fullName}
          </div>
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-semibold text-success">
            <span className="size-1.5 rounded-full bg-success" />
            Активный пациент
          </span>
        </div>

        <div className="ml-auto grid grid-cols-2 items-center gap-x-7 gap-y-2 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Возраст" value={`${p.age} лет (${p.birthDate})`} />
          <Field
            label="Телефон"
            value={
              <span className="inline-flex items-center gap-1">
                {p.phone}
                <PhoneIcon className="size-3 text-muted-foreground" />
              </span>
            }
          />
          <Field label="Тип приёма" value={p.appointmentType} />
          <Field
            label="Статус"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    STATUS_TONE[p.visitStatus.tone],
                  )}
                />
                {p.visitStatus.label}
              </span>
            }
          />
          <Field label="Последний визит" value={p.lastVisitShort} />
          <Field label="№ карты" value={p.cardNumber} />
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

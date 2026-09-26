"use client";

import { useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDoctors } from "@/components/providers/doctors-provider";
import { CheckCircle, Send, ChevronLeft, ChevronRight } from "lucide-react";
import { reachGoal } from "@/lib/site-analytics";
import { isValidUzPhone } from "@/lib/phone";
import { isLeadDayOpen } from "@/lib/doctor-working-windows";
import type { PublicScheduleRow } from "@/lib/doctors";
import type { Locale } from "@/types";

const MONTH_NAMES: Record<Locale, string[]> = {
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  uz: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"],
};

const DAY_HEADERS: Record<Locale, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  uz: ["Du", "Se", "Chor", "Pay", "Ju", "Sha", "Ya"],
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function MiniCalendar({ locale, selectedDate, onSelect, schedule }: { locale: Locale; selectedDate: string; onSelect: (d: string) => void; schedule?: PublicScheduleRow[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());

  const firstDay = new Date(viewYear, viewMonth, 1);
  let startDow = firstDay.getDay() - 1; // Monday=0
  if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30);

  const canPrev = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && viewMonth > today.getMonth());
  const canNext = new Date(viewYear, viewMonth + 1, 1) <= maxDate;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); }}
          className="p-1 rounded hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">
          {MONTH_NAMES[locale][viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); }}
          className="p-1 rounded hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAY_HEADERS[locale].map((dh) => (
          <div key={dh} className="text-[10px] text-muted-foreground font-medium py-1">{dh}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;
          const date = new Date(viewYear, viewMonth, day);
          // The calendar day as shown. `toISOString()` of a local midnight
          // is the PREVIOUS day in Tashkent (UTC+5), which both sent the
          // wrong date and would test the wrong weekday.
          const dateStr = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`;
          const isPast = date < today;
          const isTooFar = date > maxDate;
          const disabled = isPast || isTooFar || !isLeadDayOpen(dateStr, schedule);
          const isSelected = dateStr === selectedDate;
          const isToday = date.getTime() === today.getTime();

          return (
            <button
              key={dateStr}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(dateStr)}
              className={`h-8 w-full rounded-md text-xs transition-colors ${
                isSelected
                  ? "bg-primary text-primary-foreground font-bold"
                  : isToday
                  ? "bg-primary/10 text-primary font-medium hover:bg-primary/20"
                  : disabled
                  ? "text-muted-foreground/30"
                  : "hover:bg-muted text-foreground"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Opens a lead form from a button that cannot own it. The mobile menu's
 * «Записаться» lives inside the menu sheet, which unmounts when it closes:
 * a form owned by that button would vanish together with the sheet. The
 * menu renders the form outside the sheet with a handle and opens it once
 * the sheet has closed (audit CM-14).
 */
export type LeadFormHandle = DialogPrimitive.Handle<unknown>;

export function createLeadFormHandle(): LeadFormHandle {
  return DialogPrimitive.createHandle();
}

/**
 * Whether a refused POST /api/leads refused the phone number. The API runs
 * the same rule as the form (isValidUzPhone) and names the field; the form
 * then shows the phone message under the field instead of the generic
 * «Произошла ошибка», which reads as a broken site (audit LD-10).
 */
export function isPhoneRejection(status: number, body: unknown): boolean {
  if (status !== 400 || !body || typeof body !== "object") return false;
  const error = (body as { error?: unknown }).error;
  return !!error && typeof error === "object" && "phone" in error;
}

interface LeadFormTriggerProps {
  /** The button that opens the form. Optional with `handle`. */
  children?: React.ReactElement;
  doctorId?: string;
  /** Lets a button outside this component open the form (see LeadFormHandle). */
  handle?: LeadFormHandle;
}

export function LeadFormTrigger({ children, doctorId, handle }: LeadFormTriggerProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState(doctorId || "");
  const [selectedDate, setSelectedDate] = useState("");
  const t = useTranslations("leadForm");
  const locale = useLocale() as Locale;
  // The showcase lists the whole staff, but a request may only target a
  // doctor the CRM actually serves — a lead pinned to a deactivated doctor
  // is a request nobody processes.
  const doctors = useDoctors().filter((d) => d.bookable);

  const selectedDoctor = useMemo(
    () => doctors.find((d) => d.id === selectedDoctorId),
    [selectedDoctorId, doctors]
  );

  function handleOpen(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen) {
      reachGoal("booking-open");
      // A trigger may carry the id of a non-bookable doctor (stale link) —
      // fall back to «выберите врача» instead of a phantom preselection.
      setSelectedDoctorId(
        doctorId && doctors.some((d) => d.id === doctorId) ? doctorId : "",
      );
      setSelectedDate("");
      setSubmitted(false);
      setError(false);
      setPhoneError(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setError(false);
    setPhoneError(false);

    // Any Uzbek number, with or without +998: the rule the API applies too.
    // It used to demand a 9 after the country code, so everyone on 33, 88,
    // 77, 50 or 20 got «Произошла ошибка» and left (audit LD-10). A wrong
    // number now gets its own message under the field.
    if (!isValidUzPhone(String(formData.get("phone") ?? ""))) {
      setPhoneError(true);
      (form.elements.namedItem("phone") as HTMLInputElement | null)?.focus();
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          phone: formData.get("phone"),
          doctorId: selectedDoctorId || undefined,
          date: selectedDate || undefined,
          locale,
        }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        if (isPhoneRejection(res.status, body)) {
          setPhoneError(true);
          return;
        }
        throw new Error();
      }

      reachGoal("booking-sent");
      setSubmitted(true);
      setTimeout(() => { setSubmitted(false); setOpen(false); }, 2500);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen} handle={handle}>
      {children && <DialogTrigger render={children} />}
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{t("title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </DialogHeader>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <p className="text-center font-medium">{t("success")}</p>
            {selectedDate && (
              <p className="text-sm text-muted-foreground text-center">
                {t("successConfirm")}
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-2 space-y-4">
            <div>
              <label htmlFor="lead-doctor" className="text-sm font-medium">{t("doctor")}</label>
              <select
                id="lead-doctor"
                required
                value={selectedDoctorId}
                onChange={(e) => { setSelectedDoctorId(e.target.value); setSelectedDate(""); }}
                className="mt-1 flex h-10 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="">{t("selectDoctor")}</option>
                {doctors.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name[locale]} — {doc.specialty[locale]}
                  </option>
                ))}
              </select>
            </div>

            {selectedDoctor && (
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-sm font-medium">{selectedDoctor.name[locale]}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selectedDoctor.specialty[locale]}
                </p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium">{t("date")}</label>
              <div className="mt-1.5 rounded-lg border border-border p-3">
                <MiniCalendar
                  locale={locale}
                  selectedDate={selectedDate}
                  onSelect={(d) => setSelectedDate(d)}
                  schedule={selectedDoctor?.schedule}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="lead-name" className="text-sm font-medium">{t("name")}</label>
                <Input id="lead-name" required name="name" className="mt-1 h-10 rounded-lg" placeholder={t("name")} />
              </div>
              <div>
                <label htmlFor="lead-phone" className="text-sm font-medium">{t("phone")}</label>
                {/* No `pattern`: the browser's own «match the requested
                    format» bubble would pre-empt the message below. */}
                <Input
                  id="lead-phone"
                  required
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-invalid={phoneError || undefined}
                  aria-describedby={phoneError ? "lead-phone-error" : undefined}
                  onChange={() => setPhoneError(false)}
                  className="mt-1 h-10 rounded-lg"
                  placeholder={t("phoneFormat")}
                />
                {phoneError && (
                  <p id="lead-phone-error" role="alert" className="mt-1 text-xs text-destructive">
                    {t("phoneInvalid")}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{t("error")}</p>
            )}

            <Button type="submit" disabled={loading} className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/85">
              <Send className="mr-2 h-4 w-4" />
              {loading ? "..." : t("submit")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

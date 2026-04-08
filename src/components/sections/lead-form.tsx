"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
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
import { CheckCircle, Send, MapPin, Clock, Calendar, Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "@/types";

function formatPrice(price: number): string {
  return price.toLocaleString("ru-RU").replace(/,/g, " ");
}

const MONTH_NAMES: Record<Locale, string[]> = {
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  uz: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"],
};

const DAY_HEADERS: Record<Locale, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  uz: ["Du", "Se", "Chor", "Pay", "Ju", "Sha", "Ya"],
};

function MiniCalendar({ locale, selectedDate, onSelect }: { locale: Locale; selectedDate: string; onSelect: (d: string) => void }) {
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
          const dateStr = date.toISOString().split("T")[0];
          const isPast = date < today;
          const isSunday = date.getDay() === 0;
          const isTooFar = date > maxDate;
          const disabled = isPast || isSunday || isTooFar;
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

interface LeadFormTriggerProps {
  children: React.ReactElement;
  doctorId?: string;
}

export function LeadFormTrigger({ children, doctorId }: LeadFormTriggerProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState(doctorId || "");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const t = useTranslations("leadForm");
  const locale = useLocale() as Locale;
  const doctors = useDoctors();

  const selectedDoctor = useMemo(
    () => doctors.find((d) => d.id === selectedDoctorId),
    [selectedDoctorId, doctors]
  );

  // Fetch available slots when doctor + date selected
  useEffect(() => {
    if (!selectedDoctorId || !selectedDate) {
      setAvailableSlots([]);
      return;
    }
    setSlotsLoading(true);
    fetch(`/api/booking?doctorId=${selectedDoctorId}&date=${selectedDate}`)
      .then((r) => r.json())
      .then((data) => {
        setAvailableSlots(data.slots || []);
        setSelectedTime("");
      })
      .finally(() => setSlotsLoading(false));
  }, [selectedDoctorId, selectedDate]);

  function handleOpen(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen) {
      setSelectedDoctorId(doctorId || "");
      setSelectedServices([]);
      setSelectedDate("");
      setSelectedTime("");
      setSubmitted(false);
      setError(false);
    }
  }

  function toggleService(name: string) {
    setSelectedServices((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setError(false);
    setLoading(true);

    const serviceStr = selectedServices.join(", ");

    try {
      const dateTime = selectedTime ? `${selectedDate}T${selectedTime}:00` : undefined;

      if (dateTime && selectedDoctorId) {
        const res = await fetch("/api/booking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.get("name"),
            phone: formData.get("phone"),
            doctorId: selectedDoctorId,
            service: serviceStr || undefined,
            date: dateTime,
          }),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.get("name"),
            phone: formData.get("phone"),
            doctorId: selectedDoctorId || undefined,
            service: serviceStr || undefined,
            date: selectedDate || undefined,
            locale,
          }),
        });
        if (!res.ok) throw new Error();
      }

      setSubmitted(true);
      setTimeout(() => { setSubmitted(false); setOpen(false); }, 2500);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={children} />
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
            {selectedTime && (
              <p className="text-sm text-muted-foreground text-center">
                {locale === "ru" ? "Вы записаны на" : "Siz yozildingiz"} {selectedDate} {locale === "ru" ? "в" : ""} {selectedTime}
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-2 space-y-4">
            <div>
              <label className="text-sm font-medium">{t("doctor")}</label>
              <select
                required
                value={selectedDoctorId}
                onChange={(e) => { setSelectedDoctorId(e.target.value); setSelectedServices([]); setSelectedDate(""); setSelectedTime(""); }}
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
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {t("cabinet")} {selectedDoctor.cabinet}</span>
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {selectedDoctor.schedule[locale]}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {selectedDoctor.hours}</span>
                </div>
              </div>
            )}

            {selectedDoctor && selectedDoctor.services.length > 0 && (
              <div>
                <label className="text-sm font-medium">{t("service")}</label>
                <div className="mt-1.5 space-y-1.5">
                  {selectedDoctor.services.map((svc) => {
                    const isSelected = selectedServices.includes(svc.name[locale]);
                    return (
                      <button
                        key={svc.name[locale]}
                        type="button"
                        onClick={() => toggleService(svc.name[locale])}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                          }`}>
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span>{svc.name[locale]}</span>
                        </div>
                        <span className="font-medium tabular-nums">{formatPrice(svc.price)} {t("sum")}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedServices.length > 1 && (
                  <p className="mt-1.5 text-xs text-muted-foreground text-right">
                    {locale === "ru" ? "Итого" : "Jami"}: {formatPrice(
                      selectedDoctor.services
                        .filter((s) => selectedServices.includes(s.name[locale]))
                        .reduce((sum, s) => sum + s.price, 0)
                    )} {t("sum")}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-sm font-medium">{t("date")}</label>
              <div className="mt-1.5 rounded-lg border border-border p-3">
                <MiniCalendar
                  locale={locale}
                  selectedDate={selectedDate}
                  onSelect={(d) => { setSelectedDate(d); setSelectedTime(""); }}
                />
              </div>
            </div>

            {/* Time slots */}
            {selectedDate && selectedDoctorId && (
              <div>
                <label className="text-sm font-medium">
                  {locale === "ru" ? "Время" : "Vaqt"}
                </label>
                {slotsLoading ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">...</p>
                ) : availableSlots.length === 0 ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {locale === "ru" ? "Нет свободных слотов" : "Bo'sh vaqt yo'q"}
                  </p>
                ) : (
                  <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setSelectedTime(slot)}
                        className={`rounded-lg border px-2 py-2 text-xs font-mono transition-colors ${
                          selectedTime === slot
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">{t("name")}</label>
                <Input required name="name" className="mt-1 h-10 rounded-lg" placeholder={t("name")} />
              </div>
              <div>
                <label className="text-sm font-medium">{t("phone")}</label>
                <Input required name="phone" type="tel" className="mt-1 h-10 rounded-lg" placeholder={t("phoneFormat")} />
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

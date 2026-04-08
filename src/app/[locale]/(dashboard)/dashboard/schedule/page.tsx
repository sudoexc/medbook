"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, Plus, X, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDoctors } from "@/components/providers/doctors-provider";
import type { Locale } from "@/types";

interface Patient {
  id: string;
  fullName: string;
  phone: string;
}

interface ScheduleItem {
  id: string;
  patient: Patient;
  doctor: { id: string; nameRu: string; nameUz: string };
  service: string | null;
  date: string;
  queueStatus: string;
  source: string;
}

interface DoctorScheduleDay {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

interface DoctorAvailability {
  schedules: DoctorScheduleDay[];
  daysOff: { date: string }[];
}

const SLOTS: string[] = [];
for (let h = 8; h <= 16; h++) {
  SLOTS.push(`${String(h).padStart(2, "0")}:00`);
  SLOTS.push(`${String(h).padStart(2, "0")}:30`);
}

const STATUS_COLORS: Record<string, string> = {
  WAITING: "bg-amber-50 border-amber-300 text-amber-900",
  IN_PROGRESS: "bg-blue-50 border-blue-400 text-blue-900 ring-2 ring-blue-300",
  COMPLETED: "bg-green-50 border-green-300 text-green-900",
  SKIPPED: "bg-gray-100 border-gray-300 text-gray-500 line-through",
};

const t = {
  ru: {
    title: "Шахматка",
    today: "Сегодня",
    addAppointment: "Записать",
    phone: "Телефон",
    name: "ФИО",
    passport: "Паспорт",
    service: "Услуга",
    save: "Записать",
    cancel: "Отмена",
    searchPatient: "Поиск по телефону",
    newPatient: "Новый пациент",
    noAppointments: "Нет записей",
  },
  uz: {
    title: "Jadval",
    today: "Bugun",
    addAppointment: "Yozish",
    phone: "Telefon",
    name: "Ism",
    passport: "Pasport",
    service: "Xizmat",
    save: "Yozish",
    cancel: "Bekor",
    searchPatient: "Telefon bo'yicha qidirish",
    newPatient: "Yangi bemor",
    noAppointments: "Yozilishlar yo'q",
  },
};

export default function SchedulePage() {
  const locale = useLocale() as Locale;
  const labels = t[locale];
  const { data: session } = useSession();
  const doctors = useDoctors();

  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [appointments, setAppointments] = useState<ScheduleItem[]>([]);
  const [addDialog, setAddDialog] = useState<{ doctorId: string; time: string; date?: string } | null>(null);
  const [availability, setAvailability] = useState<Record<string, DoctorAvailability>>({});

  const isAdmin = session?.user?.role === "ADMIN";
  const visibleDoctors = isAdmin
    ? doctors
    : doctors.filter((d) => d.id === session?.user?.doctorId);

  // Get week dates (Mon-Sat)
  const weekDates = useMemo(() => {
    const d = new Date(date + "T12:00:00");
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + mondayOffset);
    const dates: string[] = [];
    for (let i = 0; i < 6; i++) {
      const wd = new Date(monday);
      wd.setDate(monday.getDate() + i);
      dates.push(wd.toISOString().split("T")[0]);
    }
    return dates;
  }, [date]);

  const fetchSchedule = useCallback(async () => {
    if (viewMode === "day") {
      const res = await fetch(`/api/schedule?date=${date}`);
      if (res.ok) setAppointments(await res.json());
    } else {
      // Fetch all days of the week
      const allAppts: ScheduleItem[] = [];
      const promises = weekDates.map(async (d) => {
        const res = await fetch(`/api/schedule?date=${d}`);
        if (res.ok) {
          const data = await res.json();
          allAppts.push(...data);
        }
      });
      await Promise.all(promises);
      setAppointments(allAppts);
    }
  }, [date, viewMode, weekDates]);

  // Fetch doctor availability
  useEffect(() => {
    async function fetchAvailability() {
      const avail: Record<string, DoctorAvailability> = {};
      await Promise.all(
        visibleDoctors.map(async (doc) => {
          const res = await fetch(`/api/doctor-schedule?doctorId=${doc.id}`);
          if (res.ok) avail[doc.id] = await res.json();
        })
      );
      setAvailability(avail);
    }
    if (visibleDoctors.length > 0) fetchAvailability();
  }, [visibleDoctors]);

  useEffect(() => {
    fetchSchedule();
    const id = setInterval(fetchSchedule, 5000);
    return () => clearInterval(id);
  }, [fetchSchedule]);

  function isSlotAvailable(doctorId: string, time: string, forDate?: string): boolean {
    const a = availability[doctorId];
    if (!a) return true; // no schedule data = assume available
    const targetDate = forDate || date;
    const d = new Date(targetDate + "T12:00:00");
    const dow = d.getDay();
    // Check day off
    if (a.daysOff.some((off) => off.date.startsWith(targetDate))) return false;
    // Check work schedule
    const daySchedule = a.schedules.find((s) => s.dayOfWeek === dow);
    if (!daySchedule || !daySchedule.isActive) return false;
    // Check time within working hours
    if (time < daySchedule.startTime || time >= daySchedule.endTime) return false;
    return true;
  }

  function changeDate(offset: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + offset);
    setDate(d.toISOString().split("T")[0]);
  }

  function getAppointmentAt(doctorId: string, time: string, forDate?: string): ScheduleItem | undefined {
    const targetDate = forDate || date;
    return appointments.find((a) => {
      if (a.doctor.id !== doctorId) return false;
      const aDate = new Date(a.date);
      const aDateStr = aDate.toISOString().split("T")[0];
      if (aDateStr !== targetDate) return false;
      const h = aDate.getHours();
      const m = aDate.getMinutes();
      const slotTime = `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
      return slotTime === time;
    });
  }

  // Current time position
  const now = new Date();
  const isToday = date === now.toISOString().split("T")[0];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const gridStart = 8 * 60; // 08:00
  const gridEnd = 17 * 60; // 17:00
  const timeLinePercent = isToday && currentMinutes >= gridStart && currentMinutes <= gridEnd
    ? ((currentMinutes - gridStart) / (gridEnd - gridStart)) * 100
    : -1;

  const dateObj = new Date(date + "T12:00:00");
  const dateLabel = dateObj.toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">{labels.title}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("day")}
              className={`px-3 py-1 text-xs font-medium transition-colors ${viewMode === "day" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            >
              {locale === "ru" ? "День" : "Kun"}
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1 text-xs font-medium transition-colors ${viewMode === "week" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
            >
              {locale === "ru" ? "Неделя" : "Hafta"}
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => changeDate(viewMode === "week" ? -7 : -1)} className="h-8 w-8 p-0 rounded-lg">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            onClick={() => setDate(new Date().toISOString().split("T")[0])}
            className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-secondary transition-colors"
          >
            {labels.today}
          </button>
          <span className="text-sm font-medium min-w-[140px] text-center">{dateLabel}</span>
          <Button variant="ghost" size="sm" onClick={() => changeDate(viewMode === "week" ? 7 : 1)} className="h-8 w-8 p-0 rounded-lg">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-x-auto">
        <div className="min-w-[600px] relative">
          {/* Current time line (day view only) */}
          {viewMode === "day" && timeLinePercent >= 0 && (
            <div
              className="absolute left-0 right-0 z-10 border-t-2 border-red-500 pointer-events-none"
              style={{ top: `${44 + (timeLinePercent / 100) * (SLOTS.length * 48)}px` }}
            >
              <div className="absolute -left-0 -top-1.5 h-3 w-3 rounded-full bg-red-500" />
            </div>
          )}

          {viewMode === "day" ? (
            <>
              {/* Day view: columns = doctors */}
              <div className="flex border-b border-border/40 sticky top-0 bg-white z-20">
                <div className="w-16 shrink-0 px-2 py-3 text-xs font-semibold text-muted-foreground" />
                {visibleDoctors.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex-1 min-w-[140px] px-2 py-3 text-center border-l border-border/40"
                  >
                    <p className="text-xs font-semibold truncate">{doc.name[locale]}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{doc.specialty[locale]}</p>
                  </div>
                ))}
              </div>

              {SLOTS.map((time) => (
                <div key={time} className="flex border-b border-border/20 hover:bg-secondary/20 transition-colors">
                  <div className="w-16 shrink-0 px-2 py-3 text-xs text-muted-foreground font-mono tabular-nums">
                    {time}
                  </div>
                  {visibleDoctors.map((doc) => {
                    const appt = getAppointmentAt(doc.id, time);
                    const available = isSlotAvailable(doc.id, time);
                    return (
                      <div
                        key={doc.id}
                        className={`flex-1 min-w-[140px] px-1 py-1 border-l border-border/20 min-h-[48px] ${!available && !appt ? "bg-secondary/40" : ""}`}
                      >
                        {appt ? (
                          <div className={`rounded-lg border px-2 py-1.5 text-xs h-full ${STATUS_COLORS[appt.queueStatus] || ""}`}>
                            <p className="font-medium truncate">{appt.patient.fullName}</p>
                            <p className="text-[10px] opacity-70 truncate">{appt.service || ""}</p>
                          </div>
                        ) : available ? (
                          <button
                            onClick={() => setAddDialog({ doctorId: doc.id, time })}
                            className="w-full h-full rounded-lg hover:bg-primary/5 hover:border-primary/20 border border-transparent transition-colors flex items-center justify-center opacity-0 hover:opacity-100"
                          >
                            <Plus className="h-3.5 w-3.5 text-primary/50" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          ) : (
            <>
              {/* Week view: columns = days (Mon-Sat), rows per doctor */}
              {visibleDoctors.map((doc) => (
                <div key={doc.id} className="border-b border-border/40">
                  {/* Doctor name banner */}
                  <div className="bg-secondary/30 px-4 py-2 sticky top-0 z-20 border-b border-border/40">
                    <p className="text-xs font-semibold">{doc.name[locale]}</p>
                    <p className="text-[10px] text-muted-foreground">{doc.specialty[locale]}</p>
                  </div>

                  {/* Day headers */}
                  <div className="flex border-b border-border/40 sticky top-[44px] bg-white z-10">
                    <div className="w-16 shrink-0 px-2 py-2 text-xs font-semibold text-muted-foreground" />
                    {weekDates.map((wd) => {
                      const wdObj = new Date(wd + "T12:00:00");
                      const dayName = wdObj.toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ", { weekday: "short" });
                      const dayNum = wdObj.getDate();
                      const isWdToday = wd === now.toISOString().split("T")[0];
                      return (
                        <div
                          key={wd}
                          className={`flex-1 min-w-[100px] px-1 py-2 text-center border-l border-border/40 ${isWdToday ? "bg-primary/5" : ""}`}
                        >
                          <p className="text-[10px] text-muted-foreground uppercase">{dayName}</p>
                          <p className={`text-sm font-semibold ${isWdToday ? "text-primary" : ""}`}>{dayNum}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Time slots × days */}
                  {SLOTS.map((time) => (
                    <div key={time} className="flex border-b border-border/20 hover:bg-secondary/20 transition-colors">
                      <div className="w-16 shrink-0 px-2 py-2 text-xs text-muted-foreground font-mono tabular-nums">
                        {time}
                      </div>
                      {weekDates.map((wd) => {
                        const appt = getAppointmentAt(doc.id, time, wd);
                        const isWdToday = wd === now.toISOString().split("T")[0];
                        const available = isSlotAvailable(doc.id, time, wd);
                        return (
                          <div
                            key={wd}
                            className={`flex-1 min-w-[100px] px-0.5 py-0.5 border-l border-border/20 min-h-[40px] ${!available && !appt ? "bg-secondary/40" : isWdToday ? "bg-primary/[0.02]" : ""}`}
                          >
                            {appt ? (
                              <div className={`rounded-md border px-1.5 py-1 text-[11px] h-full ${STATUS_COLORS[appt.queueStatus] || ""}`}>
                                <p className="font-medium truncate">{appt.patient.fullName}</p>
                              </div>
                            ) : available ? (
                              <button
                                onClick={() => setAddDialog({ doctorId: doc.id, time, date: wd })}
                                className="w-full h-full rounded-md hover:bg-primary/5 border border-transparent transition-colors flex items-center justify-center opacity-0 hover:opacity-100"
                              >
                                <Plus className="h-3 w-3 text-primary/50" />
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Add appointment dialog */}
      {addDialog && (
        <AddScheduleDialog
          doctorId={addDialog.doctorId}
          date={addDialog.date || date}
          time={addDialog.time}
          locale={locale}
          labels={labels}
          onClose={() => { setAddDialog(null); fetchSchedule(); }}
        />
      )}
    </div>
  );
}

function AddScheduleDialog({
  doctorId,
  date,
  time,
  locale,
  labels,
  onClose,
}: {
  doctorId: string;
  date: string;
  time: string;
  locale: Locale;
  labels: typeof t.ru;
  onClose: () => void;
}) {
  const doctors = useDoctors();
  const doctor = doctors.find((d) => d.id === doctorId);

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [passport, setPassport] = useState("");
  const [service, setService] = useState("");
  const [foundPatient, setFoundPatient] = useState<Patient | null>(null);
  const [searched, setSearched] = useState(false);

  async function searchPatient() {
    if (phone.length < 4) return;
    const res = await fetch(`/api/patients?search=${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (data.length > 0) {
      setFoundPatient(data[0]);
      setName(data[0].fullName);
    } else {
      setFoundPatient(null);
    }
    setSearched(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Create/find patient
    const patientRes = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: name, phone, passport: passport || undefined }),
    });
    const patient = await patientRes.json();

    // Create scheduled appointment
    const dateTime = `${date}T${time}:00`;
    await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId: patient.id, doctorId, service: service || undefined, date: dateTime }),
    });

    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl mx-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">{labels.addAppointment}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          {doctor?.name[locale]} — {time}, {new Date(date + "T12:00:00").toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">{labels.phone}</label>
            <div className="mt-1 flex gap-2">
              <Input
                required
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setSearched(false); setFoundPatient(null); }}
                placeholder="+998 XX XXX XX XX"
                className="h-10 rounded-lg flex-1"
              />
              <Button type="button" onClick={searchPatient} variant="outline" className="h-10 rounded-lg px-3">
                <Search className="h-4 w-4" />
              </Button>
            </div>
            {searched && foundPatient && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <User className="h-3 w-3" /> {foundPatient.fullName}
              </p>
            )}
            {searched && !foundPatient && (
              <p className="text-xs text-amber-600 mt-1">{labels.newPatient}</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">{labels.name}</label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-10 rounded-lg" />
          </div>

          <div>
            <label className="text-sm font-medium">{labels.passport}</label>
            <Input value={passport} onChange={(e) => setPassport(e.target.value)} placeholder="AA1234567" className="mt-1 h-10 rounded-lg" />
          </div>

          {doctor && doctor.services.length > 0 && (
            <div>
              <label className="text-sm font-medium">{labels.service}</label>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {doctor.services.map((svc) => (
                  <option key={svc.name[locale]} value={svc.name[locale]}>{svc.name[locale]}</option>
                ))}
              </select>
            </div>
          )}

          <Button type="submit" className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/85">
            {labels.save}
          </Button>
        </form>
      </div>
    </div>
  );
}

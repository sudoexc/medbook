"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { Save, Plus, Trash2, Clock, CalendarOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDoctors } from "@/components/providers/doctors-provider";
import type { Locale } from "@/types";

interface ScheduleDay {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

interface DayOff {
  id: string;
  date: string;
  reason: string | null;
}

const DAY_NAMES = {
  ru: ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"],
  uz: ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"],
};

const t = {
  ru: {
    title: "График работы",
    workSchedule: "Рабочие дни",
    daysOff: "Выходные и отпуска",
    start: "Начало",
    end: "Конец",
    active: "Работает",
    save: "Сохранить",
    saved: "Сохранено!",
    addDayOff: "Добавить выходной",
    date: "Дата",
    reason: "Причина",
    reasonPlaceholder: "Отпуск, больничный...",
    add: "Добавить",
    noDaysOff: "Нет запланированных выходных",
    selectDoctor: "Выберите врача",
  },
  uz: {
    title: "Ish jadvali",
    workSchedule: "Ish kunlari",
    daysOff: "Dam olish va ta'tillar",
    start: "Boshlanishi",
    end: "Tugashi",
    active: "Ishlaydi",
    save: "Saqlash",
    saved: "Saqlandi!",
    addDayOff: "Dam olish qo'shish",
    date: "Sana",
    reason: "Sabab",
    reasonPlaceholder: "Ta'til, kasallik...",
    add: "Qo'shish",
    noDaysOff: "Rejalashtirilgan dam olish kunlari yo'q",
    selectDoctor: "Shifokorni tanlang",
  },
};

export default function SettingsPage() {
  const locale = useLocale() as Locale;
  const labels = t[locale];
  const { data: session } = useSession();
  const doctors = useDoctors();

  const isAdmin = session?.user?.role === "ADMIN";
  const [doctorId, setDoctorId] = useState("");
  const [schedules, setSchedules] = useState<ScheduleDay[]>([]);
  const [daysOff, setDaysOff] = useState<DayOff[]>([]);
  const [saved, setSaved] = useState(false);

  // Day off form
  const [newDayOffDate, setNewDayOffDate] = useState("");
  const [newDayOffReason, setNewDayOffReason] = useState("");

  useEffect(() => {
    if (!doctorId && session?.user?.doctorId) {
      setDoctorId(session.user.doctorId);
    }
  }, [session, doctorId]);

  const fetchSchedule = useCallback(async () => {
    if (!doctorId) return;
    try {
      const res = await fetch(`/api/doctor-schedule?doctorId=${doctorId}`);
      if (!res.ok) {
        toast.error("Не удалось загрузить расписание");
        return;
      }
      const data = await res.json();
      // Ensure all 7 days exist
      const allDays: ScheduleDay[] = [];
      for (let i = 0; i < 7; i++) {
        const existing = data.schedules.find((s: ScheduleDay) => s.dayOfWeek === i);
        allDays.push(existing || { dayOfWeek: i, startTime: "08:00", endTime: "17:00", isActive: false });
      }
      setSchedules(allDays);
      setDaysOff(data.daysOff);
    } catch {
      toast.error("Сетевая ошибка");
    }
  }, [doctorId]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  async function handleSave() {
    try {
      const res = await fetch("/api/doctor-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, schedules }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Не удалось сохранить");
        return;
      }
      setSaved(true);
      toast.success("Расписание сохранено");
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("Сетевая ошибка");
    }
  }

  async function addDayOff() {
    if (!newDayOffDate) return;
    try {
      const res = await fetch("/api/doctor-schedule/days-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, date: newDayOffDate, reason: newDayOffReason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Не удалось добавить выходной");
        return;
      }
      setNewDayOffDate("");
      setNewDayOffReason("");
      fetchSchedule();
    } catch {
      toast.error("Сетевая ошибка");
    }
  }

  async function removeDayOff(id: string) {
    try {
      const res = await fetch("/api/doctor-schedule/days-off", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        toast.error("Не удалось удалить");
        return;
      }
      fetchSchedule();
    } catch {
      toast.error("Сетевая ошибка");
    }
  }

  function updateDay(dayOfWeek: number, field: keyof ScheduleDay, value: string | boolean) {
    setSchedules((prev) =>
      prev.map((s) => (s.dayOfWeek === dayOfWeek ? { ...s, [field]: value } : s))
    );
  }

  // Reorder: Mon-Sat, then Sun
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{labels.title}</h1>
        {isAdmin && (
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            <option value="">{labels.selectDoctor}</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name[locale]}</option>
            ))}
          </select>
        )}
      </div>

      {/* Weekly schedule */}
      <div className="rounded-2xl border border-border/40 bg-white shadow-sm">
        <div className="border-b border-border/40 px-6 py-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{labels.workSchedule}</h2>
        </div>
        <div className="p-4 space-y-2">
          {orderedDays.map((day) => {
            const s = schedules.find((sc) => sc.dayOfWeek === day);
            if (!s) return null;
            return (
              <div
                key={day}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
                  s.isActive ? "bg-white" : "bg-secondary/30 opacity-60"
                }`}
              >
                <label className="flex items-center gap-2 cursor-pointer min-w-[140px]">
                  <input
                    type="checkbox"
                    checked={s.isActive}
                    onChange={(e) => updateDay(day, "isActive", e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className={`text-sm font-medium ${s.isActive ? "" : "text-muted-foreground"}`}>
                    {DAY_NAMES[locale][day]}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={s.startTime}
                    onChange={(e) => updateDay(day, "startTime", e.target.value)}
                    disabled={!s.isActive}
                    className="rounded-lg border border-border px-2 py-1.5 text-sm disabled:opacity-40"
                  />
                  <span className="text-muted-foreground">—</span>
                  <input
                    type="time"
                    value={s.endTime}
                    onChange={(e) => updateDay(day, "endTime", e.target.value)}
                    disabled={!s.isActive}
                    className="rounded-lg border border-border px-2 py-1.5 text-sm disabled:opacity-40"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border/40 px-6 py-4">
          <Button onClick={handleSave} className="h-10 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/85">
            <Save className="mr-2 h-4 w-4" />
            {saved ? labels.saved : labels.save}
          </Button>
        </div>
      </div>

      {/* Days off */}
      <div className="rounded-2xl border border-border/40 bg-white shadow-sm">
        <div className="border-b border-border/40 px-6 py-4 flex items-center gap-2">
          <CalendarOff className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{labels.daysOff}</h2>
        </div>

        {/* Add day off */}
        <div className="px-6 py-4 border-b border-border/40 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{labels.date}</label>
            <input
              type="date"
              value={newDayOffDate}
              onChange={(e) => setNewDayOffDate(e.target.value)}
              className="mt-1 block rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="text-xs font-medium text-muted-foreground">{labels.reason}</label>
            <input
              value={newDayOffReason}
              onChange={(e) => setNewDayOffReason(e.target.value)}
              placeholder={labels.reasonPlaceholder}
              className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={addDayOff} size="sm" className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/85">
            <Plus className="mr-1 h-4 w-4" />
            {labels.add}
          </Button>
        </div>

        {/* List */}
        {daysOff.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">{labels.noDaysOff}</div>
        ) : (
          <div className="divide-y divide-border/40">
            {daysOff.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {new Date(d.date).toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ", {
                      weekday: "short", day: "numeric", month: "long",
                    })}
                  </p>
                  {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
                </div>
                <button
                  onClick={() => removeDayOff(d.id)}
                  className="rounded-lg p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

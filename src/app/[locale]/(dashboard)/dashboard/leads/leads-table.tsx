"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Check, Phone, X, ChevronDown, AlertCircle } from "lucide-react";
import type { DoctorView } from "@/lib/doctors";
import type { Locale } from "@/types";
import { tashkentToday, isSlotPast } from "@/lib/tashkent-time";

interface Lead {
  id: string;
  name: string;
  phone: string;
  doctorId: string | null;
  service: string | null;
  date: string | null;
  status: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, Record<string, string>> = {
  NEW: { ru: "Новая", uz: "Yangi" },
  CONTACTED: { ru: "На связи", uz: "Bog'lanildi" },
  CONVERTED: { ru: "Записан", uz: "Yozilgan" },
  CANCELLED: { ru: "Отменена", uz: "Bekor" },
};

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-amber-100 text-amber-800 border-amber-200",
  CONTACTED: "bg-blue-100 text-blue-800 border-blue-200",
  CONVERTED: "bg-green-100 text-green-800 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-600 border-gray-200",
};

export function LeadsTable({
  leads,
  doctors,
  locale,
  canBook,
}: {
  leads: Lead[];
  doctors: DoctorView[];
  locale: Locale;
  canBook: boolean;
}) {
  const router = useRouter();
  const [bookingLead, setBookingLead] = useState<Lead | null>(null);

  const isRu = locale === "ru";

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, skipAppointment: true }),
    });
    router.refresh();
  }

  const newCount = leads.filter((l) => l.status === "NEW").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {isRu ? "Заявки с сайта" : "Sayt so'rovlari"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRu
              ? `Всего: ${leads.length} · Новых: ${newCount}`
              : `Jami: ${leads.length} · Yangi: ${newCount}`}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-secondary/30 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left font-semibold">{isRu ? "Имя" : "Ism"}</th>
                <th className="px-4 py-3 text-left font-semibold">{isRu ? "Телефон" : "Telefon"}</th>
                <th className="px-4 py-3 text-left font-semibold">{isRu ? "Врач" : "Shifokor"}</th>
                <th className="px-4 py-3 text-left font-semibold">{isRu ? "Услуга" : "Xizmat"}</th>
                <th className="px-4 py-3 text-left font-semibold">{isRu ? "Желаемая дата" : "Xohlagan sana"}</th>
                <th className="px-4 py-3 text-left font-semibold">{isRu ? "Статус" : "Status"}</th>
                <th className="px-4 py-3 text-left font-semibold">{isRu ? "Получена" : "Olingan"}</th>
                {canBook && <th className="px-4 py-3 text-right font-semibold">{isRu ? "Действия" : "Harakatlar"}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={canBook ? 8 : 7} className="px-4 py-16 text-center text-muted-foreground">
                    {isRu ? "Заявок пока нет" : "Hali so'rovlar yo'q"}
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const doctor = doctors.find((d) => d.id === lead.doctorId);
                  const isNew = lead.status === "NEW";
                  return (
                    <tr
                      key={lead.id}
                      className={`hover:bg-secondary/30 transition-colors ${isNew ? "bg-amber-50/40" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium">
                        {isNew && <span className="inline-block h-2 w-2 rounded-full bg-amber-500 mr-2 animate-pulse" />}
                        {lead.name}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={`tel:${lead.phone}`}
                          className="flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {lead.phone}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {doctor ? doctor.name[locale] : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                        {lead.service || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lead.date || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative inline-block">
                          <select
                            value={lead.status}
                            onChange={(e) => updateStatus(lead.id, e.target.value)}
                            className={`appearance-none rounded-lg border pl-3 pr-7 py-1.5 text-xs font-semibold cursor-pointer ${STATUS_COLORS[lead.status] || ""}`}
                          >
                            {Object.entries(STATUS_LABELS).map(([key, labels]) => (
                              <option key={key} value={key}>
                                {labels[locale]}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-60" />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(lead.createdAt).toLocaleString(isRu ? "ru-RU" : "uz-UZ", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      {canBook && (
                        <td className="px-4 py-3 text-right">
                          {lead.status !== "CONVERTED" && lead.status !== "CANCELLED" ? (
                            <button
                              onClick={() => setBookingLead(lead)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/85 transition-colors"
                            >
                              <Calendar className="h-3 w-3" />
                              {isRu ? "Записать" : "Yozish"}
                            </button>
                          ) : lead.status === "CONVERTED" ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                              <Check className="h-3 w-3" />
                              {isRu ? "Записан" : "Yozilgan"}
                            </span>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {bookingLead && (
        <BookingDialog
          lead={bookingLead}
          doctors={doctors}
          locale={locale}
          onClose={() => setBookingLead(null)}
          onSuccess={() => {
            setBookingLead(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BookingDialog({
  lead,
  doctors,
  locale,
  onClose,
  onSuccess,
}: {
  lead: Lead;
  doctors: DoctorView[];
  locale: Locale;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isRu = locale === "ru";
  const [doctorId, setDoctorId] = useState(lead.doctorId || "");
  const [date, setDate] = useState(() => {
    if (lead.date && /^\d{4}-\d{2}-\d{2}$/.test(lead.date) && lead.date >= tashkentToday()) {
      return lead.date;
    }
    return tashkentToday();
  });
  const [time, setTime] = useState("09:00");
  const [service, setService] = useState(lead.service || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedDoctor = doctors.find((d) => d.id === doctorId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!doctorId) {
      setError(isRu ? "Выберите врача" : "Shifokorni tanlang");
      return;
    }
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/api/leads/${lead.id}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorId,
          service: service || undefined,
          date,
          time,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Booking failed");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : (isRu ? "Ошибка записи" : "Xatolik"));
      setLoading(false);
    }
  }

  const allTimes: string[] = [];
  for (let h = 8; h <= 16; h++) {
    allTimes.push(`${String(h).padStart(2, "0")}:00`);
    allTimes.push(`${String(h).padStart(2, "0")}:30`);
  }
  const times = allTimes.filter((t) => !isSlotPast(date, t));
  useEffect(() => {
    if (times.length > 0 && !times.includes(time)) {
      setTime(times[0]);
    }
  }, [date, time, times]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold">{isRu ? "Записать на приём" : "Qabulga yozish"}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{lead.name} · {lead.phone}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">{isRu ? "Врач" : "Shifokor"} *</label>
            <select
              required
              value={doctorId}
              onChange={(e) => { setDoctorId(e.target.value); setService(""); }}
              className="mt-1 flex h-10 w-full rounded-lg border border-input bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">{isRu ? "— выбрать —" : "— tanlang —"}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name[locale]} — {d.specialty[locale]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">{isRu ? "Дата" : "Sana"} *</label>
              <input
                required
                type="date"
                value={date}
                min={tashkentToday()}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{isRu ? "Время" : "Vaqt"} *</label>
              <select
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
              >
                {times.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedDoctor && selectedDoctor.services.length > 0 && (
            <div>
              <label className="text-sm font-medium">{isRu ? "Услуга" : "Xizmat"}</label>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"
              >
                <option value="">—</option>
                {selectedDoctor.services.map((s) => (
                  <option key={s.name[locale]} value={s.name[locale]}>
                    {s.name[locale]} — {s.price.toLocaleString("ru-RU")} {isRu ? "сум" : "so'm"}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary"
            >
              {isRu ? "Отмена" : "Bekor"}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
            >
              {loading ? "..." : (isRu ? "Записать" : "Yozish")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

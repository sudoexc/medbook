"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import {
  Play,
  CheckCircle,
  SkipForward,
  UserPlus,
  Clock,
  Phone,
  User,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDoctors } from "@/components/providers/doctors-provider";
import type { Locale } from "@/types";

interface Patient {
  id: string;
  fullName: string;
  phone: string;
  passport?: string | null;
}

interface QueueItem {
  id: string;
  patientId: string;
  patient: Patient;
  doctorId: string;
  service: string | null;
  queueOrder: number | null;
  queueStatus: string;
  source: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMin: number | null;
}

const t = {
  ru: {
    title: "Очередь пациентов",
    current: "Текущий пациент",
    noCurrent: "Никого на приёме",
    waiting: "Ожидают",
    completed: "Завершены сегодня",
    empty: "Очередь пуста",
    start: "Начать",
    complete: "Завершить",
    skip: "Пропустить",
    addWalkin: "Добавить пациента",
    online: "Онлайн",
    walkin: "Пришёл",
    timer: "Время приёма",
    searchPhone: "Поиск по телефону",
    patientName: "ФИО пациента",
    phone: "Телефон",
    passport: "Паспорт (необязательно)",
    service: "Услуга",
    add: "Добавить в очередь",
    cancel: "Отмена",
    newPatient: "Новый пациент",
    min: "мин",
    selectDoctor: "Выберите врача",
    seen: "Принято сегодня",
    avgTime: "Среднее время",
    notes: "Заметки по приёму",
    notesPlaceholder: "Диагноз, назначения, рекомендации...",
    completeAndSave: "Завершить приём",
    complaints: "Жалобы",
    diagnosis: "Диагноз",
    prescriptions: "Назначения",
    recommendations: "Рекомендации",
    payment: "Оплата",
    amount: "Сумма (сум)",
    paymentMethod: "Способ оплаты",
    cash: "Наличные",
    card: "Карта",
    transfer: "Перевод",
    paid: "Оплачено",
    unpaid: "Не оплачено",
    medCard: "Медкарта",
  },
  uz: {
    title: "Bemorlar navbati",
    current: "Hozirgi bemor",
    noCurrent: "Qabulda hech kim yo'q",
    waiting: "Kutmoqda",
    completed: "Bugun tugallangan",
    empty: "Navbat bo'sh",
    start: "Boshlash",
    complete: "Tugatish",
    skip: "O'tkazish",
    addWalkin: "Bemor qo'shish",
    online: "Onlayn",
    walkin: "Kelgan",
    timer: "Qabul vaqti",
    searchPhone: "Telefon bo'yicha qidirish",
    patientName: "Bemor ismi",
    phone: "Telefon",
    passport: "Pasport (ixtiyoriy)",
    service: "Xizmat",
    add: "Navbatga qo'shish",
    cancel: "Bekor qilish",
    newPatient: "Yangi bemor",
    min: "daq",
    selectDoctor: "Shifokorni tanlang",
    seen: "Bugun qabul qilindi",
    avgTime: "O'rtacha vaqt",
    notes: "Qabul haqida eslatmalar",
    notesPlaceholder: "Tashxis, buyurmalar, tavsiyalar...",
    completeAndSave: "Qabulni tugatish",
    complaints: "Shikoyatlar",
    diagnosis: "Tashxis",
    prescriptions: "Buyurmalar",
    recommendations: "Tavsiyalar",
    payment: "To'lov",
    amount: "Summa (so'm)",
    paymentMethod: "To'lov usuli",
    cash: "Naqd",
    card: "Karta",
    transfer: "O'tkazma",
    paid: "To'langan",
    unpaid: "To'lanmagan",
    medCard: "Tibbiy karta",
  },
};

function Timer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <span className="tabular-nums font-mono text-lg font-bold">
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </span>
  );
}

export default function QueuePage() {
  const locale = useLocale() as Locale;
  const labels = t[locale];
  const { data: session } = useSession();
  const doctors = useDoctors();

  const [doctorId, setDoctorId] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [completed, setCompleted] = useState<QueueItem[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [completeDialog, setCompleteDialog] = useState<string | null>(null); // appointmentId

  const isAdmin = session?.user?.role === "ADMIN";

  // Set default doctorId
  useEffect(() => {
    if (!doctorId && session?.user?.doctorId) {
      setDoctorId(session.user.doctorId);
    }
  }, [session, doctorId]);

  const fetchQueue = useCallback(async () => {
    if (!doctorId) return;
    try {
      const res = await fetch(`/api/queue?doctorId=${doctorId}`);
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue);
        setCompleted(data.completed);
      }
    } catch {}
  }, [doctorId]);

  // Poll every 5 seconds
  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, 5000);
    return () => clearInterval(id);
  }, [fetchQueue]);

  async function handleAction(appointmentId: string, action: string, notes?: string) {
    await fetch(`/api/queue/${appointmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, notes }),
    });
    fetchQueue();
  }

  async function handleComplete(data: {
    appointmentId: string;
    notes?: string;
    complaints?: string;
    diagnosis?: string;
    prescriptions?: string;
    recommendations?: string;
    paymentAmount?: number;
    paymentMethod?: string;
    paymentStatus?: string;
  }) {
    await fetch(`/api/queue/${data.appointmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", ...data }),
    });
    fetchQueue();
  }

  const currentPatient = queue.find((q) => q.queueStatus === "IN_PROGRESS");
  const waiting = queue.filter((q) => q.queueStatus === "WAITING");

  const avgDuration = completed.length > 0
    ? Math.round(completed.reduce((sum, c) => sum + (c.durationMin || 0), 0) / completed.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">{labels.title}</h1>
        <div className="flex gap-3">
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
          <Button
            onClick={() => setShowAddDialog(true)}
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/85"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {labels.addWalkin}
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border/40 bg-white p-4">
          <p className="text-sm text-muted-foreground">{labels.waiting}</p>
          <p className="text-2xl font-bold mt-1">{waiting.length}</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-white p-4">
          <p className="text-sm text-muted-foreground">{labels.seen}</p>
          <p className="text-2xl font-bold mt-1">{completed.length}</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-white p-4 hidden sm:block">
          <p className="text-sm text-muted-foreground">{labels.avgTime}</p>
          <p className="text-2xl font-bold mt-1">{avgDuration} {labels.min}</p>
        </div>
      </div>

      {/* Current patient */}
      <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-6">
        <p className="text-sm font-medium text-primary mb-3">{labels.current}</p>
        {currentPatient ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xl font-bold">{currentPatient.patient.fullName}</p>
              <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {currentPatient.patient.phone}</span>
                {currentPatient.service && <span>{currentPatient.service}</span>}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Clock className="h-4 w-4 text-primary" />
                <Timer startedAt={currentPatient.startedAt!} />
              </div>
            </div>
            <Button
              onClick={() => setCompleteDialog(currentPatient.id)}
              className="h-10 rounded-lg bg-green-600 px-6 text-sm font-semibold text-white hover:bg-green-700"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {labels.complete}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">{labels.noCurrent}</p>
        )}
      </div>

      {/* Waiting list */}
      <div className="rounded-2xl border border-border/40 bg-white shadow-sm">
        <div className="border-b border-border/40 px-6 py-4">
          <h2 className="text-lg font-semibold">{labels.waiting} ({waiting.length})</h2>
        </div>
        {waiting.length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground">{labels.empty}</div>
        ) : (
          <div className="divide-y divide-border/40">
            {waiting.map((item, i) => (
              <div key={item.id} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium">{item.patient.fullName}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{item.patient.phone}</span>
                      {item.service && <span>{item.service}</span>}
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
                        item.source === "ONLINE" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                      }`}>
                        {item.source === "ONLINE" ? labels.online : labels.walkin}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleAction(item.id, "start")}
                    size="sm"
                    className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/85"
                  >
                    <Play className="mr-1 h-3 w-3" />
                    {labels.start}
                  </Button>
                  <Button
                    onClick={() => handleAction(item.id, "skip")}
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <SkipForward className="mr-1 h-3 w-3" />
                    {labels.skip}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completed today */}
      {completed.length > 0 && (
        <div className="rounded-2xl border border-border/40 bg-white shadow-sm">
          <div className="border-b border-border/40 px-6 py-4">
            <h2 className="text-lg font-semibold">{labels.completed} ({completed.length})</h2>
          </div>
          <div className="divide-y divide-border/40">
            {completed.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-6 py-4 opacity-60">
                <div>
                  <p className="font-medium">{item.patient.fullName}</p>
                  <p className="text-xs text-muted-foreground">{item.service || ""}</p>
                </div>
                <span className="text-sm text-muted-foreground">
                  {item.durationMin != null ? `${item.durationMin} ${labels.min}` : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Complete with EMR + payment dialog */}
      {completeDialog && (
        <CompleteDialog
          appointmentId={completeDialog}
          currentPatient={currentPatient}
          labels={labels}
          onClose={() => setCompleteDialog(null)}
          onComplete={(data) => { handleComplete(data); setCompleteDialog(null); }}
        />
      )}

      {/* Add walk-in dialog */}
      {showAddDialog && (
        <AddWalkinDialog
          doctorId={doctorId}
          locale={locale}
          labels={labels}
          onClose={() => { setShowAddDialog(false); fetchQueue(); }}
        />
      )}
    </div>
  );
}

function CompleteDialog({
  appointmentId,
  currentPatient,
  labels,
  onClose,
  onComplete,
}: {
  appointmentId: string;
  currentPatient: QueueItem | undefined;
  labels: typeof t.ru;
  onClose: () => void;
  onComplete: (data: {
    appointmentId: string;
    notes?: string;
    complaints?: string;
    diagnosis?: string;
    prescriptions?: string;
    recommendations?: string;
    paymentAmount?: number;
    paymentMethod?: string;
    paymentStatus?: string;
  }) => void;
}) {
  const [tab, setTab] = useState<"emr" | "payment">("emr");
  const [complaints, setComplaints] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [prescriptions, setPrescriptions] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentStatus, setPaymentStatus] = useState("PAID");

  const doctors = useDoctors();
  const doctor = currentPatient ? doctors.find((d) => d.id === currentPatient.doctorId) : null;

  // Auto-fill price from service
  useEffect(() => {
    if (currentPatient?.service && doctor) {
      const svc = doctor.services.find(
        (s) => s.name.ru === currentPatient.service || s.name.uz === currentPatient.service
      );
      if (svc) setPaymentAmount(String(svc.price));
    }
  }, [currentPatient, doctor]);

  function handleSubmit() {
    onComplete({
      appointmentId,
      notes: notes || undefined,
      complaints: complaints || undefined,
      diagnosis: diagnosis || undefined,
      prescriptions: prescriptions || undefined,
      recommendations: recommendations || undefined,
      paymentAmount: paymentAmount ? parseInt(paymentAmount) : undefined,
      paymentMethod,
      paymentStatus,
    });
  }

  const textareaClass = "mt-1 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h3 className="text-lg font-bold">{labels.complete}</h3>
            {currentPatient && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {currentPatient.patient.fullName} — {currentPatient.service || ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/40 px-6">
          <button
            onClick={() => setTab("emr")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "emr" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {labels.medCard}
          </button>
          <button
            onClick={() => setTab("payment")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "payment" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {labels.payment}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {tab === "emr" ? (
            <>
              <div>
                <label className="text-sm font-medium">{labels.complaints}</label>
                <textarea value={complaints} onChange={(e) => setComplaints(e.target.value)} rows={2} className={textareaClass} placeholder="..." />
              </div>
              <div>
                <label className="text-sm font-medium">{labels.diagnosis}</label>
                <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} className={textareaClass} placeholder="..." />
              </div>
              <div>
                <label className="text-sm font-medium">{labels.prescriptions}</label>
                <textarea value={prescriptions} onChange={(e) => setPrescriptions(e.target.value)} rows={2} className={textareaClass} placeholder="..." />
              </div>
              <div>
                <label className="text-sm font-medium">{labels.recommendations}</label>
                <textarea value={recommendations} onChange={(e) => setRecommendations(e.target.value)} rows={2} className={textareaClass} placeholder="..." />
              </div>
              <div>
                <label className="text-sm font-medium">{labels.notes}</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={textareaClass} placeholder={labels.notesPlaceholder} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium">{labels.amount}</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{labels.paymentMethod}</label>
                <div className="mt-2 flex gap-2">
                  {([["CASH", labels.cash], ["CARD", labels.card], ["TRANSFER", labels.transfer]] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setPaymentMethod(val)}
                      className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                        paymentMethod === val
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Status</label>
                <div className="mt-2 flex gap-2">
                  {([["PAID", labels.paid], ["UNPAID", labels.unpaid]] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setPaymentStatus(val)}
                      className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                        paymentStatus === val
                          ? val === "PAID" ? "border-green-500 bg-green-50 text-green-700" : "border-amber-500 bg-amber-50 text-amber-700"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Submit */}
        <div className="px-6 pb-5 pt-3">
          <Button
            onClick={handleSubmit}
            className="w-full h-10 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700"
          >
            <CheckCircle className="mr-2 h-4 w-4" />
            {labels.completeAndSave}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddWalkinDialog({
  doctorId,
  locale,
  labels,
  onClose,
}: {
  doctorId: string;
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
      setPassport(data[0].passport || "");
    } else {
      setFoundPatient(null);
    }
    setSearched(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Create or find patient
    const patientRes = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: name, phone, passport: passport || undefined }),
    });
    const patient = await patientRes.json();

    // Add to queue
    await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId: patient.id, doctorId, service: service || undefined }),
    });

    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl mx-4">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold">{labels.addWalkin}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phone search */}
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

          {/* Name */}
          <div>
            <label className="text-sm font-medium">{labels.patientName}</label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-10 rounded-lg"
            />
          </div>

          {/* Passport */}
          <div>
            <label className="text-sm font-medium">{labels.passport}</label>
            <Input
              value={passport}
              onChange={(e) => setPassport(e.target.value)}
              placeholder="AA1234567"
              className="mt-1 h-10 rounded-lg"
            />
          </div>

          {/* Service */}
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
                  <option key={svc.name[locale]} value={svc.name[locale]}>
                    {svc.name[locale]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button type="submit" className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/85">
            <UserPlus className="mr-2 h-4 w-4" />
            {labels.add}
          </Button>
        </form>
      </div>
    </div>
  );
}

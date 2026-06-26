"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Phone, ArrowRight, ArrowLeft, Check, Printer, MapPin, Clock, User, UserPlus, Globe, Stethoscope } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { usePublicClinicSlug } from "@/hooks/use-public-clinic-slug";

// ─── Translations ────────────────────────────────────────────────
const t = {
  ru: {
    enterPhone: "Введите номер телефона",
    enterPhoneDesc: "Для регистрации или check-in по записи",
    next: "Далее",
    searching: "Поиск...",
    back: "Назад",
    foundBooking: "Найдена запись на сегодня!",
    yourBookings: "Ваши записи на сегодня",
    getTicket: "Получить талон →",
    or: "или",
    bookOther: "Записаться к другому врачу",
    upcomingFound: "У вас есть запись",
    upcomingDesc: "На ваш номер уже оформлена запись",
    onDate: "на",
    notTodayBookWalkin: "Записаться сейчас (живая очередь)",
    firstVisit: "Вы у нас впервые! Введите ваше ФИО:",
    fioPlaceholder: "Фамилия Имя Отчество",
    selectDoctor: "Выберите врача",
    cabinet: "Кабинет",
    inQueue: "в очереди",
    confirmTitle: "Подтвердите запись",
    patient: "Пациент",
    phone: "Телефон",
    doctor: "Врач",
    beforeYou: "Перед вами",
    people: "чел.",
    confirm: "Подтвердить",
    inQueueTitle: "Вы в очереди!",
    takeTicket: "Заберите талон из принтера",
    yourNumber: "Ваш номер",
    printTicket: "Печать талона",
    newRecord: "Новая запись",
    resetIn: "Экран сбросится через 30 секунд",
    phoneError: "Введите номер телефона",
    nameError: "Введите ФИО",
    error: "Ошибка. Попробуйте ещё раз.",
    recordError: "Ошибка записи",
    selectService: "Выберите услугу",
    skipService: "Пропустить",
    service: "Услуга",
    price: "сум",
    welcome: "Добро пожаловать!",
    touchToStart: "Коснитесь экрана для начала",
  },
  uz: {
    enterPhone: "Telefon raqamingizni kiriting",
    enterPhoneDesc: "Ro'yxatdan o'tish yoki onlayn yozilish uchun",
    next: "Keyingi",
    searching: "Qidirilmoqda...",
    back: "Orqaga",
    foundBooking: "Bugungi yozilish topildi!",
    yourBookings: "Bugungi yozilishlaringiz",
    getTicket: "Talon olish →",
    or: "yoki",
    bookOther: "Boshqa shifokorga yozilish",
    upcomingFound: "Sizda yozilish bor",
    upcomingDesc: "Raqamingizga yozilish rasmiylashtirilgan",
    onDate: "sanasi",
    notTodayBookWalkin: "Hozir yozilish (jonli navbat)",
    firstVisit: "Siz birinchi marta keldingiz! F.I.Sh. kiriting:",
    fioPlaceholder: "Familiya Ism Sharif",
    selectDoctor: "Shifokorni tanlang",
    cabinet: "Kabinet",
    inQueue: "navbatda",
    confirmTitle: "Yozilishni tasdiqlang",
    patient: "Bemor",
    phone: "Telefon",
    doctor: "Shifokor",
    beforeYou: "Sizdan oldin",
    people: "kishi",
    confirm: "Tasdiqlash",
    inQueueTitle: "Siz navbatdasiz!",
    takeTicket: "Talonni printerdan oling",
    yourNumber: "Sizning raqamingiz",
    printTicket: "Talon chop etish",
    newRecord: "Yangi yozilish",
    resetIn: "Ekran 30 soniyadan so'ng qayta yuklanadi",
    phoneError: "Telefon raqamini kiriting",
    nameError: "F.I.Sh. kiriting",
    error: "Xatolik. Qayta urinib ko'ring.",
    recordError: "Yozilish xatosi",
    selectService: "Xizmatni tanlang",
    skipService: "O'tkazib yuborish",
    service: "Xizmat",
    price: "so'm",
    welcome: "Xush kelibsiz!",
    touchToStart: "Boshlash uchun ekranga bosing",
  },
};

type Lang = "ru" | "uz";

interface Doctor {
  id: string;
  nameRu: string;
  nameUz?: string;
  cabinet: string | number | null;
  color?: string | null;
  waiting: number;
  services: { nameRu: string; nameUz: string; price: number }[];
}

interface PreBooked {
  id: string;
  doctorName: string;
  cabinet: number;
  service: string | null;
  time: string;
  ticketNumber: string | null;
}

interface UpcomingBooking {
  id: string;
  doctorName: string;
  cabinet: number;
  service: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
}

type Step = "welcome" | "phone" | "checkin" | "upcoming" | "select-doctor" | "select-service" | "enter-name" | "confirm" | "done";

// Status tints shared with the /tv board — keep the two public surfaces visually
// identical. Green = active/confirmed, amber = waiting/first-visit.
const GREEN_TINT = "rgb(22 199 132 / 0.10)";
const GREEN_BORDER = "rgb(22 199 132 / 0.25)";
const GREEN_BADGE = "rgb(22 199 132 / 0.20)";
const AMBER_TINT = "rgb(245 158 11 / 0.10)";
const AMBER_BORDER = "rgb(245 158 11 / 0.25)";

export default function KioskPage() {
  const slug = usePublicClinicSlug();
  const [lang, setLang] = useState<Lang>("ru");
  const [step, setStep] = useState<Step>("welcome");
  const [phone, setPhone] = useState("");
  const [patientName, setPatientName] = useState("");
  const [foundPatientId, setFoundPatientId] = useState<string | null>(null);
  const [preBooked, setPreBooked] = useState<PreBooked[]>([]);
  const [upcomingBookings, setUpcomingBookings] = useState<UpcomingBooking[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [clinicName, setClinicName] = useState("");
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const L = t[lang];

  // Fetch today's doctors from the slug-scoped board (schedule-filtered → only
  // doctors actually working today) and merge service/price details from the
  // kiosk doctor route (which the board doesn't carry).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [boardRes, detailsRes] = await Promise.all([
          fetch(`/api/c/${slug}/queue/board`, { cache: "no-store" }),
          fetch("/api/kiosk/doctors"),
        ]);
        if (cancelled || !boardRes.ok) return;
        const board: { clinic?: { nameRu: string }; doctors: { id: string; nameRu: string; nameUz: string; cabinet: string | null; color: string | null; waiting: { id: string }[] }[] } = await boardRes.json();
        const details: { id: string; nameRu: string; nameUz: string; cabinet: number; services: { nameRu: string; nameUz: string; price: number }[] }[] = detailsRes.ok ? await detailsRes.json() : [];
        if (cancelled) return;
        if (board.clinic?.nameRu) setClinicName(board.clinic.nameRu);
        const map = new Map(details.map((d) => [d.id, d]));
        setDoctors(
          board.doctors.map((d) => ({
            id: d.id,
            nameRu: d.nameRu,
            nameUz: d.nameUz || d.nameRu,
            cabinet: d.cabinet,
            color: d.color,
            waiting: d.waiting.length,
            services: map.get(d.id)?.services || [],
          }))
        );
      } catch {
        // Silent: kiosk auto-resets on idle
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Auto-reset after 30 seconds on done screen
  useEffect(() => {
    if (step === "done") {
      const id = setTimeout(resetAll, 30000);
      return () => clearTimeout(id);
    }
  }, [step]);

  // Idle timer — go back to welcome after 60s of inactivity (except on welcome/done)
  useEffect(() => {
    if (step === "welcome" || step === "done") return;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(resetAll, 60000);
    return () => clearTimeout(idleTimer.current);
  }, [step, phone, patientName, selectedDoctor]);

  useEffect(() => {
    if (step === "phone") setTimeout(() => inputRef.current?.focus(), 100);
  }, [step]);

  function resetAll() {
    setStep("welcome");
    setPhone("");
    setPatientName("");
    setFoundPatientId(null);
    setPreBooked([]);
    setUpcomingBookings([]);
    setSelectedDoctor(null);
    setSelectedService(null);
    setTicketId(null);
    setTicketNumber("");
    setError("");
  }

  async function handlePhoneSubmit() {
    if (phone.length < 9) { setError(L.phoneError); return; }
    setError("");
    setLoading(true);

    try {
      const checkinRes = await fetch(`/api/kiosk/checkin?phone=${encodeURIComponent(phone)}`);
      const checkinData = await checkinRes.json();

      if (checkinData.patient) {
        setFoundPatientId(checkinData.patient.id);
        setPatientName(checkinData.patient.fullName);

        const todayAppts: PreBooked[] = checkinData.appointments || [];
        const upcoming: UpcomingBooking[] = checkinData.upcoming || [];

        if (todayAppts.length > 0) {
          setPreBooked(todayAppts);
          setUpcomingBookings([]);
          setStep("checkin");
        } else if (upcoming.length > 0) {
          // Booked, but for a future day — show info instead of falling
          // through to doctor selection.
          setUpcomingBookings(upcoming);
          setPreBooked([]);
          setStep("upcoming");
        } else {
          setStep("select-doctor");
        }
      } else {
        setFoundPatientId(null);
        setPatientName("");
        setStep("enter-name");
      }
    } catch {
      setError(L.error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckin(appointment: PreBooked) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/c/${slug}/queue/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: appointment.id }),
      });
      if (!res.ok) {
        setError(L.error);
        return;
      }
      const data: {
        appointmentId: string;
        ticketNumber: string;
        doctor: { id: string; nameRu: string; nameUz: string | null };
        cabinet: string | null;
      } = await res.json();
      setTicketId(data.appointmentId);
      setTicketNumber(data.ticketNumber);
      setSelectedDoctor({
        id: data.doctor.id,
        nameRu: data.doctor.nameRu,
        nameUz: data.doctor.nameUz ?? undefined,
        cabinet: data.cabinet ?? appointment.cabinet,
        waiting: 0,
        services: [],
      });
      setStep("done");
      setTimeout(() => window.open(`/ticket/${data.appointmentId}`, "_blank"), 500);
    } catch {
      setError(L.error);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectDoctor(doc: Doctor) {
    setSelectedDoctor(doc);
    if (doc.services.length > 0) {
      setStep("select-service");
    } else {
      setStep("confirm");
    }
  }

  function handleSelectService(serviceName: string | null) {
    setSelectedService(serviceName);
    setStep("confirm");
  }

  async function handleConfirm() {
    if (!selectedDoctor) return;
    const fullName = (patientName || "").trim();
    if (fullName.length < 2) { setError(L.nameError); return; }
    setLoading(true);
    setError("");

    try {
      // Single transaction-safe walk-in: finds-or-creates the patient by phone,
      // allocates the queue slot, and mints a ticketCode in one call.
      const res = await fetch(`/api/c/${slug}/queue/walkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          phone,
          doctorId: selectedDoctor.id,
          lang: lang.toUpperCase(),
        }),
      });

      if (res.ok) {
        const data: { appointmentId: string; ticketNumber: string } = await res.json();
        setTicketId(data.appointmentId);
        setTicketNumber(data.ticketNumber);
        setStep("done");
        setTimeout(() => window.open(`/ticket/${data.appointmentId}`, "_blank"), 500);
      } else {
        setError(L.recordError);
      }
    } catch {
      setError(L.error);
    } finally {
      setLoading(false);
    }
  }

  function handleNumPad(val: string) {
    if (val === "del") setPhone((p) => p.slice(0, -1));
    else if (phone.length < 13) setPhone((p) => p + val);
  }

  const now = new Date();
  const docName = (doc: Doctor) => lang === "uz" && doc.nameUz ? doc.nameUz : doc.nameRu;

  return (
    <div className="min-h-screen bg-[var(--public-bg)] text-[var(--public-fg)] flex flex-col select-none">
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between shrink-0 border-b border-[var(--public-border)]">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt={clinicName || "Логотип клиники"}
            width={123}
            height={48}
            priority
            className="h-12 w-auto brightness-0 invert"
          />
        </div>
        <div className="flex items-center gap-4">
          {/* Language toggle */}
          <div className="flex rounded-xl bg-[var(--public-panel)] p-1 gap-1">
            <button
              onClick={() => setLang("ru")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                lang === "ru" ? "bg-[var(--public-fg)] text-[var(--public-bg)]" : "text-[var(--public-fg-muted)] hover:text-[var(--public-fg)]"
              }`}
            >
              🇷🇺 РУС
            </button>
            <button
              onClick={() => setLang("uz")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                lang === "uz" ? "bg-[var(--public-fg)] text-[var(--public-bg)]" : "text-[var(--public-fg-muted)] hover:text-[var(--public-fg)]"
              }`}
            >
              🇺🇿 UZB
            </button>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums font-mono">
              {now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-sm text-[var(--public-fg-muted)]">
              {now.toLocaleDateString(lang === "uz" ? "uz-UZ" : "ru-RU", { day: "numeric", month: "long" })}
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-8 pb-8">
        <div className="w-full max-w-xl">

          {/* WELCOME SCREEN */}
          {step === "welcome" && (
            <div
              className="text-center cursor-pointer"
              onClick={() => setStep("phone")}
            >
              <div
                className="inline-flex h-28 w-28 items-center justify-center rounded-full mb-8 shadow-lg animate-pulse-slow"
                style={{
                  background: "linear-gradient(135deg, var(--public-accent), var(--public-accent-rail))",
                  boxShadow: "0 20px 40px -12px rgb(35 83 255 / 0.45)",
                }}
              >
                <Stethoscope className="h-14 w-14 text-white" />
              </div>
              <h1 className="text-4xl font-bold mb-3">{L.welcome}</h1>
              <p className="text-xl text-[var(--public-fg-muted)] mb-10">{L.touchToStart}</p>

              <div className="flex justify-center gap-6">
                <div className="flex items-center gap-2 text-[var(--public-fg-faint)]">
                  <Globe className="h-5 w-5" />
                  <span className="text-sm">Русский / O'zbekcha</span>
                </div>
              </div>

              <div className="mt-12 h-1.5 w-24 mx-auto rounded-full bg-[var(--public-panel-strong)] overflow-hidden">
                <div className="h-full w-full rounded-full animate-shimmer" style={{ background: "var(--public-accent)" }} />
              </div>
            </div>
          )}

          {/* PHONE STEP */}
          {step === "phone" && (
            <div className="text-center">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-[var(--public-panel)] mb-6">
                <Phone className="h-10 w-10" style={{ color: "var(--public-accent)" }} />
              </div>
              <h1 className="text-3xl font-bold mb-2">{L.enterPhone}</h1>
              <p className="text-lg text-[var(--public-fg-muted)] mb-8">{L.enterPhoneDesc}</p>

              <div className="bg-[var(--public-panel)] border border-[var(--public-border)] rounded-2xl px-6 py-4 mb-6">
                <input
                  ref={inputRef}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^0-9+]/g, ""))}
                  placeholder="+998"
                  className="w-full text-center text-4xl font-bold font-mono tracking-wider bg-transparent outline-none placeholder:text-[var(--public-fg-faint)]"
                  onKeyDown={(e) => { if (e.key === "Enter") handlePhoneSubmit(); }}
                />
              </div>

              <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto mb-6">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "del"].map((key) => (
                  <button
                    key={key}
                    onClick={() => handleNumPad(key)}
                    className={`h-16 rounded-2xl text-2xl font-bold transition-all active:scale-90 ${
                      key === "del"
                        ? "bg-[var(--public-panel)] text-[var(--public-danger)] hover:bg-[var(--public-panel-strong)]"
                        : "bg-[var(--public-panel)] hover:bg-[var(--public-panel-strong)]"
                    }`}
                  >
                    {key === "del" ? "←" : key}
                  </button>
                ))}
              </div>

              {error && <p className="mb-4 animate-shake" style={{ color: "var(--public-danger)" }}>{error}</p>}

              <button
                onClick={handlePhoneSubmit}
                disabled={loading || phone.length < 9}
                className="w-full max-w-xs mx-auto flex items-center justify-center gap-3 rounded-2xl py-4 text-xl font-bold text-white transition-all disabled:opacity-40 active:scale-[0.97] hover:brightness-110"
                style={{ background: "var(--public-accent)" }}
              >
                {loading ? L.searching : L.next}
                <ArrowRight className="h-6 w-6" />
              </button>

              <button onClick={resetAll} className="mt-4 text-[var(--public-fg-faint)] text-sm hover:text-[var(--public-fg-muted)]">
                {L.back}
              </button>
            </div>
          )}

          {/* CHECK-IN STEP */}
          {step === "checkin" && (
            <div>
              <button onClick={() => setStep("phone")} className="flex items-center gap-2 text-[var(--public-fg-muted)] mb-6 hover:text-[var(--public-fg)]">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <div
                className="rounded-2xl px-5 py-4 mb-6 flex items-center gap-4"
                style={{ background: GREEN_TINT, border: `1px solid ${GREEN_BORDER}` }}
              >
                <User className="h-8 w-8" style={{ color: "var(--public-active)" }} />
                <div>
                  <p className="font-bold text-lg">{patientName}</p>
                  <p className="text-sm" style={{ color: "var(--public-active)" }}>{L.foundBooking}</p>
                </div>
              </div>

              <h2 className="text-2xl font-bold mb-4">{L.yourBookings}</h2>

              <div className="space-y-3 mb-6">
                {preBooked.map((appt) => (
                  <button
                    key={appt.id}
                    onClick={() => handleCheckin(appt)}
                    className="w-full flex items-center justify-between rounded-2xl px-6 py-5 text-left transition-all active:scale-[0.99] hover:brightness-110"
                    style={{ background: GREEN_TINT, border: `1px solid ${GREEN_BORDER}` }}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className="flex h-14 w-14 items-center justify-center rounded-xl text-2xl font-bold"
                        style={{ background: GREEN_BADGE, color: "var(--public-active)" }}
                      >
                        {appt.cabinet}
                      </div>
                      <div>
                        <p className="text-lg font-bold">{appt.doctorName}</p>
                        <div className="flex items-center gap-3 text-sm text-[var(--public-fg-muted)] mt-0.5">
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {appt.time}</span>
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {L.cabinet} {appt.cabinet}</span>
                          {appt.service && <span>{appt.service}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold font-mono" style={{ color: "var(--public-active)" }}>{appt.ticketNumber ?? "—"}</p>
                      <p className="text-xs" style={{ color: "var(--public-active)" }}>{L.getTicket}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-[var(--public-border)]" />
                <span className="text-xs text-[var(--public-fg-faint)]">{L.or}</span>
                <div className="flex-1 h-px bg-[var(--public-border)]" />
              </div>

              <button
                onClick={() => setStep("select-doctor")}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-[var(--public-border-strong)] py-4 text-lg hover:bg-[var(--public-panel)] transition-colors"
              >
                <UserPlus className="h-5 w-5" />
                {L.bookOther}
              </button>
            </div>
          )}

          {/* UPCOMING — patient has a booking but not for today */}
          {step === "upcoming" && (
            <div>
              <button onClick={() => setStep("phone")} className="flex items-center gap-2 text-[var(--public-fg-muted)] mb-6 hover:text-[var(--public-fg)]">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <div className="bg-[var(--public-panel)] border border-[var(--public-border)] rounded-2xl px-5 py-4 mb-6 flex items-center gap-4">
                <User className="h-8 w-8" style={{ color: "var(--public-accent)" }} />
                <div>
                  <p className="font-bold text-lg">{patientName}</p>
                  <p className="text-sm text-[var(--public-fg-muted)]">{L.upcomingDesc}</p>
                </div>
              </div>

              <h2 className="text-2xl font-bold mb-4">{L.upcomingFound}</h2>

              <div className="space-y-3 mb-6">
                {upcomingBookings.map((appt) => {
                  const [yyyy, mm, dd] = appt.date.split("-");
                  const dateLabel = `${dd}.${mm}.${yyyy}`;
                  return (
                    <div
                      key={appt.id}
                      className="w-full flex items-center justify-between rounded-2xl border border-[var(--public-border)] bg-[var(--public-panel)] px-6 py-5"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--public-panel-strong)] text-2xl font-bold">
                          {appt.cabinet}
                        </div>
                        <div>
                          <p className="text-lg font-bold">{appt.doctorName}</p>
                          <div className="flex items-center gap-3 text-sm text-[var(--public-fg-muted)] mt-0.5">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {appt.time}</span>
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {L.cabinet} {appt.cabinet}</span>
                          </div>
                          {appt.service && <p className="text-xs text-[var(--public-fg-faint)] mt-0.5">{appt.service}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-[var(--public-fg-faint)]">{L.onDate}</p>
                        <p className="text-xl font-bold font-mono" style={{ color: "var(--public-accent)" }}>{dateLabel}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-[var(--public-border)]" />
                <span className="text-xs text-[var(--public-fg-faint)]">{L.or}</span>
                <div className="flex-1 h-px bg-[var(--public-border)]" />
              </div>

              <button
                onClick={() => setStep("select-doctor")}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-[var(--public-border-strong)] py-4 text-lg hover:bg-[var(--public-panel)] transition-colors"
              >
                <UserPlus className="h-5 w-5" />
                {L.notTodayBookWalkin}
              </button>
            </div>
          )}

          {/* ENTER NAME — new patient */}
          {step === "enter-name" && (
            <div className="text-center">
              <button onClick={() => setStep("phone")} className="flex items-center gap-2 text-[var(--public-fg-muted)] mb-6 hover:text-[var(--public-fg)]">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <div
                className="rounded-2xl px-5 py-4 mb-6 text-left"
                style={{ background: AMBER_TINT, border: `1px solid ${AMBER_BORDER}` }}
              >
                <p className="text-sm" style={{ color: "var(--public-waiting)" }}>{L.firstVisit}</p>
              </div>

              <input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder={L.fioPlaceholder}
                autoFocus
                className="w-full bg-[var(--public-panel)] border border-[var(--public-border)] rounded-2xl px-6 py-4 text-xl text-center outline-none placeholder:text-[var(--public-fg-faint)] mb-6"
                onKeyDown={(e) => { if (e.key === "Enter" && patientName.length > 2) setStep("select-doctor"); }}
              />

              <button
                onClick={() => { if (patientName.length > 2) setStep("select-doctor"); }}
                disabled={patientName.length < 3}
                className="w-full max-w-xs mx-auto flex items-center justify-center gap-3 rounded-2xl py-4 text-xl font-bold text-white transition-colors disabled:opacity-40 hover:brightness-110"
                style={{ background: "var(--public-accent)" }}
              >
                {L.next} <ArrowRight className="h-6 w-6" />
              </button>
            </div>
          )}

          {/* SELECT DOCTOR */}
          {step === "select-doctor" && (
            <div>
              <button onClick={() => {
                if (preBooked.length > 0) setStep("checkin");
                else if (upcomingBookings.length > 0) setStep("upcoming");
                else if (foundPatientId) setStep("phone");
                else setStep(patientName ? "enter-name" : "phone");
              }} className="flex items-center gap-2 text-[var(--public-fg-muted)] mb-6 hover:text-[var(--public-fg)]">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              {patientName && (
                <div className="bg-[var(--public-panel)] border border-[var(--public-border)] rounded-2xl px-5 py-3 mb-6 flex items-center gap-3">
                  <User className="h-6 w-6" style={{ color: "var(--public-accent)" }} />
                  <p className="font-bold">{patientName}</p>
                </div>
              )}

              <h2 className="text-2xl font-bold mb-4">{L.selectDoctor}</h2>

              <div className="space-y-3">
                {doctors.map((doc) => {
                  const accent = doc.color || "var(--public-accent)";
                  return (
                    <button
                      key={doc.id}
                      onClick={() => handleSelectDoctor(doc)}
                      className="group w-full flex items-center justify-between rounded-2xl border border-[var(--public-border)] bg-[var(--public-panel)] px-6 py-5 text-left transition-all active:scale-[0.99] hover:bg-[var(--public-panel-strong)] hover:border-[var(--public-border-strong)]"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className="flex h-14 w-14 items-center justify-center rounded-xl text-2xl font-bold text-white shadow-lg"
                          style={{ background: `linear-gradient(135deg, ${accent}, ${accent}99)` }}
                        >
                          {doc.cabinet ?? "—"}
                        </div>
                        <div>
                          <p className="text-lg font-bold">{docName(doc)}</p>
                          <div className="flex items-center gap-3 text-sm text-[var(--public-fg-muted)] mt-0.5">
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {L.cabinet} {doc.cabinet}</span>
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {doc.waiting} {L.inQueue}</span>
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="h-6 w-6 text-[var(--public-fg-faint)] group-hover:text-[var(--public-fg-muted)]" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* SELECT SERVICE */}
          {step === "select-service" && selectedDoctor && (
            <div>
              <button onClick={() => setStep("select-doctor")} className="flex items-center gap-2 text-[var(--public-fg-muted)] mb-6 hover:text-[var(--public-fg)]">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <div className="bg-[var(--public-panel)] border border-[var(--public-border)] rounded-2xl px-5 py-3 mb-6 flex items-center gap-3">
                <Stethoscope className="h-6 w-6" style={{ color: "var(--public-accent)" }} />
                <div>
                  <p className="font-bold">{docName(selectedDoctor)}</p>
                  <p className="text-xs text-[var(--public-fg-muted)]">{L.cabinet} {selectedDoctor.cabinet}</p>
                </div>
              </div>

              <h2 className="text-2xl font-bold mb-4">{L.selectService}</h2>

              <div className="space-y-2 mb-6">
                {selectedDoctor.services.map((svc) => {
                  const name = lang === "uz" ? svc.nameUz : svc.nameRu;
                  return (
                    <button
                      key={name}
                      onClick={() => handleSelectService(name)}
                      className="w-full flex items-center justify-between rounded-2xl border border-[var(--public-border)] bg-[var(--public-panel)] px-5 py-4 text-left transition-all active:scale-[0.99] hover:bg-[var(--public-panel-strong)] hover:border-[var(--public-border-strong)]"
                    >
                      <span className="text-lg font-medium">{name}</span>
                      <span className="font-bold font-mono" style={{ color: "var(--public-accent)" }}>
                        {/* svc.price is whole UZS (legacy /api/kiosk/doctors shape).
                            formatMoney expects tiins, so multiply by 100. The route
                            file is marked TODO(phase-1) for full rewrite. */}
                        {formatMoney(svc.price * 100, "UZS", lang)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => handleSelectService(null)}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-[var(--public-border-strong)] py-4 text-lg text-[var(--public-fg-muted)] hover:bg-[var(--public-panel)] transition-colors"
              >
                {L.skipService}
              </button>
            </div>
          )}

          {/* CONFIRM */}
          {step === "confirm" && selectedDoctor && (
            <div className="text-center">
              <button onClick={() => selectedDoctor.services.length > 0 ? setStep("select-service") : setStep("select-doctor")} className="flex items-center gap-2 text-[var(--public-fg-muted)] mb-6 hover:text-[var(--public-fg)]">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <h2 className="text-2xl font-bold mb-6">{L.confirmTitle}</h2>

              <div className="bg-[var(--public-panel)] border border-[var(--public-border)] rounded-2xl p-6 mb-6 text-left space-y-3">
                <div className="flex justify-between">
                  <span className="text-[var(--public-fg-muted)]">{L.patient}:</span>
                  <span className="font-bold">{patientName || phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--public-fg-muted)]">{L.phone}:</span>
                  <span className="font-mono">{phone}</span>
                </div>
                <div className="border-t border-[var(--public-border)] my-2" />
                <div className="flex justify-between">
                  <span className="text-[var(--public-fg-muted)]">{L.doctor}:</span>
                  <span className="font-bold">{docName(selectedDoctor)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--public-fg-muted)]">{L.cabinet}:</span>
                  <span className="text-2xl font-bold">{selectedDoctor.cabinet}</span>
                </div>
                {selectedService && (
                  <div className="flex justify-between">
                    <span className="text-[var(--public-fg-muted)]">{L.service}:</span>
                    <span className="font-medium" style={{ color: "var(--public-accent)" }}>{selectedService}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[var(--public-fg-muted)]">{L.beforeYou}:</span>
                  <span className="font-bold">{selectedDoctor.waiting} {L.people}</span>
                </div>
              </div>

              {error && <p className="mb-4 animate-shake" style={{ color: "var(--public-danger)" }}>{error}</p>}

              <button
                onClick={handleConfirm}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 rounded-2xl py-5 text-2xl font-bold text-white transition-all disabled:opacity-40 active:scale-[0.97] hover:brightness-110"
                style={{ background: "var(--public-active)" }}
              >
                {loading ? "..." : <><Check className="h-7 w-7" /> {L.confirm}</>}
              </button>
            </div>
          )}

          {/* DONE */}
          {step === "done" && (
            <div className="text-center animate-appear">
              <div
                className="inline-flex h-24 w-24 items-center justify-center rounded-full mb-6 ring-4 ring-[rgb(22_199_132_/_0.25)]"
                style={{ background: GREEN_TINT }}
              >
                <Check className="h-12 w-12" style={{ color: "var(--public-active)" }} />
              </div>

              <h2 className="text-3xl font-bold mb-2">{L.inQueueTitle}</h2>
              <p className="text-[var(--public-fg-muted)] mb-8">{L.takeTicket}</p>

              <div className="bg-[var(--public-panel)] border border-[var(--public-border)] rounded-3xl p-8 mb-6 inline-block">
                <p className="text-[var(--public-fg-faint)] text-sm uppercase tracking-widest mb-2">{L.yourNumber}</p>
                <p className="text-8xl font-bold font-mono tracking-wider" style={{ color: "var(--public-active)" }}>{ticketNumber}</p>
                {selectedDoctor && (
                  <p className="text-[var(--public-fg-muted)] mt-3 text-lg">{L.cabinet} {selectedDoctor.cabinet} · {docName(selectedDoctor)}</p>
                )}
              </div>

              <div className="flex flex-col gap-3 max-w-xs mx-auto">
                {ticketId && (
                  <button
                    onClick={() => window.open(`/ticket/${ticketId}`, "_blank")}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--public-panel)] border border-[var(--public-border)] py-4 text-lg font-semibold hover:bg-[var(--public-panel-strong)] transition-colors"
                  >
                    <Printer className="h-5 w-5" />
                    {L.printTicket}
                  </button>
                )}
                <button onClick={resetAll} className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--public-border-strong)] py-4 text-lg font-semibold hover:bg-[var(--public-panel)] transition-colors">
                  {L.newRecord}
                </button>
              </div>

              <p className="text-xs text-[var(--public-fg-faint)] mt-6">{L.resetIn}</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse-slow { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.8; } }
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
        @keyframes appear { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
        .animate-pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }
        .animate-shimmer { animation: shimmer 2s ease-in-out infinite; }
        .animate-appear { animation: appear 0.5s ease-out; }
        .animate-shake { animation: shake 0.4s ease-out; }
      `}</style>
    </div>
  );
}

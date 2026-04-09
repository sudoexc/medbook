"use client";

import { useState, useEffect, useRef } from "react";
import { Phone, ArrowRight, ArrowLeft, Check, Printer, MapPin, Clock, User, UserPlus, Globe, Stethoscope } from "lucide-react";

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
  cabinet: number;
  waiting: number;
  services: { nameRu: string; nameUz: string; price: number }[];
}

interface PreBooked {
  id: string;
  doctorName: string;
  cabinet: number;
  service: string | null;
  time: string;
  ticketNumber: string;
}

type Step = "welcome" | "phone" | "checkin" | "select-doctor" | "select-service" | "enter-name" | "confirm" | "done";

export default function KioskPage() {
  const [lang, setLang] = useState<Lang>("ru");
  const [step, setStep] = useState<Step>("welcome");
  const [phone, setPhone] = useState("");
  const [patientName, setPatientName] = useState("");
  const [foundPatientId, setFoundPatientId] = useState<string | null>(null);
  const [preBooked, setPreBooked] = useState<PreBooked[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const L = t[lang];

  // Fetch doctors with services (parallelized)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [queueRes, detailsRes] = await Promise.all([
          fetch("/api/tv-queue"),
          fetch("/api/kiosk/doctors"),
        ]);
        if (cancelled || !queueRes.ok) return;
        const data: { id: string; nameRu: string; cabinet: number; waiting: { id: string }[] }[] = await queueRes.json();
        const details: { id: string; nameRu: string; nameUz: string; cabinet: number; services: { nameRu: string; nameUz: string; price: number }[] }[] = detailsRes.ok ? await detailsRes.json() : [];
        if (cancelled) return;
        const map = new Map(details.map((d) => [d.id, d]));
        setDoctors(
          data.map((d) => ({
            id: d.id,
            nameRu: map.get(d.id)?.nameRu || d.nameRu,
            nameUz: map.get(d.id)?.nameUz || d.nameRu,
            cabinet: d.cabinet,
            waiting: d.waiting.length,
            services: map.get(d.id)?.services || [],
          }))
        );
      } catch {
        // Silent: kiosk auto-resets on idle
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

        if (checkinData.appointments.length > 0) {
          setPreBooked(checkinData.appointments);
          setStep("checkin");
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
    setTicketId(appointment.id);
    setTicketNumber(appointment.ticketNumber);
    setSelectedDoctor({ id: "", nameRu: appointment.doctorName, cabinet: appointment.cabinet, waiting: 0, services: [] });
    setStep("done");
    setTimeout(() => window.open(`/ticket/${appointment.id}`, "_blank"), 500);
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
    setLoading(true);
    setError("");

    try {
      let patientId = foundPatientId;

      if (!patientId) {
        if (!patientName) { setError(L.nameError); setLoading(false); return; }
        const res = await fetch("/api/patients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: patientName, phone }),
        });
        const patient = await res.json();
        patientId = patient.id;
      }

      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          doctorId: selectedDoctor.id,
          service: selectedService || undefined,
        }),
      });

      if (res.ok) {
        const appt = await res.json();
        setTicketId(appt.id);
        const tn = `${selectedDoctor.id.charAt(0).toUpperCase()}-${String(appt.queueOrder || 0).padStart(3, "0")}`;
        setTicketNumber(tn);
        setStep("done");
        setTimeout(() => window.open(`/ticket/${appt.id}`, "_blank"), 500);
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
    <div className="min-h-screen bg-gradient-to-b from-[#0d1b2a] to-[#1b3a5c] text-white flex flex-col select-none">
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="NeuroFax-B" className="h-12 brightness-0 invert" />
        </div>
        <div className="flex items-center gap-4">
          {/* Language toggle */}
          <div className="flex rounded-xl bg-white/10 p-1 gap-1">
            <button
              onClick={() => setLang("ru")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                lang === "ru" ? "bg-white text-[#0d1b2a]" : "text-white/60 hover:text-white"
              }`}
            >
              🇷🇺 РУС
            </button>
            <button
              onClick={() => setLang("uz")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                lang === "uz" ? "bg-white text-[#0d1b2a]" : "text-white/60 hover:text-white"
              }`}
            >
              🇺🇿 UZB
            </button>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums font-mono">
              {now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-sm text-white/50">
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
              <div className="inline-flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 mb-8 shadow-lg shadow-blue-500/30 animate-pulse-slow">
                <Stethoscope className="h-14 w-14 text-white" />
              </div>
              <h1 className="text-4xl font-bold mb-3">{L.welcome}</h1>
              <p className="text-xl text-white/50 mb-10">{L.touchToStart}</p>

              <div className="flex justify-center gap-6">
                <div className="flex items-center gap-2 text-white/40">
                  <Globe className="h-5 w-5" />
                  <span className="text-sm">Русский / O'zbekcha</span>
                </div>
              </div>

              <div className="mt-12 h-1.5 w-24 mx-auto rounded-full bg-white/20 overflow-hidden">
                <div className="h-full w-full bg-white/60 rounded-full animate-shimmer" />
              </div>
            </div>
          )}

          {/* PHONE STEP */}
          {step === "phone" && (
            <div className="text-center">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-white/10 mb-6">
                <Phone className="h-10 w-10 text-blue-300" />
              </div>
              <h1 className="text-3xl font-bold mb-2">{L.enterPhone}</h1>
              <p className="text-lg text-white/60 mb-8">{L.enterPhoneDesc}</p>

              <div className="bg-white/10 rounded-2xl px-6 py-4 mb-6">
                <input
                  ref={inputRef}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^0-9+]/g, ""))}
                  placeholder="+998"
                  className="w-full text-center text-4xl font-bold font-mono tracking-wider bg-transparent outline-none placeholder:text-white/30"
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
                        ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                        : "bg-white/10 hover:bg-white/20 active:bg-white/30"
                    }`}
                  >
                    {key === "del" ? "←" : key}
                  </button>
                ))}
              </div>

              {error && <p className="text-red-400 mb-4 animate-shake">{error}</p>}

              <button
                onClick={handlePhoneSubmit}
                disabled={loading || phone.length < 9}
                className="w-full max-w-xs mx-auto flex items-center justify-center gap-3 rounded-2xl bg-blue-500 py-4 text-xl font-bold hover:bg-blue-600 transition-all disabled:opacity-40 active:scale-[0.97]"
              >
                {loading ? L.searching : L.next}
                <ArrowRight className="h-6 w-6" />
              </button>

              <button onClick={resetAll} className="mt-4 text-white/40 text-sm hover:text-white/60">
                {L.back}
              </button>
            </div>
          )}

          {/* CHECK-IN STEP */}
          {step === "checkin" && (
            <div>
              <button onClick={() => setStep("phone")} className="flex items-center gap-2 text-white/60 mb-6 hover:text-white">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <div className="bg-green-500/10 border border-green-500/30 rounded-2xl px-5 py-4 mb-6 flex items-center gap-4">
                <User className="h-8 w-8 text-green-400" />
                <div>
                  <p className="font-bold text-lg">{patientName}</p>
                  <p className="text-green-300 text-sm">{L.foundBooking}</p>
                </div>
              </div>

              <h2 className="text-2xl font-bold mb-4">{L.yourBookings}</h2>

              <div className="space-y-3 mb-6">
                {preBooked.map((appt) => (
                  <button
                    key={appt.id}
                    onClick={() => handleCheckin(appt)}
                    className="w-full flex items-center justify-between rounded-2xl border-2 border-green-500/30 bg-green-500/10 px-6 py-5 text-left hover:bg-green-500/20 transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-green-500/30 text-2xl font-bold">
                        {appt.cabinet}
                      </div>
                      <div>
                        <p className="text-lg font-bold">{appt.doctorName}</p>
                        <div className="flex items-center gap-3 text-sm text-white/50 mt-0.5">
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {appt.time}</span>
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {L.cabinet} {appt.cabinet}</span>
                          {appt.service && <span>{appt.service}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold font-mono text-green-300">{appt.ticketNumber}</p>
                      <p className="text-xs text-green-400">{L.getTicket}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-white/40">{L.or}</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <button
                onClick={() => setStep("select-doctor")}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-white/20 py-4 text-lg hover:bg-white/5 transition-colors"
              >
                <UserPlus className="h-5 w-5" />
                {L.bookOther}
              </button>
            </div>
          )}

          {/* ENTER NAME — new patient */}
          {step === "enter-name" && (
            <div className="text-center">
              <button onClick={() => setStep("phone")} className="flex items-center gap-2 text-white/60 mb-6 hover:text-white">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-5 py-4 mb-6 text-left">
                <p className="text-amber-300 text-sm">{L.firstVisit}</p>
              </div>

              <input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder={L.fioPlaceholder}
                autoFocus
                className="w-full bg-white/10 rounded-2xl px-6 py-4 text-xl text-center outline-none placeholder:text-white/30 mb-6"
                onKeyDown={(e) => { if (e.key === "Enter" && patientName.length > 2) setStep("select-doctor"); }}
              />

              <button
                onClick={() => { if (patientName.length > 2) setStep("select-doctor"); }}
                disabled={patientName.length < 3}
                className="w-full max-w-xs mx-auto flex items-center justify-center gap-3 rounded-2xl bg-blue-500 py-4 text-xl font-bold hover:bg-blue-600 transition-colors disabled:opacity-40"
              >
                {L.next} <ArrowRight className="h-6 w-6" />
              </button>
            </div>
          )}

          {/* SELECT DOCTOR */}
          {step === "select-doctor" && (
            <div>
              <button onClick={() => foundPatientId ? setStep("checkin") : setStep(patientName ? "enter-name" : "phone")} className="flex items-center gap-2 text-white/60 mb-6 hover:text-white">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              {patientName && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl px-5 py-3 mb-6 flex items-center gap-3">
                  <User className="h-6 w-6 text-blue-400" />
                  <p className="font-bold">{patientName}</p>
                </div>
              )}

              <h2 className="text-2xl font-bold mb-4">{L.selectDoctor}</h2>

              <div className="space-y-3">
                {doctors.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleSelectDoctor(doc)}
                    className="w-full flex items-center justify-between rounded-2xl border-2 border-white/10 bg-white/5 px-6 py-5 text-left hover:border-blue-400/40 hover:bg-blue-500/10 transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-500/30 text-2xl font-bold">
                        {doc.cabinet}
                      </div>
                      <div>
                        <p className="text-lg font-bold">{docName(doc)}</p>
                        <div className="flex items-center gap-3 text-sm text-white/50 mt-0.5">
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {L.cabinet} {doc.cabinet}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {doc.waiting} {L.inQueue}</span>
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="h-6 w-6 text-white/30" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SELECT SERVICE */}
          {step === "select-service" && selectedDoctor && (
            <div>
              <button onClick={() => setStep("select-doctor")} className="flex items-center gap-2 text-white/60 mb-6 hover:text-white">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl px-5 py-3 mb-6 flex items-center gap-3">
                <Stethoscope className="h-6 w-6 text-blue-400" />
                <div>
                  <p className="font-bold">{docName(selectedDoctor)}</p>
                  <p className="text-blue-300 text-xs">{L.cabinet} {selectedDoctor.cabinet}</p>
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
                      className="w-full flex items-center justify-between rounded-2xl border-2 border-white/10 bg-white/5 px-5 py-4 text-left hover:border-blue-400/40 hover:bg-blue-500/10 transition-all active:scale-[0.99]"
                    >
                      <span className="text-lg font-medium">{name}</span>
                      <span className="text-blue-300 font-bold font-mono">
                        {svc.price.toLocaleString()} {L.price}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => handleSelectService(null)}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-white/20 py-4 text-lg text-white/60 hover:bg-white/5 transition-colors"
              >
                {L.skipService}
              </button>
            </div>
          )}

          {/* CONFIRM */}
          {step === "confirm" && selectedDoctor && (
            <div className="text-center">
              <button onClick={() => selectedDoctor.services.length > 0 ? setStep("select-service") : setStep("select-doctor")} className="flex items-center gap-2 text-white/60 mb-6 hover:text-white">
                <ArrowLeft className="h-5 w-5" /> {L.back}
              </button>

              <h2 className="text-2xl font-bold mb-6">{L.confirmTitle}</h2>

              <div className="bg-white/10 rounded-2xl p-6 mb-6 text-left space-y-3">
                <div className="flex justify-between">
                  <span className="text-white/60">{L.patient}:</span>
                  <span className="font-bold">{patientName || phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">{L.phone}:</span>
                  <span className="font-mono">{phone}</span>
                </div>
                <div className="border-t border-white/10 my-2" />
                <div className="flex justify-between">
                  <span className="text-white/60">{L.doctor}:</span>
                  <span className="font-bold">{docName(selectedDoctor)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">{L.cabinet}:</span>
                  <span className="text-2xl font-bold">{selectedDoctor.cabinet}</span>
                </div>
                {selectedService && (
                  <div className="flex justify-between">
                    <span className="text-white/60">{L.service}:</span>
                    <span className="font-medium text-blue-300">{selectedService}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-white/60">{L.beforeYou}:</span>
                  <span className="font-bold">{selectedDoctor.waiting} {L.people}</span>
                </div>
              </div>

              {error && <p className="text-red-400 mb-4 animate-shake">{error}</p>}

              <button
                onClick={handleConfirm}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 rounded-2xl bg-green-500 py-5 text-2xl font-bold hover:bg-green-600 transition-all disabled:opacity-40 active:scale-[0.97]"
              >
                {loading ? "..." : <><Check className="h-7 w-7" /> {L.confirm}</>}
              </button>
            </div>
          )}

          {/* DONE */}
          {step === "done" && (
            <div className="text-center animate-appear">
              <div className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-green-500/20 mb-6 ring-4 ring-green-500/30">
                <Check className="h-12 w-12 text-green-400" />
              </div>

              <h2 className="text-3xl font-bold mb-2">{L.inQueueTitle}</h2>
              <p className="text-white/60 mb-8">{L.takeTicket}</p>

              <div className="bg-white/10 rounded-3xl p-8 mb-6 inline-block">
                <p className="text-white/50 text-sm uppercase tracking-widest mb-2">{L.yourNumber}</p>
                <p className="text-8xl font-bold font-mono tracking-wider text-green-300">{ticketNumber}</p>
                {selectedDoctor && (
                  <p className="text-white/50 mt-3 text-lg">{L.cabinet} {selectedDoctor.cabinet} · {docName(selectedDoctor)}</p>
                )}
              </div>

              <div className="flex flex-col gap-3 max-w-xs mx-auto">
                {ticketId && (
                  <button
                    onClick={() => window.open(`/ticket/${ticketId}`, "_blank")}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 py-4 text-lg font-semibold hover:bg-white/20 transition-colors"
                  >
                    <Printer className="h-5 w-5" />
                    {L.printTicket}
                  </button>
                )}
                <button onClick={resetAll} className="flex items-center justify-center gap-2 rounded-2xl border border-white/20 py-4 text-lg font-semibold hover:bg-white/10 transition-colors">
                  {L.newRecord}
                </button>
              </div>

              <p className="text-xs text-white/30 mt-6">{L.resetIn}</p>
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

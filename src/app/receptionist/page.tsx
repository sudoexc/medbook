"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, UserPlus, Play, SkipForward, Phone, Clock, MapPin,
  Users, Bell, QrCode, Printer, Volume2, X, CheckCircle, AlertCircle,
  Inbox, Calendar,
} from "lucide-react";
import { tashkentToday, isSlotPast } from "@/lib/tashkent-time";

interface Patient {
  id: string;
  fullName: string;
  phone: string;
  passport?: string | null;
}

interface QueueItem {
  id: string;
  patient: Patient;
  doctorId: string;
  service: string | null;
  queueOrder: number | null;
  queueStatus: string;
  source: string;
  startedAt: string | null;
}

interface LeadItem {
  id: string;
  name: string;
  phone: string;
  doctorId: string | null;
  service: string | null;
  date: string | null;
  status: string;
  createdAt: string;
}

interface DoctorQueue {
  id: string;
  nameRu: string;
  cabinet: number;
  avgDuration: number;
  current: { fullName: string; startedAt: string } | null;
  waiting: { id: string; fullName: string; queueOrder: number; ticketNumber: string; etaMinutes: number }[];
}

const RECEPTIONIST_PIN = process.env.NEXT_PUBLIC_RECEPTIONIST_PIN || "8868";
const PIN_HEADER = { "X-Terminal-PIN": RECEPTIONIST_PIN };

function PinLock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit() {
    if (pin === RECEPTIONIST_PIN) {
      onUnlock();
    } else {
      setError(true);
      setPin("");
      setTimeout(() => setError(false), 1500);
    }
  }

  function handleKey(val: string) {
    if (val === "del") { setPin((p) => p.slice(0, -1)); return; }
    if (pin.length >= 4) return;
    const newPin = pin + val;
    setPin(newPin);
    if (newPin.length === 4) {
      setTimeout(() => {
        if (newPin === RECEPTIONIST_PIN) onUnlock();
        else { setError(true); setPin(""); setTimeout(() => setError(false), 1500); }
      }, 200);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <img src="/logo.png" alt="NeuroFax-B" className="h-12 mx-auto mb-6" />
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Терминал ресепшена</h1>
        <p className="text-gray-500 mb-8">Введите ПИН-код для входа</p>

        {/* PIN dots */}
        <div className="flex justify-center gap-4 mb-8">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-5 w-5 rounded-full transition-all ${
                error ? "bg-red-500" :
                i < pin.length ? "bg-blue-600 scale-110" : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        {error && <p className="text-red-500 text-sm mb-4">Неверный ПИН-код</p>}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) => (
            key === "" ? <div key="empty" /> :
            <button
              key={key}
              onClick={() => handleKey(key)}
              className={`h-16 w-16 rounded-2xl text-2xl font-bold transition-colors active:scale-95 ${
                key === "del"
                  ? "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  : "bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 shadow-sm"
              }`}
            >
              {key === "del" ? "←" : key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ReceptionistPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [doctors, setDoctors] = useState<DoctorQueue[]>([]);
  const [time, setTime] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [newPatient, setNewPatient] = useState({ fullName: "", phone: "", passport: "" });
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [service, setService] = useState("");
  const [doctorServices, setDoctorServices] = useState<{ name: string; price: number }[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [newLeadsCount, setNewLeadsCount] = useState(0);
  const [showLeadsPanel, setShowLeadsPanel] = useState(false);
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const prevLeadsCountRef = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch all queues
  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch("/api/tv-queue");
      if (res.ok) setDoctors(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchQueues();
    const id = setInterval(fetchQueues, 3000);
    return () => clearInterval(id);
  }, [fetchQueues]);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll new leads + play sound on new arrivals
  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch("/api/leads?status=NEW&limit=50", { headers: PIN_HEADER });
      if (!res.ok) return;
      const data: LeadItem[] = await res.json();
      const count = data.length;

      if (count > prevLeadsCountRef.current && prevLeadsCountRef.current > 0) {
        // New lead arrived → play beep + toast
        playLeadSound();
        const latest = data[0];
        showToast(`Новая заявка: ${latest.name}`, "success");
      }
      prevLeadsCountRef.current = count;
      setNewLeadsCount(count);
      setLeads(data);
    } catch {}
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    fetchLeads();
    const id = setInterval(fetchLeads, 8000);
    return () => clearInterval(id);
  }, [unlocked, fetchLeads]);

  async function handleBookLead(leadId: string, doctorId: string, service: string, date: string, time: string) {
    const res = await fetch(`/api/leads/${leadId}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...PIN_HEADER },
      body: JSON.stringify({ doctorId, service: service || undefined, date, time }),
    });
    if (res.ok) {
      showToast("Пациент записан");
      fetchLeads();
      fetchQueues();
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || "Ошибка записи", "error");
    }
  }

  async function handleLeadStatus(leadId: string, status: string) {
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...PIN_HEADER },
      body: JSON.stringify({ status, skipAppointment: true }),
    });
    fetchLeads();
  }

  // Keyboard shortcut: F1 = focus search, F2 = add patient
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "F1") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F2") { e.preventDefault(); setShowAddPanel(true); }
      if (e.key === "Escape") { setShowAddPanel(false); setSearchResults([]); setSearchQuery(""); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Search patients
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(searchQuery)}`, {
          headers: PIN_HEADER,
        });
        if (res.ok) setSearchResults(await res.json());
      } catch {}
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  // Fetch doctor services when selected
  useEffect(() => {
    if (!selectedDoctorId) { setDoctorServices([]); return; }
    fetch("/api/kiosk/doctors")
      .then((r) => r.json())
      .then((data: { id: string; services: { nameRu: string; price: number }[] }[]) => {
        const doc = data.find((d) => d.id === selectedDoctorId);
        setDoctorServices(doc?.services.map((s) => ({ name: s.nameRu, price: s.price })) || []);
      })
      .catch(() => setDoctorServices([]));
  }, [selectedDoctorId]);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function playLeadSound() {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      // Two-tone chime: C5 → E5
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = ctx.currentTime + i * 0.15;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } catch {}
  }

  async function handleAddToQueue() {
    if (!selectedDoctorId) { showToast("Выберите врача", "error"); return; }

    let patientId = selectedPatient?.id;

    if (!patientId) {
      if (!newPatient.fullName || !newPatient.phone) {
        showToast("Введите имя и телефон", "error");
        return;
      }
      // Create patient
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...PIN_HEADER },
        body: JSON.stringify({
          fullName: newPatient.fullName,
          phone: newPatient.phone,
          passport: newPatient.passport || undefined,
        }),
      });
      if (!res.ok) { showToast("Ошибка создания пациента", "error"); return; }
      const patient = await res.json();
      patientId = patient.id;
    }

    // Add to queue
    const res = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...PIN_HEADER },
      body: JSON.stringify({
        patientId,
        doctorId: selectedDoctorId,
        service: service || undefined,
      }),
    });

    if (res.ok) {
      const appt = await res.json();
      showToast(`${selectedPatient?.fullName || newPatient.fullName} добавлен в очередь`);
      // Reset
      setShowAddPanel(false);
      setSelectedPatient(null);
      setNewPatient({ fullName: "", phone: "", passport: "" });
      setSelectedDoctorId("");
      setService("");
      setSearchQuery("");
      setSearchResults([]);
      fetchQueues();

      // Open print ticket
      window.open(`/q/${appt.id}`, "_blank");
    } else {
      showToast("Ошибка добавления", "error");
    }
  }

  async function handleCallPatient(appointmentId: string) {
    // Start the appointment (moves to IN_PROGRESS) + call on TV
    await fetch(`/api/queue/${appointmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...PIN_HEADER },
      body: JSON.stringify({ action: "start" }),
    });
    await fetch("/api/queue/call", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...PIN_HEADER },
      body: JSON.stringify({ appointmentId }),
    });
    showToast("Пациент вызван!");
    fetchQueues();
  }

  async function handleSkip(appointmentId: string) {
    await fetch(`/api/queue/${appointmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...PIN_HEADER },
      body: JSON.stringify({ action: "skip" }),
    });
    fetchQueues();
  }

  function selectPatientFromSearch(patient: Patient) {
    setSelectedPatient(patient);
    setNewPatient({ fullName: patient.fullName, phone: patient.phone, passport: patient.passport || "" });
    setSearchResults([]);
    setSearchQuery("");
    setShowAddPanel(true);
  }

  const timeStr = time.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const totalWaiting = doctors.reduce((s, d) => s + d.waiting.length, 0);
  const totalCurrent = doctors.filter((d) => d.current).length;

  if (!unlocked) {
    return <PinLock onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg animate-slide-in ${
          toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
        }`}>
          {toast.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="NeuroFax-B" className="h-9" />
          <div className="h-6 w-px bg-gray-200" />
          <h1 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Ресепшн</h1>
        </div>

        {/* Quick search */}
        <div className="relative w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск пациента (F1)... Телефон или ФИО"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-xl z-20 max-h-60 overflow-y-auto">
              {searchResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPatientFromSearch(p)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                    {p.fullName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{p.fullName}</p>
                    <p className="text-xs text-gray-500">{p.phone}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-6 text-sm">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-800 tabular-nums">{totalWaiting}</p>
              <p className="text-xs text-gray-500">Ожидают</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600 tabular-nums">{totalCurrent}</p>
              <p className="text-xs text-gray-500">На приёме</p>
            </div>
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <span className="text-lg font-mono font-bold text-gray-600 tabular-nums">{timeStr}</span>
          <button
            onClick={() => setShowLeadsPanel(true)}
            className="relative flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            title="Заявки с сайта"
          >
            <Inbox className={`h-4 w-4 ${newLeadsCount > 0 ? "text-amber-600" : ""}`} />
            Заявки
            {newLeadsCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white animate-pulse">
                {newLeadsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowAddPanel(true)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            Добавить (F2)
          </button>
        </div>
      </header>

      {/* Main content: doctor queues */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {doctors.map((doc) => (
            <div key={doc.id} className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden flex flex-col">
              {/* Doctor header */}
              <div className="bg-gray-50 px-5 py-3 flex items-center justify-between border-b border-gray-100">
                <div>
                  <p className="font-bold text-gray-800">{doc.nameRu}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                    <MapPin className="h-3 w-3" />
                    <span>Кабинет {doc.cabinet}</span>
                    <span className="text-gray-300">•</span>
                    <span>~{doc.avgDuration} мин/чел</span>
                  </div>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">
                  {doc.cabinet}
                </div>
              </div>

              {/* Current patient */}
              <div className={`px-5 py-3 border-b ${doc.current ? "bg-green-50 border-green-100" : "border-gray-100"}`}>
                {doc.current ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-green-600 font-semibold uppercase tracking-wider">На приёме</p>
                      <p className="font-bold text-green-800">{doc.current.fullName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    </div>
                  </div>
                ) : doc.waiting.length > 0 ? (
                  <button
                    onClick={() => handleCallPatient(doc.waiting[0].id)}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-500 py-2 text-sm font-semibold text-white hover:bg-green-600 transition-colors"
                  >
                    <Bell className="h-4 w-4" />
                    Вызвать {doc.waiting[0].fullName}
                  </button>
                ) : (
                  <p className="text-sm text-gray-400">Нет на приёме</p>
                )}
              </div>

              {/* Waiting list */}
              <div className="flex-1 divide-y divide-gray-50">
                {doc.waiting.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-gray-300">Очередь пуста</p>
                ) : (
                  doc.waiting.map((w, i) => (
                    <div key={w.id} className={`px-5 py-2.5 flex items-center justify-between group ${
                      i === 0 ? "bg-amber-50/50" : ""
                    }`}>
                      <div className="flex items-center gap-3">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                          i === 0 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
                        }`}>
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{w.fullName}</p>
                          <p className="text-[10px] text-gray-400">
                            <span className="font-mono font-bold text-gray-600">{w.ticketNumber}</span> · ~{w.etaMinutes} мин
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCallPatient(w.id)}
                          className="flex h-7 items-center gap-1 rounded-lg bg-green-500 px-2.5 text-[11px] font-semibold text-white hover:bg-green-600 transition-colors"
                          title="Вызвать"
                        >
                          <Volume2 className="h-3 w-3" />
                          Вызвать
                        </button>
                        <button
                          onClick={() => window.open(`/ticket/${w.id}`, "_blank")}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                          title="Печать талона"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleSkip(w.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                          title="Пропустить"
                        >
                          <SkipForward className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Quick add to this doctor */}
              <div className="border-t border-gray-100 px-5 py-2.5">
                <button
                  onClick={() => { setSelectedDoctorId(doc.id); setShowAddPanel(true); }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors"
                >
                  <UserPlus className="h-3 w-3" />
                  Добавить в очередь
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add patient panel (slide-over) */}
      {showAddPanel && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowAddPanel(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold">Добавить в очередь</h2>
              <button onClick={() => setShowAddPanel(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Patient search in panel */}
              {!selectedPatient && (
                <div>
                  <label className="text-sm font-semibold text-gray-700">Поиск пациента</label>
                  <div className="mt-1.5 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Телефон или ФИО..."
                      className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                  {searchResults.length > 0 && (
                    <div className="mt-2 rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => selectPatientFromSearch(p)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                            {p.fullName.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{p.fullName}</p>
                            <p className="text-xs text-gray-500">{p.phone}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400">или новый пациент</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                </div>
              )}

              {/* Selected patient badge */}
              {selectedPatient && (
                <div className="flex items-center justify-between rounded-xl bg-blue-50 border border-blue-200 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-200 text-sm font-bold text-blue-700">
                      {selectedPatient.fullName.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{selectedPatient.fullName}</p>
                      <p className="text-xs text-blue-600">{selectedPatient.phone}</p>
                    </div>
                  </div>
                  <button onClick={() => { setSelectedPatient(null); setNewPatient({ fullName: "", phone: "", passport: "" }); }} className="text-blue-400 hover:text-blue-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* New patient form */}
              {!selectedPatient && (
                <>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">ФИО пациента *</label>
                    <input
                      value={newPatient.fullName}
                      onChange={(e) => setNewPatient({ ...newPatient, fullName: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Телефон *</label>
                    <input
                      value={newPatient.phone}
                      onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                      placeholder="+998"
                      className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Паспорт</label>
                    <input
                      value={newPatient.passport}
                      onChange={(e) => setNewPatient({ ...newPatient, passport: e.target.value })}
                      placeholder="AA1234567"
                      className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                </>
              )}

              {/* Doctor selection */}
              <div>
                <label className="text-sm font-semibold text-gray-700">Врач *</label>
                <div className="mt-1.5 grid grid-cols-1 gap-2">
                  {doctors.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => setSelectedDoctorId(doc.id)}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                        selectedDoctorId === doc.id
                          ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                          : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white ${
                          selectedDoctorId === doc.id ? "bg-blue-600" : "bg-gray-400"
                        }`}>
                          {doc.cabinet}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{doc.nameRu}</p>
                          <p className="text-xs text-gray-500">Каб. {doc.cabinet} • {doc.waiting.length} в очереди</p>
                        </div>
                      </div>
                      {selectedDoctorId === doc.id && <CheckCircle className="h-5 w-5 text-blue-600" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Service */}
              <div>
                <label className="text-sm font-semibold text-gray-700">Услуга</label>
                {doctorServices.length > 0 ? (
                  <div className="mt-1.5 space-y-1.5">
                    {doctorServices.map((svc) => (
                      <button
                        key={svc.name}
                        type="button"
                        onClick={() => setService(svc.name)}
                        className={`w-full flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm text-left transition-colors ${
                          service === svc.name
                            ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                            : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30"
                        }`}
                      >
                        <span className="font-medium">{svc.name}</span>
                        <span className="text-xs text-gray-500 tabular-nums">{svc.price.toLocaleString()} сум</span>
                      </button>
                    ))}
                    <input
                      value={doctorServices.some((s) => s.name === service) ? "" : service}
                      onChange={(e) => setService(e.target.value)}
                      placeholder="Или введите вручную..."
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                ) : (
                  <input
                    value={service}
                    onChange={(e) => setService(e.target.value)}
                    placeholder="Консультация, ЭЭГ..."
                    className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={handleAddToQueue}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                Добавить в очередь
              </button>
              <p className="text-center text-[10px] text-gray-400 mt-2">
                Талон с QR-кодом откроется автоматически
              </p>
            </div>
          </div>
        </div>
      )}

      {showLeadsPanel && (
        <LeadsPanel
          leads={leads}
          doctors={doctors}
          onClose={() => setShowLeadsPanel(false)}
          onBook={handleBookLead}
          onStatus={handleLeadStatus}
        />
      )}

      <style>{`
        @keyframes slide-in { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slide-in 0.3s ease-out; }
        .animate-slide-in-right { animation: slide-in-right 0.3s ease-out; }
      `}</style>
    </div>
  );
}

function LeadsPanel({
  leads,
  doctors,
  onClose,
  onBook,
  onStatus,
}: {
  leads: LeadItem[];
  doctors: DoctorQueue[];
  onClose: () => void;
  onBook: (leadId: string, doctorId: string, service: string, date: string, time: string) => void;
  onStatus: (leadId: string, status: string) => void;
}) {
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [form, setForm] = useState({ doctorId: "", service: "", date: "", time: "09:00" });

  const allTimes: string[] = [];
  for (let h = 8; h <= 16; h++) {
    allTimes.push(`${String(h).padStart(2, "0")}:00`);
    allTimes.push(`${String(h).padStart(2, "0")}:30`);
  }
  const times = allTimes.filter((t) => !isSlotPast(form.date || tashkentToday(), t));

  useEffect(() => {
    if (bookingId && times.length > 0 && !times.includes(form.time)) {
      setForm((f) => ({ ...f, time: times[0] }));
    }
  }, [form.date, form.time, bookingId, times]);

  function startBooking(lead: LeadItem) {
    const today = tashkentToday();
    const requested = lead.date && /^\d{4}-\d{2}-\d{2}$/.test(lead.date) && lead.date >= today
      ? lead.date
      : today;
    const firstSlot = allTimes.find((t) => !isSlotPast(requested, t)) || "09:00";
    setBookingId(lead.id);
    setForm({
      doctorId: lead.doctorId || "",
      service: lead.service || "",
      date: requested,
      time: firstSlot,
    });
  }

  function confirmBooking() {
    if (!bookingId || !form.doctorId) return;
    onBook(bookingId, form.doctorId, form.service, form.date, form.time);
    setBookingId(null);
  }

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-2xl flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold">Заявки с сайта</h2>
            <p className="text-xs text-gray-500">{leads.length} новых заявок</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Inbox className="h-12 w-12 mb-3" />
              <p className="text-sm">Нет новых заявок</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {leads.map((lead) => {
                const doctor = doctors.find((d) => d.id === lead.doctorId);
                const isBooking = bookingId === lead.id;
                return (
                  <div key={lead.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                          <p className="font-bold text-gray-900">{lead.name}</p>
                        </div>
                        <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline mt-1">
                          <Phone className="h-3 w-3" />
                          {lead.phone}
                        </a>
                        {doctor && (
                          <p className="text-xs text-gray-500 mt-1">
                            Врач: <span className="font-medium text-gray-700">{doctor.nameRu}</span>
                          </p>
                        )}
                        {lead.service && (
                          <p className="text-xs text-gray-500 mt-0.5">Услуга: {lead.service}</p>
                        )}
                        {lead.date && (
                          <p className="text-xs text-gray-500 mt-0.5">Желаемая дата: {lead.date}</p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-1.5">
                          {new Date(lead.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      {!isBooking && (
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            onClick={() => startBooking(lead)}
                            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            <Calendar className="h-3 w-3" />
                            Записать
                          </button>
                          <button
                            onClick={() => onStatus(lead.id, "CANCELLED")}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            Отклонить
                          </button>
                        </div>
                      )}
                    </div>

                    {isBooking && (
                      <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3 space-y-2">
                        <div>
                          <label className="text-[10px] font-semibold text-gray-600 uppercase">Врач</label>
                          <select
                            value={form.doctorId}
                            onChange={(e) => setForm({ ...form, doctorId: e.target.value, service: "" })}
                            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
                          >
                            <option value="">— выбрать —</option>
                            {doctors.map((d) => (
                              <option key={d.id} value={d.id}>{d.nameRu} (каб. {d.cabinet})</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-gray-600 uppercase">Дата</label>
                            <input
                              type="date"
                              value={form.date}
                              min={tashkentToday()}
                              onChange={(e) => setForm({ ...form, date: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-gray-600 uppercase">Время</label>
                            <select
                              value={form.time}
                              onChange={(e) => setForm({ ...form, time: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
                            >
                              {times.map((t) => (<option key={t} value={t}>{t}</option>))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-gray-600 uppercase">Услуга</label>
                          <input
                            value={form.service}
                            onChange={(e) => setForm({ ...form, service: e.target.value })}
                            placeholder="Консультация..."
                            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
                          />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => setBookingId(null)}
                            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-white"
                          >
                            Отмена
                          </button>
                          <button
                            onClick={confirmBooking}
                            disabled={!form.doctorId}
                            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Подтвердить
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

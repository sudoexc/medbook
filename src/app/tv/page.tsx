"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";

interface QueueDoctor {
  id: string;
  nameRu: string;
  cabinet: number;
  avgDuration: number;
  current: { fullName: string; startedAt: string } | null;
  waiting: { id: string; fullName: string; queueOrder: number; ticketNumber: string; etaMinutes: number }[];
}

interface CallData {
  fullName: string;
  cabinet: number;
  doctorName: string;
  ticketNumber: string;
}

const ANNOUNCEMENTS = [
  "NeuroFax-B  —  Неврологический центр  |  Приём ведётся с 08:00 до 17:00",
  "Тел: +998 71 275 28 18  |  Адрес: 13 квартал, ул. Лутфий 26-1, Ташкент",
  "Консультация невролога  •  ЭЭГ  •  ЭМГ  •  Кардиология  •  Детский приём",
  "Уважаемые пациенты, просим соблюдать тишину в зоне ожидания",
];

export default function TVQueuePage() {
  const [activated, setActivated] = useState(false);
  const [doctors, setDoctors] = useState<QueueDoctor[]>([]);
  const [time, setTime] = useState(new Date());
  const [call, setCall] = useState<CallData | null>(null);
  const [callVisible, setCallVisible] = useState(false);
  const [announcementIdx, setAnnouncementIdx] = useState(0);
  const lastCallRef = useRef<string>("");
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [pollDelay, setPollDelay] = useState(3000);

  const fetchData = useCallback(async () => {
    try {
      const [queueRes, callRes] = await Promise.all([
        fetch("/api/tv-queue"),
        fetch("/api/queue/call"),
      ]);
      if (!queueRes.ok && !callRes.ok) {
        // Both failed — back off, cap at 30s
        setPollDelay((d) => Math.min(d * 2, 30000));
        return;
      }
      // At least one succeeded — reset to base delay
      setPollDelay(3000);
      if (queueRes.ok) setDoctors(await queueRes.json());
      if (callRes.ok) {
        const data = await callRes.json();
        if (data.call && data.call.fullName !== lastCallRef.current) {
          lastCallRef.current = data.call.fullName;
          setCall(data.call);
          setCallVisible(true);

          // Play chime
          try {
            const ctx = new AudioContext();
            // First chime — G5
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.frequency.value = 784;
            osc1.type = "sine";
            gain1.gain.value = 0.4;
            osc1.start();
            gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
            osc1.stop(ctx.currentTime + 0.6);

            // Second chime — C6 (after 250ms)
            setTimeout(() => {
              const osc2 = ctx.createOscillator();
              const gain2 = ctx.createGain();
              osc2.connect(gain2);
              gain2.connect(ctx.destination);
              osc2.frequency.value = 1047;
              osc2.type = "sine";
              gain2.gain.value = 0.4;
              osc2.start();
              gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
              osc2.stop(ctx.currentTime + 0.6);
            }, 250);

            // Third chime — E6 (after 500ms)
            setTimeout(() => {
              const osc3 = ctx.createOscillator();
              const gain3 = ctx.createGain();
              osc3.connect(gain3);
              gain3.connect(ctx.destination);
              osc3.frequency.value = 1319;
              osc3.type = "sine";
              gain3.gain.value = 0.35;
              osc3.start();
              gain3.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
              osc3.stop(ctx.currentTime + 0.8);
            }, 500);

            // Voice announcement after chime
            setTimeout(() => {
              try {
                const utterance = new SpeechSynthesisUtterance(
                  `${data.call.fullName}, пройдите в кабинет ${data.call.cabinet}`
                );
                utterance.lang = "ru-RU";
                utterance.rate = 0.85;
                utterance.volume = 1;
                utterance.pitch = 1.1;
                speechSynthesis.speak(utterance);
              } catch {}
            }, 1200);
          } catch {}

          // Hide call overlay after 15 seconds
          clearTimeout(callTimeoutRef.current);
          callTimeoutRef.current = setTimeout(() => setCallVisible(false), 15000);
        }
      }
    } catch {
      setPollDelay((d) => Math.min(d * 2, 30000));
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, pollDelay);
    return () => clearInterval(id);
  }, [fetchData, pollDelay]);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Rotate announcements
  useEffect(() => {
    const id = setInterval(() => setAnnouncementIdx((i) => (i + 1) % ANNOUNCEMENTS.length), 8000);
    return () => clearInterval(id);
  }, []);

  const dateStr = time.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const timeStr = time.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const totalWaiting = doctors.reduce((s, d) => s + d.waiting.length, 0);
  const totalCurrent = doctors.filter((d) => d.current).length;

  // Activation screen
  if (!activated) {
    return (
      <div
        className="min-h-screen bg-[#0a1628] text-white flex flex-col items-center justify-center cursor-pointer"
        onClick={() => {
          setActivated(true);
          try { const ctx = new AudioContext(); ctx.resume(); } catch {}
        }}
      >
        <Image
          src="/logo.png"
          alt="NeuroFax-B"
          width={164}
          height={64}
          priority
          className="h-16 w-auto brightness-0 invert mb-8"
        />
        <div className="text-6xl font-bold mb-4">Электронная очередь</div>
        <p className="text-xl text-white/50 mb-12">Нажмите на экран для запуска</p>
        <div className="h-20 w-20 rounded-full border-4 border-white/30 flex items-center justify-center animate-pulse">
          <div className="h-0 w-0 border-l-[20px] border-l-white border-y-[14px] border-y-transparent ml-2" />
        </div>
        <p className="text-sm text-white/30 mt-12">NeuroFax-B v2.0</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0a1628] text-white flex flex-col overflow-hidden">
      {/* Call overlay */}
      {callVisible && call && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative text-center animate-scale-in">
            {/* Ripple rings */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="h-40 w-40 rounded-full border-2 border-green-400/30 animate-ping-slow" />
            </div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="h-56 w-56 rounded-full border border-green-400/15 animate-ping-slower" />
            </div>

            <div className="relative mb-8">
              <div className="inline-flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-green-600 text-6xl font-bold shadow-2xl shadow-green-500/40">
                {call.cabinet}
              </div>
            </div>
            <p className="text-green-400 text-2xl font-semibold uppercase tracking-[0.3em] mb-4">
              Проходите в кабинет
            </p>
            <p className="text-7xl sm:text-8xl font-bold text-white mb-6 leading-tight drop-shadow-lg">
              {call.fullName}
            </p>
            <div className="flex items-center justify-center gap-6 text-2xl text-white/60">
              <span>Кабинет {call.cabinet}</span>
              <span className="text-white/20">|</span>
              <span>{call.doctorName}</span>
            </div>
            <p className="mt-8 text-xl font-mono text-green-300/70 tracking-widest">{call.ticketNumber}</p>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="shrink-0 bg-white/5 border-b border-white/10 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <Image
            src="/logo.png"
            alt="NeuroFax-B"
            width={113}
            height={44}
            priority
            className="h-11 w-auto brightness-0 invert"
          />
          <div className="h-8 w-px bg-white/15" />
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-white/60">Ожидают:</span>
              <span className="text-2xl font-bold text-amber-300 tabular-nums">{totalWaiting}</span>
            </div>
            <div className="h-5 w-px bg-white/15" />
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white/60">На приёме:</span>
              <span className="text-2xl font-bold text-green-300 tabular-nums">{totalCurrent}</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular-nums font-mono tracking-tight">{timeStr}</p>
          <p className="text-base text-white/50 capitalize">{dateStr}</p>
        </div>
      </div>

      {/* Doctors grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {doctors.map((doc) => (
            <div key={doc.id} className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden flex flex-col">
              {/* Doctor header */}
              <div className="bg-white/[0.06] px-5 py-3 flex items-center justify-between border-b border-white/10">
                <div>
                  <p className="text-lg font-bold">{doc.nameRu}</p>
                  <p className="text-xs text-white/40">Кабинет {doc.cabinet}</p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#1B4F7A] to-[#2a6ea8] text-xl font-bold shadow-lg">
                  {doc.cabinet}
                </div>
              </div>

              {/* Current patient */}
              <div className={`px-5 py-3 border-b border-white/10 ${doc.current ? "bg-green-500/10" : ""}`}>
                {doc.current ? (
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <div className="h-3 w-3 rounded-full bg-green-400" />
                      <div className="h-3 w-3 rounded-full bg-green-400 absolute top-0 animate-ping" />
                    </div>
                    <div>
                      <p className="text-[10px] text-green-400 font-semibold uppercase tracking-wider">Сейчас на приёме</p>
                      <p className="text-xl font-bold text-green-300">{doc.current.fullName}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-white/15" />
                    <div>
                      <p className="text-[10px] text-white/30 uppercase tracking-wider">Сейчас на приёме</p>
                      <p className="text-base text-white/20">Свободен</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Waiting list */}
              <div className="flex-1 px-5 py-3">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">
                  Ожидают ({doc.waiting.length})
                </p>
                {doc.waiting.length === 0 ? (
                  <p className="text-white/15 text-sm py-3 text-center">Нет ожидающих</p>
                ) : (
                  <div className="space-y-1.5">
                    {doc.waiting.slice(0, 6).map((w, i) => (
                      <div key={w.id} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${
                        i === 0 ? "bg-amber-500/10 border border-amber-500/20" : "bg-white/[0.02]"
                      }`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`flex h-7 min-w-[3.5rem] shrink-0 items-center justify-center rounded-md text-xs font-bold font-mono ${
                            i === 0 ? "bg-amber-500/25 text-amber-300" : "bg-white/10 text-white/40"
                          }`}>
                            {w.ticketNumber}
                          </span>
                          <p className={`text-sm truncate ${i === 0 ? "font-semibold text-amber-200" : "text-white/50"}`}>
                            {w.fullName}
                          </p>
                        </div>
                        <span className="text-[10px] text-white/25 tabular-nums shrink-0">
                          ~{w.etaMinutes} мин
                        </span>
                      </div>
                    ))}
                    {doc.waiting.length > 6 && (
                      <p className="text-xs text-white/20 text-center py-1">
                        +{doc.waiting.length - 6} ещё
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {doctors.length === 0 && (
          <div className="flex items-center justify-center h-[60vh]">
            <div className="text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/5 mb-4">
                <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
              </div>
              <p className="text-xl text-white/30">Загрузка данных...</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom ticker */}
      <div className="shrink-0 bg-[#1B4F7A] border-t border-white/10 px-6 py-3 overflow-hidden">
        <div className="flex items-center gap-4">
          <div className="shrink-0 flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1">
            <div className="h-2 w-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider">LIVE</span>
          </div>
          <div className="flex-1 overflow-hidden relative h-6">
            <p
              key={announcementIdx}
              className="absolute inset-0 text-sm text-white/80 whitespace-nowrap animate-ticker"
            >
              {ANNOUNCEMENTS[announcementIdx]}
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scale-in { from { opacity: 0; transform: scale(0.85) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes ping-slow { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(2.5); opacity: 0; } }
        @keyframes ping-slower { 0% { transform: scale(1); opacity: 0.3; } 100% { transform: scale(3); opacity: 0; } }
        @keyframes ticker { 0% { transform: translateX(100%); opacity: 0; } 5% { opacity: 1; } 95% { opacity: 1; } 100% { transform: translateX(-100%); opacity: 0; } }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-scale-in { animation: scale-in 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-ping-slow { animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite; }
        .animate-ping-slower { animation: ping-slower 2.5s cubic-bezier(0, 0, 0.2, 1) infinite 0.5s; }
        .animate-ticker { animation: ticker 8s linear; }
      `}</style>
    </div>
  );
}

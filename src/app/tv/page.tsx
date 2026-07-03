"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";

import { usePublicClinicSlug } from "@/hooks/use-public-clinic-slug";
import { useQueueBoard, type BoardDoctor } from "@/hooks/use-queue-board";

interface Overlay {
  ticketNumber: string;
  cabinet: string;
  patientName: string;
  doctorName: string;
}

function playChime() {
  try {
    const ctx = new AudioContext();
    const tone = (freq: number, delay: number, dur: number, vol: number) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.value = vol;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
        osc.stop(ctx.currentTime + dur);
      }, delay);
    };
    tone(784, 0, 0.6, 0.4); // G5
    tone(1047, 250, 0.6, 0.4); // C6
    tone(1319, 500, 0.8, 0.35); // E6
  } catch {
    // AudioContext blocked until the screen is tapped — splash handles that.
  }
}

function announce(patientName: string, cabinet: string, ticketNumber: string) {
  setTimeout(() => {
    try {
      const who = patientName
        ? patientName
        : ticketNumber
          ? `Талон ${ticketNumber}`
          : "Следующий пациент";
      const u = new SpeechSynthesisUtterance(
        cabinet ? `${who}, пройдите в кабинет ${cabinet}` : `${who}, проходите`,
      );
      u.lang = "ru-RU";
      u.rate = 0.85;
      u.volume = 1;
      u.pitch = 1.1;
      speechSynthesis.speak(u);
    } catch {
      // Speech synthesis unavailable — visual overlay still shows.
    }
  }, 1200);
}

export default function TVQueuePage() {
  const slug = usePublicClinicSlug();
  const { board, call, connected } = useQueueBoard(slug);

  const [activated, setActivated] = useState(false);
  const [time, setTime] = useState(new Date());
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  const lastCallSeq = useRef(0);
  const overlayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doctors = board?.doctors ?? [];
  const clinicName = board?.clinic.nameRu ?? "Электронная очередь";

  // Live clock.
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // React to a `queue.called` signal: resolve the called patient/doctor from
  // the current board snapshot, chime, announce, and show the overlay once.
  useEffect(() => {
    if (!call || call.seq === lastCallSeq.current) return;
    lastCallSeq.current = call.seq;

    const doc = doctors.find((d) => d.id === call.doctorId);
    const cabinet = call.cabinetNumber ?? doc?.cabinet ?? "";
    const ticketNumber = call.ticketNumber ?? doc?.current?.ticketNumber ?? "";
    const patientName = doc?.current?.fullName ?? "";
    const doctorName = doc?.nameRu ?? "";

    setOverlay({ ticketNumber, cabinet, patientName, doctorName });
    playChime();
    announce(patientName, cabinet, ticketNumber);

    clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setOverlay(null), 15000);
    return () => clearTimeout(overlayTimer.current);
  }, [call, doctors]);

  const dateStr = time.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeStr = time.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const totalWaiting = doctors.reduce((s, d) => s + d.waiting.length, 0);
  const totalCurrent = doctors.filter((d) => d.current).length;

  // Activation screen — taps resume AudioContext so the chime can play.
  if (!activated) {
    return (
      <div
        className="min-h-screen bg-[var(--public-bg)] text-[var(--public-fg)] flex flex-col items-center justify-center cursor-pointer"
        onClick={() => {
          setActivated(true);
          try {
            new AudioContext().resume();
          } catch {
            /* resumed on first chime instead */
          }
        }}
      >
        <Image
          src="/logo.png"
          alt={clinicName}
          width={164}
          height={64}
          priority
          className="h-16 w-auto brightness-0 invert mb-8"
        />
        <div className="text-6xl font-bold mb-4">Электронная очередь</div>
        <p className="text-xl text-[var(--public-fg-muted)] mb-12">
          Нажмите на экран для запуска
        </p>
        <div className="h-20 w-20 rounded-full border-4 border-[var(--public-border-strong)] flex items-center justify-center animate-pulse">
          <div className="h-0 w-0 border-l-[20px] border-l-[var(--public-fg)] border-y-[14px] border-y-transparent ml-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[var(--public-bg)] text-[var(--public-fg)] flex flex-col overflow-hidden">
      {overlay && <CallOverlay overlay={overlay} />}

      {/* Header */}
      <div className="shrink-0 bg-[var(--public-panel-strong)] border-b border-[var(--public-border)] px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <Image
            src="/logo.png"
            alt={clinicName}
            width={113}
            height={44}
            priority
            className="h-11 w-auto brightness-0 invert"
          />
          <div className="h-8 w-px bg-[var(--public-border-strong)]" />
          <div className="flex items-center gap-4 text-sm">
            <Stat
              label="Ожидают"
              value={totalWaiting}
              color="var(--public-waiting)"
            />
            <div className="h-5 w-px bg-[var(--public-border-strong)]" />
            <Stat
              label="На приёме"
              value={totalCurrent}
              color="var(--public-active)"
            />
          </div>
        </div>
        <div className="flex items-center gap-6">
          <ConnectionPill connected={connected} />
          <div className="text-right">
            <p className="text-4xl font-bold tabular-nums font-mono tracking-tight">
              {timeStr}
            </p>
            <p className="text-base text-[var(--public-fg-muted)] capitalize">
              {dateStr}
            </p>
          </div>
        </div>
      </div>

      {/* Doctor grid */}
      <div className="flex-1 overflow-auto p-6">
        {doctors.length === 0 ? (
          <EmptyBoard hasBoard={board !== null} />
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {doctors.map((doc) => (
              <DoctorCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scale-in { from { opacity: 0; transform: scale(0.85) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes ping-slow { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(2.5); opacity: 0; } }
        @keyframes ping-slower { 0% { transform: scale(1); opacity: 0.3; } 100% { transform: scale(3); opacity: 0; } }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-scale-in { animation: scale-in 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-ping-slow { animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite; }
        .animate-ping-slower { animation: ping-slower 2.5s cubic-bezier(0, 0, 0.2, 1) infinite 0.5s; }
      `}</style>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2.5 w-2.5 rounded-full animate-pulse"
        style={{ background: color }}
      />
      <span className="text-[var(--public-fg-muted)]">{label}:</span>
      <span className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function ConnectionPill({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-[var(--public-panel)] px-3 py-1.5 text-xs">
      <span
        className={`h-2 w-2 rounded-full ${connected ? "animate-pulse" : ""}`}
        style={{
          background: connected
            ? "var(--public-active)"
            : "var(--public-waiting)",
        }}
      />
      <span className="text-[var(--public-fg-muted)]">
        {connected ? "В сети" : "Переподключение…"}
      </span>
    </div>
  );
}

function DoctorCard({ doc }: { doc: BoardDoctor }) {
  const accent = doc.color || "var(--public-accent)";
  return (
    <div className="rounded-2xl bg-[var(--public-panel)] border border-[var(--public-border)] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="bg-[var(--public-panel-strong)] px-5 py-3 flex items-center justify-between border-b border-[var(--public-border)]">
        <div className="min-w-0">
          <p className="text-lg font-bold truncate">{doc.nameRu}</p>
          <p className="text-xs text-[var(--public-fg-muted)] truncate">
            {doc.specializationRu || "Врач"}
          </p>
        </div>
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${accent}, ${accent}99)`,
          }}
        >
          {doc.cabinet ?? "—"}
        </div>
      </div>

      {/* Current patient */}
      <div
        className="px-5 py-3 border-b border-[var(--public-border)]"
        style={doc.current ? { background: "rgb(22 199 132 / 0.10)" } : undefined}
      >
        {doc.current ? (
          <div className="flex items-center gap-3">
            <span className="relative shrink-0">
              <span className="block h-3 w-3 rounded-full bg-[var(--public-active)]" />
              <span className="absolute top-0 h-3 w-3 rounded-full bg-[var(--public-active)] animate-ping" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] text-[var(--public-active)] font-semibold uppercase tracking-wider">
                Сейчас на приёме
              </p>
              <p className="text-xl font-bold text-[var(--public-active)] truncate">
                {doc.current.fullName}
              </p>
            </div>
            <span className="ml-auto shrink-0 font-mono text-sm text-[var(--public-active)]/70">
              {doc.current.ticketNumber}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[var(--public-border-strong)]" />
            <div>
              <p className="text-[10px] text-[var(--public-fg-faint)] uppercase tracking-wider">
                Сейчас на приёме
              </p>
              <p className="text-base text-[var(--public-fg-faint)]">Свободен</p>
            </div>
          </div>
        )}
      </div>

      {/* Waiting list */}
      <div className="flex-1 px-5 py-3">
        <p className="text-[10px] text-[var(--public-fg-faint)] uppercase tracking-wider mb-2">
          Ожидают ({doc.waiting.length})
        </p>
        {doc.waiting.length === 0 ? (
          <p className="text-[var(--public-fg-faint)] text-sm py-3 text-center">
            Нет ожидающих
          </p>
        ) : (
          <div className="space-y-1.5">
            {doc.waiting.slice(0, 6).map((w, i) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                style={
                  i === 0
                    ? {
                        background: "rgb(245 158 11 / 0.10)",
                        border: "1px solid rgb(245 158 11 / 0.20)",
                      }
                    : { background: "var(--public-panel)" }
                }
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="flex h-7 min-w-[3.5rem] shrink-0 items-center justify-center rounded-md text-xs font-bold font-mono"
                    style={
                      i === 0
                        ? {
                            background: "rgb(245 158 11 / 0.25)",
                            color: "var(--public-waiting)",
                          }
                        : {
                            background: "var(--public-panel-strong)",
                            color: "var(--public-fg-faint)",
                          }
                    }
                  >
                    {w.ticketNumber}
                  </span>
                  <p
                    className={`text-sm truncate ${i === 0 ? "font-semibold" : ""}`}
                    style={{
                      color:
                        i === 0
                          ? "var(--public-waiting)"
                          : "var(--public-fg-muted)",
                    }}
                  >
                    {w.fullName}
                  </p>
                </div>
                <span className="text-[10px] text-[var(--public-fg-faint)] tabular-nums shrink-0">
                  ~{w.etaMinutes} мин
                </span>
              </div>
            ))}
            {doc.waiting.length > 6 && (
              <p className="text-xs text-[var(--public-fg-faint)] text-center py-1">
                +{doc.waiting.length - 6} ещё
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CallOverlay({ overlay }: { overlay: Overlay }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative text-center animate-scale-in">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-40 w-40 rounded-full border-2 border-[var(--public-active)]/30 animate-ping-slow" />
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-56 w-56 rounded-full border border-[var(--public-active)]/15 animate-ping-slower" />
        </div>

        {overlay.cabinet && (
          <div className="relative mb-8">
            <div
              className="inline-flex h-32 w-32 items-center justify-center rounded-full text-6xl font-bold shadow-2xl"
              style={{
                background:
                  "linear-gradient(135deg, var(--public-active), #0f9d6c)",
                boxShadow: "0 25px 50px -12px rgb(22 199 132 / 0.40)",
              }}
            >
              {overlay.cabinet}
            </div>
          </div>
        )}
        <p className="text-[var(--public-active)] text-2xl font-semibold uppercase tracking-[0.3em] mb-4">
          Проходите{overlay.cabinet ? " в кабинет" : ""}
        </p>
        <p className="text-7xl sm:text-8xl font-bold mb-6 leading-tight drop-shadow-lg">
          {overlay.patientName || overlay.ticketNumber}
        </p>
        <div className="flex items-center justify-center gap-6 text-2xl text-[var(--public-fg-muted)]">
          {overlay.cabinet && <span>Кабинет {overlay.cabinet}</span>}
          {overlay.cabinet && overlay.doctorName && (
            <span className="text-[var(--public-fg-faint)]">|</span>
          )}
          {overlay.doctorName && <span>{overlay.doctorName}</span>}
        </div>
        {overlay.ticketNumber && (
          <p className="mt-8 text-xl font-mono text-[var(--public-active)]/70 tracking-widest">
            {overlay.ticketNumber}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyBoard({ hasBoard }: { hasBoard: boolean }) {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--public-panel)] mb-4">
          <div className="h-6 w-6 rounded-full border-2 border-[var(--public-border-strong)] border-t-[var(--public-fg-muted)] animate-spin" />
        </div>
        <p className="text-xl text-[var(--public-fg-faint)]">
          {hasBoard ? "Сегодня приёма нет" : "Загрузка данных…"}
        </p>
      </div>
    </div>
  );
}

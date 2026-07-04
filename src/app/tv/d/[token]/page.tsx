"use client";

/**
 * Personal doctor TV — `/tv/d/<token>`.
 *
 * One screen per doctor, mounted PORTRAIT at the cabinet. Information-board
 * design (flat signage, not a web page): solid background, hairline rules,
 * typographic hierarchy, tabular/mono numerals, ONE accent color (the
 * doctor's), zero gradients/blur/glow — per the owner's explicit direction.
 *
 * Portrait (default): header → «Сейчас» strip → «Живая очередь» → «Записи».
 * Landscape fallback: queue and bookings side by side.
 *
 * A `queue.called` signal for THIS doctor takes the screen over with a flat
 * full-green call board + chime + voice; other doctors' calls never disturb
 * this screen. PII is initials-only (server-enforced). No ticker.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "next/navigation";

import {
  useDoctorBoard,
  type DoctorBoardSlot,
} from "@/hooks/use-doctor-board";

// ─── Tunables (visual iteration knobs) ──────────────────────────────────────
const OVERLAY_MS = 15_000; // call takeover auto-dismiss
const MAX_WAITING_ROWS = 7; // queue rows before «ещё N»
const MAX_PAST_COMPACT = 2; // finished bookings kept visible above the now-line
const MAX_UPCOMING_ROWS = 8; // booking rows before «ещё N»
const SPEECH_DELAY_MS = 1200; // chime first, then the voice
// Flat board palette — solid colors only (no translucency on surfaces).
const C = {
  bg: "#0B1322",
  row: "#131D30",
  rowActive: "#15243A",
  line: "#243049",
  fg: "#F2F5FA",
  muted: "#8B97AC",
  faint: "#566178",
  green: "#16C784",
  amber: "#F5A623",
};
// ────────────────────────────────────────────────────────────────────────────

interface Overlay {
  ticketNumber: string;
  cabinet: string;
  patientName: string;
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
      // Speech synthesis unavailable — visual board still flips.
    }
  }, SPEECH_DELAY_MS);
}

const SLOT_META: Record<
  DoctorBoardSlot["status"],
  { label: string; color: string }
> = {
  BOOKED: { label: "запись", color: C.muted },
  CONFIRMED: { label: "подтверждена", color: C.muted },
  // Two-lanes: an arrived booking waits on the schedule axis, not in the
  // live queue — the label says so.
  WAITING: { label: "пришёл", color: C.amber },
  IN_PROGRESS: { label: "на приёме", color: C.green },
  COMPLETED: { label: "завершён", color: C.faint },
};

/** "HH:mm" → minutes since midnight; unparseable → +∞ (sorts last). */
function slotMinutes(time: string | null): number {
  if (!time) return Number.POSITIVE_INFINITY;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 60 + Number(m[2]);
}

export default function DoctorTVPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { data, notFound, call, connected } = useDoctorBoard(token);

  const [activated, setActivated] = useState(false);
  const [time, setTime] = useState(new Date());
  // Overlay derived from the latest call; dismissed by seq after OVERLAY_MS.
  const [dismissedSeq, setDismissedSeq] = useState(0);

  const lastCallSeq = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Side effects of a fresh `queue.called` for THIS doctor: chime + voice.
  useEffect(() => {
    if (!call || call.seq === lastCallSeq.current) return;
    lastCallSeq.current = call.seq;
    const cabinet = call.cabinetNumber ?? data?.doctor.cabinet ?? "";
    const ticketNumber =
      call.ticketNumber ?? data?.queue.current?.ticketNumber ?? "";
    playChime();
    announce(data?.queue.current?.fullName ?? "", cabinet, ticketNumber);
  }, [call, data]);

  // Auto-dismiss the call board after OVERLAY_MS (async setState — allowed).
  useEffect(() => {
    if (!call) return;
    const t = setTimeout(() => setDismissedSeq(call.seq), OVERLAY_MS);
    return () => clearTimeout(t);
  }, [call]);

  const overlay: Overlay | null =
    call && call.seq !== dismissedSeq
      ? {
          ticketNumber:
            call.ticketNumber ?? data?.queue.current?.ticketNumber ?? "",
          cabinet: call.cabinetNumber ?? data?.doctor.cabinet ?? "",
          patientName: data?.queue.current?.fullName ?? "",
        }
      : null;

  const accent = data?.doctor.color || "#2353FF";
  const nowMinutes = time.getHours() * 60 + time.getMinutes();

  const slotsSorted = useMemo(
    () =>
      [...(data?.slots ?? [])].sort(
        (a, b) => slotMinutes(a.time) - slotMinutes(b.time),
      ),
    [data?.slots],
  );
  const pastSlots = slotsSorted.filter((s) => slotMinutes(s.time) < nowMinutes);
  const upcomingSlots = slotsSorted.filter(
    (s) => slotMinutes(s.time) >= nowMinutes,
  );
  const doneCount = slotsSorted.filter((s) => s.status === "COMPLETED").length;

  if (notFound) {
    return (
      <Board>
        <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center">
          <p className="text-5xl font-bold">Экран не найден</p>
          <p className="text-2xl" style={{ color: C.muted }}>
            Ссылка недействительна или врач деактивирован
          </p>
        </div>
      </Board>
    );
  }

  // Activation splash — a tap resumes AudioContext so the chime can play.
  if (!activated) {
    return (
      <Board>
        <div
          className="flex h-full cursor-pointer flex-col items-center justify-center px-10 text-center"
          onClick={() => {
            setActivated(true);
            try {
              new AudioContext().resume();
            } catch {
              /* resumed on first chime instead */
            }
          }}
        >
          {data?.doctor.cabinet && (
            <div
              className="mb-10 flex h-32 w-32 items-center justify-center rounded-lg text-6xl font-bold"
              style={{ background: accent, color: "#fff" }}
            >
              {data.doctor.cabinet}
            </div>
          )}
          <p className="text-5xl font-bold leading-tight">
            {data?.doctor.nameRu ?? "Экран врача"}
          </p>
          <p className="mt-3 text-2xl" style={{ color: C.muted }}>
            {data?.doctor.specializationRu ?? ""}
          </p>
          <p className="mt-16 text-xl" style={{ color: C.faint }}>
            Нажмите на экран для запуска
          </p>
        </div>
      </Board>
    );
  }

  const timeStr = time.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = time.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <Board>
      {overlay && <CallBoard overlay={overlay} />}

      <div className="flex h-full flex-col">
        {/* ── Header: cabinet plate · doctor · clock ─────────────────── */}
        <header
          className="shrink-0 px-8 pt-7 pb-5"
          style={{ borderBottom: `1px solid ${C.line}` }}
        >
          <div className="flex items-center gap-6">
            {data?.doctor.cabinet && (
              <div
                className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-lg"
                style={{ background: accent, color: "#fff" }}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
                  кабинет
                </span>
                <span className="text-5xl font-bold leading-none">
                  {data.doctor.cabinet}
                </span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-4xl font-bold leading-tight">
                {data?.doctor.nameRu ?? "…"}
              </p>
              <p className="mt-1 truncate text-2xl" style={{ color: C.muted }}>
                {data?.doctor.specializationRu || "Врач"}
              </p>
            </div>
          </div>
          <div className="mt-5 flex items-baseline justify-between">
            <p className="text-xl capitalize" style={{ color: C.muted }}>
              {dateStr}
            </p>
            <div className="flex items-center gap-4">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: connected ? C.green : C.amber }}
                title={connected ? "В сети" : "Переподключение"}
              />
              <p className="font-mono text-6xl font-bold tabular-nums leading-none">
                {timeStr}
              </p>
            </div>
          </div>
        </header>

        {/* ── Now serving strip ──────────────────────────────────────── */}
        <section
          className="shrink-0 px-8 py-5"
          style={{
            background: data?.queue.current ? C.rowActive : "transparent",
            borderBottom: `1px solid ${C.line}`,
            borderLeft: `6px solid ${data?.queue.current ? C.green : "transparent"}`,
          }}
        >
          <p
            className="text-lg font-semibold uppercase tracking-wide"
            style={{ color: data?.queue.current ? C.green : C.faint }}
          >
            Сейчас принимается
          </p>
          {data?.queue.current ? (
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <p className="truncate text-5xl font-bold">
                {data.queue.current.fullName}
              </p>
              {data.queue.current.ticketNumber && (
                <p className="shrink-0 font-mono text-5xl font-bold tabular-nums">
                  {data.queue.current.ticketNumber}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-4xl" style={{ color: C.faint }}>
              Кабинет свободен
            </p>
          )}
        </section>

        {/* ── Two lanes: stacked portrait, side-by-side landscape ────── */}
        <main className="grid min-h-0 flex-1 grid-cols-1 landscape:grid-cols-2">
          {/* Live queue */}
          <section
            className="flex min-h-0 flex-col landscape:border-r"
            style={{ borderColor: C.line }}
          >
            <SectionRule
              title="Живая очередь"
              value={data ? String(data.queue.waiting.length) : "…"}
              valueColor={C.amber}
            />
            <div className="min-h-0 flex-1 overflow-hidden px-8">
              {!data || data.queue.waiting.length === 0 ? (
                <p className="py-8 text-2xl" style={{ color: C.faint }}>
                  {data ? "Очередь пуста" : "Загрузка…"}
                </p>
              ) : (
                <div>
                  {data.queue.waiting.slice(0, MAX_WAITING_ROWS).map((w, i) => (
                    <div
                      key={w.id}
                      className="flex items-center gap-5 py-3.5 pl-3 -ml-3"
                      style={{
                        borderBottom: `1px solid ${C.line}`,
                        borderLeft: `6px solid ${i === 0 ? C.amber : "transparent"}`,
                        background: i === 0 ? C.row : "transparent",
                      }}
                    >
                      <span
                        className="w-24 shrink-0 font-mono text-4xl font-bold tabular-nums"
                        style={{ color: i === 0 ? C.amber : C.fg }}
                      >
                        {w.ticketNumber}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-3xl"
                        style={{ color: i === 0 ? C.fg : C.muted }}
                      >
                        {w.fullName}
                      </span>
                      <span
                        className="shrink-0 text-2xl tabular-nums"
                        style={{ color: C.faint }}
                      >
                        ~{w.etaMinutes} мин
                      </span>
                    </div>
                  ))}
                  {data.queue.waiting.length > MAX_WAITING_ROWS && (
                    <p className="py-2.5 text-xl" style={{ color: C.faint }}>
                      ещё {data.queue.waiting.length - MAX_WAITING_ROWS}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Today's bookings */}
          <section className="flex min-h-0 flex-col">
            <SectionRule
              title="Записи на сегодня"
              value={data ? `${doneCount}/${slotsSorted.length}` : "…"}
              valueColor={C.muted}
            />
            <div className="min-h-0 flex-1 overflow-hidden px-8">
              {!data || slotsSorted.length === 0 ? (
                <p className="py-8 text-2xl" style={{ color: C.faint }}>
                  {data ? "На сегодня записей нет" : "Загрузка…"}
                </p>
              ) : (
                <div>
                  {pastSlots.length > MAX_PAST_COMPACT && (
                    <p className="py-2 text-lg" style={{ color: C.faint }}>
                      раньше: {pastSlots.length - MAX_PAST_COMPACT}
                    </p>
                  )}
                  {pastSlots.slice(-MAX_PAST_COMPACT).map((s) => (
                    <SlotRow key={s.id} slot={s} compact />
                  ))}

                  {/* Now rule */}
                  <div className="flex items-center gap-3 py-2">
                    <span
                      className="h-0.5 flex-1"
                      style={{ background: accent }}
                    />
                    <span
                      className="shrink-0 font-mono text-lg font-bold tabular-nums"
                      style={{ color: accent }}
                    >
                      {timeStr}
                    </span>
                  </div>

                  {upcomingSlots.slice(0, MAX_UPCOMING_ROWS).map((s, i) => (
                    <SlotRow
                      key={s.id}
                      slot={s}
                      next={i === 0}
                      accent={accent}
                    />
                  ))}
                  {upcomingSlots.length > MAX_UPCOMING_ROWS && (
                    <p className="py-2.5 text-xl" style={{ color: C.faint }}>
                      ещё {upcomingSlots.length - MAX_UPCOMING_ROWS}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </main>

        {/* ── Footer: clinic name, quiet ─────────────────────────────── */}
        <footer
          className="shrink-0 px-8 py-3"
          style={{ borderTop: `1px solid ${C.line}` }}
        >
          <p className="text-lg" style={{ color: C.faint }}>
            {data?.clinic.nameRu ?? ""}
          </p>
        </footer>
      </div>
    </Board>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

/** Flat full-screen shell — solid background, nothing else. */
function Board({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-screen overflow-hidden"
      style={{ background: C.bg, color: C.fg }}
    >
      {children}
      <style>{`
        @keyframes board-in { from { opacity: 0; } to { opacity: 1; } }
        .board-in { animation: board-in 0.25s ease-out; }
      `}</style>
    </div>
  );
}

function SectionRule({
  title,
  value,
  valueColor,
}: {
  title: string;
  value: string;
  valueColor: string;
}) {
  return (
    <div
      className="mx-8 mt-6 mb-1 flex items-baseline justify-between pb-2"
      style={{ borderBottom: `2px solid ${C.line}` }}
    >
      <h2
        className="text-xl font-semibold uppercase tracking-wide"
        style={{ color: C.muted }}
      >
        {title}
      </h2>
      <span
        className="font-mono text-2xl font-bold tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </span>
    </div>
  );
}

function SlotRow({
  slot,
  accent,
  compact = false,
  next = false,
}: {
  slot: DoctorBoardSlot;
  accent?: string;
  compact?: boolean;
  next?: boolean;
}) {
  const meta = SLOT_META[slot.status];
  if (compact) {
    return (
      <div
        className="flex items-center gap-4 py-2"
        style={{ borderBottom: `1px solid ${C.line}`, opacity: 0.45 }}
      >
        <span className="w-20 shrink-0 font-mono text-xl tabular-nums">
          {slot.time ?? "—"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xl">{slot.fullName}</span>
        <span className="shrink-0 text-lg" style={{ color: meta.color }}>
          {slot.status === "COMPLETED" ? "✓" : meta.label}
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-5 py-3.5 pl-3 -ml-3"
      style={{
        borderBottom: `1px solid ${C.line}`,
        borderLeft: `6px solid ${next ? (accent ?? C.fg) : "transparent"}`,
        background: next ? C.row : "transparent",
      }}
    >
      <span className="w-24 shrink-0 font-mono text-3xl font-bold tabular-nums">
        {slot.time ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate text-3xl">{slot.fullName}</span>
      <span
        className="shrink-0 text-xl font-semibold"
        style={{ color: meta.color }}
      >
        {meta.label}
      </span>
    </div>
  );
}

/**
 * Call takeover — flat solid green board, the way real clinic signage flips.
 * No rings, no blur: color and size carry the message across the room.
 */
function CallBoard({ overlay }: { overlay: Overlay }) {
  return (
    <div
      className="board-in fixed inset-0 z-50 flex flex-col items-center justify-center px-10 text-center"
      style={{ background: C.green, color: "#06281B" }}
    >
      <p className="text-4xl font-bold uppercase tracking-widest">
        Пройдите{overlay.cabinet ? " в кабинет" : ""}
      </p>
      {overlay.cabinet && (
        <p className="mt-2 font-mono text-[11rem] font-bold leading-none tabular-nums">
          {overlay.cabinet}
        </p>
      )}
      <p className="mt-8 max-w-full truncate text-7xl font-bold">
        {overlay.patientName || overlay.ticketNumber || ""}
      </p>
      {overlay.ticketNumber && overlay.patientName && (
        <p className="mt-5 font-mono text-4xl font-semibold tabular-nums opacity-80">
          Талон {overlay.ticketNumber}
        </p>
      )}
    </div>
  );
}

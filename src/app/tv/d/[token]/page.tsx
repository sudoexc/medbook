"use client";

/**
 * Personal doctor TV — `/tv/d/<token>`.
 *
 * One screen per doctor, mounted at the cabinet door / inside the waiting
 * area. Left half: the LIVE queue (current patient hero + waiting list).
 * Right half: today's booked slot timeline with a moving "now" divider.
 * A `queue.called` signal for THIS doctor takes over the screen with a
 * full-screen call overlay + chime + voice announcement; other doctors'
 * calls never disturb this screen.
 *
 * Design: dark public-surface tokens + the doctor's own accent color as the
 * aurora/highlight hue, so every cabinet screen is subtly personalized.
 * All PII is initials-only (server-enforced). No ticker by design.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "next/navigation";

import {
  useDoctorBoard,
  type DoctorBoardData,
  type DoctorBoardSlot,
} from "@/hooks/use-doctor-board";

// ─── Tunables (visual iteration knobs) ──────────────────────────────────────
const OVERLAY_MS = 15_000; // call overlay auto-dismiss
const MAX_WAITING_ROWS = 8; // left panel rows before "+N ещё"
const MAX_PAST_COMPACT = 3; // right panel: compact past rows kept visible
const MAX_UPCOMING_ROWS = 9; // right panel rows before "+N ещё"
const AURORA_OPACITY = 0.32; // 0..1 — accent glow intensity
const SPEECH_DELAY_MS = 1200; // chime first, then the voice
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
      // Speech synthesis unavailable — visual overlay still shows.
    }
  }, SPEECH_DELAY_MS);
}

const SLOT_META: Record<
  DoctorBoardSlot["status"],
  { label: string; fg: string; bg: string }
> = {
  BOOKED: {
    label: "Запись",
    fg: "var(--public-fg-muted)",
    bg: "rgba(255,255,255,0.08)",
  },
  CONFIRMED: {
    label: "Подтверждена",
    fg: "#7cb7ff",
    bg: "rgba(35,83,255,0.18)",
  },
  WAITING: {
    label: "В очереди",
    fg: "var(--public-waiting)",
    bg: "rgba(245,158,11,0.16)",
  },
  IN_PROGRESS: {
    label: "На приёме",
    fg: "var(--public-active)",
    bg: "rgba(22,199,132,0.16)",
  },
  COMPLETED: {
    label: "Завершён",
    fg: "var(--public-fg-faint)",
    bg: "rgba(255,255,255,0.05)",
  },
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
  // The overlay is DERIVED from the latest call: visible until its seq is
  // dismissed by the timer below. No setState-in-effect, no cascading renders.
  const [dismissedSeq, setDismissedSeq] = useState(0);

  const lastCallSeq = useRef(0);

  // Live clock.
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

  // Auto-dismiss the overlay after OVERLAY_MS (async setState — allowed).
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

  const accent = data?.doctor.color || "var(--public-accent)";
  const nowMinutes = time.getHours() * 60 + time.getMinutes();

  const slotsSorted = useMemo(
    () =>
      [...(data?.slots ?? [])].sort(
        (a, b) => slotMinutes(a.time) - slotMinutes(b.time),
      ),
    [data?.slots],
  );
  const pastSlots = slotsSorted.filter(
    (s) => slotMinutes(s.time) < nowMinutes,
  );
  const upcomingSlots = slotsSorted.filter(
    (s) => slotMinutes(s.time) >= nowMinutes,
  );
  const doneCount = slotsSorted.filter((s) => s.status === "COMPLETED").length;

  if (notFound) {
    return (
      <Shell accent="var(--public-accent)">
        <div className="flex h-screen flex-col items-center justify-center gap-4">
          <div className="text-8xl">📺</div>
          <p className="text-4xl font-bold">Экран не найден</p>
          <p className="text-xl text-[var(--public-fg-muted)]">
            Ссылка недействительна или врач деактивирован
          </p>
        </div>
      </Shell>
    );
  }

  // Activation splash — a tap resumes AudioContext so the chime can play.
  if (!activated) {
    return (
      <Shell accent={accent}>
        <div
          className="flex h-screen cursor-pointer flex-col items-center justify-center"
          onClick={() => {
            setActivated(true);
            try {
              new AudioContext().resume();
            } catch {
              /* resumed on first chime instead */
            }
          }}
        >
          <DoctorAvatar data={data} accent={accent} size={128} />
          <p className="mt-8 text-6xl font-bold text-center leading-tight">
            {data?.doctor.nameRu ?? "Личный экран врача"}
          </p>
          <p className="mt-3 text-2xl text-[var(--public-fg-muted)]">
            {data?.doctor.specializationRu ?? ""}
          </p>
          <p className="mt-14 text-xl text-[var(--public-fg-faint)] animate-pulse">
            Нажмите на экран для запуска
          </p>
        </div>
      </Shell>
    );
  }

  const timeStr = time.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateStr = time.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <Shell accent={accent}>
      {overlay && <CallOverlay overlay={overlay} accent={accent} />}

      <div className="flex h-screen flex-col">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="shrink-0 flex items-center justify-between gap-6 px-10 py-5 border-b border-[var(--public-border)] bg-[var(--public-panel-strong)] backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-5">
            <DoctorAvatar data={data} accent={accent} size={64} />
            <div className="min-w-0">
              <p className="truncate text-3xl font-bold leading-tight">
                {data?.doctor.nameRu ?? "…"}
              </p>
              <p className="truncate text-lg text-[var(--public-fg-muted)]">
                {data?.doctor.specializationRu || "Врач"}
                <span className="mx-2 text-[var(--public-fg-faint)]">·</span>
                {data?.clinic.nameRu ?? ""}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-8">
            <ConnectionDot connected={connected} />
            {data?.doctor.cabinet && (
              <div className="flex items-center gap-3">
                <span className="text-sm uppercase tracking-widest text-[var(--public-fg-faint)]">
                  Кабинет
                </span>
                <span
                  className="flex h-16 min-w-16 items-center justify-center rounded-2xl px-4 text-4xl font-bold shadow-2xl"
                  style={{
                    background: `linear-gradient(135deg, ${accent}, ${accent}88)`,
                  }}
                >
                  {data.doctor.cabinet}
                </span>
              </div>
            )}
            <div className="text-right">
              <p className="font-mono text-5xl font-bold tabular-nums tracking-tight">
                {timeStr}
              </p>
              <p className="text-lg capitalize text-[var(--public-fg-muted)]">
                {dateStr}
              </p>
            </div>
          </div>
        </header>

        {/* ── Split body ─────────────────────────────────────────────── */}
        <main className="grid min-h-0 flex-1 grid-cols-2 gap-6 p-6">
          {/* LEFT — live queue */}
          <section className="flex min-h-0 flex-col rounded-3xl border border-[var(--public-border)] bg-[var(--public-panel)] backdrop-blur-xl overflow-hidden">
            <PanelTitle
              title="Живая очередь"
              badge={data ? String(data.queue.waiting.length) : "…"}
              badgeColor="var(--public-waiting)"
            />

            {/* Current patient hero */}
            <div className="px-7 pb-2">
              {data?.queue.current ? (
                <div
                  className="rounded-2xl border px-7 py-6 animate-rise"
                  style={{
                    borderColor: "rgba(22,199,132,0.35)",
                    background:
                      "linear-gradient(135deg, rgba(22,199,132,0.16), rgba(22,199,132,0.05))",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="relative shrink-0">
                      <span className="block h-3.5 w-3.5 rounded-full bg-[var(--public-active)]" />
                      <span className="absolute top-0 h-3.5 w-3.5 rounded-full bg-[var(--public-active)] animate-ping" />
                    </span>
                    <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--public-active)]">
                      Сейчас на приёме
                    </p>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-4">
                    <p className="truncate text-5xl font-bold text-[var(--public-active)]">
                      {data.queue.current.fullName}
                    </p>
                    <p className="shrink-0 font-mono text-3xl font-bold text-[var(--public-active)]/80">
                      {data.queue.current.ticketNumber}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-[var(--public-border)] px-7 py-6">
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--public-fg-faint)]">
                    Сейчас на приёме
                  </p>
                  <p className="mt-2 text-3xl text-[var(--public-fg-faint)]">
                    Кабинет свободен
                  </p>
                </div>
              )}
            </div>

            {/* Waiting list */}
            <div className="min-h-0 flex-1 overflow-hidden px-7 py-4">
              {!data || data.queue.waiting.length === 0 ? (
                <p className="py-10 text-center text-2xl text-[var(--public-fg-faint)]">
                  {data ? "Очередь пуста" : "Загрузка…"}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {data.queue.waiting
                    .slice(0, MAX_WAITING_ROWS)
                    .map((w, i) => (
                      <div
                        key={w.id}
                        className="flex items-center justify-between gap-4 rounded-xl px-5 py-3.5 animate-rise"
                        style={
                          i === 0
                            ? {
                                background: "rgba(245,158,11,0.12)",
                                border: "1px solid rgba(245,158,11,0.28)",
                              }
                            : {
                                background: "rgba(255,255,255,0.04)",
                                border: "1px solid transparent",
                              }
                        }
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <span
                            className="flex h-11 min-w-[4.5rem] shrink-0 items-center justify-center rounded-lg font-mono text-xl font-bold"
                            style={
                              i === 0
                                ? {
                                    background: "rgba(245,158,11,0.25)",
                                    color: "var(--public-waiting)",
                                  }
                                : {
                                    background: "rgba(255,255,255,0.07)",
                                    color: "var(--public-fg-muted)",
                                  }
                            }
                          >
                            {w.ticketNumber}
                          </span>
                          <p
                            className={`truncate text-2xl ${i === 0 ? "font-semibold" : ""}`}
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
                        <span className="shrink-0 text-lg tabular-nums text-[var(--public-fg-faint)]">
                          ~{w.etaMinutes} мин
                        </span>
                      </div>
                    ))}
                  {data.queue.waiting.length > MAX_WAITING_ROWS && (
                    <p className="pt-1 text-center text-lg text-[var(--public-fg-faint)]">
                      +{data.queue.waiting.length - MAX_WAITING_ROWS} ещё
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* RIGHT — today's slot timeline */}
          <section className="flex min-h-0 flex-col rounded-3xl border border-[var(--public-border)] bg-[var(--public-panel)] backdrop-blur-xl overflow-hidden">
            <PanelTitle
              title="Записи на сегодня"
              badge={
                data
                  ? `${doneCount}/${slotsSorted.length}`
                  : "…"
              }
              badgeColor={accent}
            />

            <div className="min-h-0 flex-1 overflow-hidden px-7 py-2">
              {!data || slotsSorted.length === 0 ? (
                <p className="py-10 text-center text-2xl text-[var(--public-fg-faint)]">
                  {data ? "На сегодня записей нет" : "Загрузка…"}
                </p>
              ) : (
                <div className="space-y-2">
                  {/* Past — compact, dimmed */}
                  {pastSlots.length > MAX_PAST_COMPACT && (
                    <p className="text-center text-base text-[var(--public-fg-faint)]">
                      +{pastSlots.length - MAX_PAST_COMPACT} ранее
                    </p>
                  )}
                  {pastSlots.slice(-MAX_PAST_COMPACT).map((s) => (
                    <SlotRow key={s.id} slot={s} compact accent={accent} />
                  ))}

                  {/* NOW divider */}
                  <div className="flex items-center gap-4 py-1.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: accent, boxShadow: `0 0 14px ${accent}` }}
                    />
                    <span
                      className="h-px flex-1"
                      style={{
                        background: `linear-gradient(90deg, ${accent}, transparent)`,
                      }}
                    />
                    <span
                      className="shrink-0 font-mono text-lg font-bold tabular-nums"
                      style={{ color: accent }}
                    >
                      {time.toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  {/* Upcoming */}
                  {upcomingSlots.slice(0, MAX_UPCOMING_ROWS).map((s, i) => (
                    <SlotRow
                      key={s.id}
                      slot={s}
                      next={i === 0}
                      accent={accent}
                    />
                  ))}
                  {upcomingSlots.length > MAX_UPCOMING_ROWS && (
                    <p className="pt-1 text-center text-lg text-[var(--public-fg-faint)]">
                      +{upcomingSlots.length - MAX_UPCOMING_ROWS} ещё
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </Shell>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

/** Full-screen shell: bg, aurora glows in the doctor accent, keyframes. */
function Shell({
  accent,
  children,
}: {
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-screen overflow-hidden bg-[var(--public-bg)] text-[var(--public-fg)]">
      {/* Aurora — two slow-drifting accent glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 -left-48 h-[42rem] w-[42rem] rounded-full blur-[140px] animate-drift"
        style={{ background: accent, opacity: AURORA_OPACITY }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-56 -right-40 h-[38rem] w-[38rem] rounded-full blur-[150px] animate-drift-rev"
        style={{ background: "#2353ff", opacity: AURORA_OPACITY * 0.7 }}
      />
      <div className="relative z-10 h-full">{children}</div>

      <style>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scale-in { from { opacity: 0; transform: scale(0.85) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ping-slow { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(2.5); opacity: 0; } }
        @keyframes ping-slower { 0% { transform: scale(1); opacity: 0.3; } 100% { transform: scale(3); opacity: 0; } }
        @keyframes drift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(60px,40px); } }
        @keyframes drift-rev { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-50px,-30px); } }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-scale-in { animation: scale-in 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-rise { animation: rise 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-ping-slow { animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite; }
        .animate-ping-slower { animation: ping-slower 2.5s cubic-bezier(0, 0, 0.2, 1) infinite 0.5s; }
        .animate-drift { animation: drift 18s ease-in-out infinite; }
        .animate-drift-rev { animation: drift-rev 22s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

function DoctorAvatar({
  data,
  accent,
  size,
}: {
  data: DoctorBoardData | null;
  accent: string;
  size: number;
}) {
  const name = data?.doctor.nameRu ?? "";
  const monogram = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
  const ring = { boxShadow: `0 0 0 3px ${accent}, 0 0 30px ${accent}66` };

  if (data?.doctor.photoUrl) {
    // Plain <img>: photoUrl is a MinIO URL and next/image would need a
    // remotePatterns entry per storage host — same posture as AvatarImage
    // everywhere else in the app.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={data.doctor.photoUrl}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, ...ring }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, ${accent}, ${accent}77)`,
        ...ring,
      }}
    >
      {monogram || "Dr"}
    </div>
  );
}

function PanelTitle({
  title,
  badge,
  badgeColor,
}: {
  title: string;
  badge: string;
  badgeColor: string;
}) {
  return (
    <div className="flex items-center justify-between px-7 pt-6 pb-4">
      <h2 className="text-xl font-bold uppercase tracking-[0.2em] text-[var(--public-fg-muted)]">
        {title}
      </h2>
      <span
        className="rounded-full px-4 py-1 font-mono text-xl font-bold tabular-nums"
        style={{ color: badgeColor, background: "rgba(255,255,255,0.06)" }}
      >
        {badge}
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
  accent: string;
  compact?: boolean;
  next?: boolean;
}) {
  const meta = SLOT_META[slot.status];
  if (compact) {
    return (
      <div className="flex items-center gap-4 rounded-lg px-4 py-1.5 opacity-45">
        <span className="w-16 shrink-0 font-mono text-lg tabular-nums">
          {slot.time ?? "—"}
        </span>
        <span className="min-w-0 flex-1 truncate text-lg">{slot.fullName}</span>
        <span className="shrink-0 text-base" style={{ color: meta.fg }}>
          {slot.status === "COMPLETED" ? "✓" : meta.label}
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-5 rounded-xl px-5 py-3 animate-rise"
      style={
        next
          ? {
              border: `1px solid ${accent}55`,
              background: `linear-gradient(90deg, ${accent}1f, transparent)`,
            }
          : {
              border: "1px solid transparent",
              background: "rgba(255,255,255,0.04)",
            }
      }
    >
      <span
        className="w-20 shrink-0 font-mono text-2xl font-bold tabular-nums"
        style={{ color: next ? accent : "var(--public-fg)" }}
      >
        {slot.time ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate text-2xl">
        {slot.fullName}
      </span>
      {next && (
        <span
          className="shrink-0 rounded-full px-3 py-0.5 text-sm font-bold uppercase tracking-wider"
          style={{ color: accent, background: `${accent}22` }}
        >
          Следующий
        </span>
      )}
      <span
        className="shrink-0 rounded-full px-3.5 py-1 text-base font-semibold"
        style={{ color: meta.fg, background: meta.bg }}
      >
        {meta.label}
      </span>
    </div>
  );
}

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-[var(--public-panel)] px-4 py-2 text-base">
      <span
        className={`h-2.5 w-2.5 rounded-full ${connected ? "animate-pulse" : ""}`}
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

function CallOverlay({
  overlay,
  accent,
}: {
  overlay: Overlay;
  accent: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" />
      <div className="relative text-center animate-scale-in">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-44 w-44 rounded-full border-2 border-[var(--public-active)]/30 animate-ping-slow" />
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-64 w-64 rounded-full border border-[var(--public-active)]/15 animate-ping-slower" />
        </div>

        {overlay.cabinet && (
          <div className="relative mb-10">
            <div
              className="inline-flex h-40 w-40 items-center justify-center rounded-full text-7xl font-bold shadow-2xl"
              style={{
                background: `linear-gradient(135deg, var(--public-active), ${accent})`,
                boxShadow: "0 25px 60px -12px rgb(22 199 132 / 0.45)",
              }}
            >
              {overlay.cabinet}
            </div>
          </div>
        )}
        <p className="mb-5 text-3xl font-semibold uppercase tracking-[0.35em] text-[var(--public-active)]">
          Проходите{overlay.cabinet ? " в кабинет" : ""}
        </p>
        <p className="mb-8 text-8xl font-bold leading-tight drop-shadow-lg sm:text-9xl">
          {overlay.patientName || overlay.ticketNumber}
        </p>
        {overlay.ticketNumber && (
          <p className="font-mono text-3xl tracking-[0.3em] text-[var(--public-active)]/70">
            {overlay.ticketNumber}
          </p>
        )}
      </div>
    </div>
  );
}

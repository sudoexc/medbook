"use client";

/**
 * Personal doctor TV — `/tv/d/<token>`. Bento signage, v3.
 *
 * Owner direction: no AI-slop styling (no gradients/blur/glow), TVs mounted
 * PORTRAIT, live queue on the LEFT and bookings on the RIGHT — always, in
 * both orientations. Visual language follows what holds up on 2026 boards:
 * bento tiles (solid surfaces a step lighter than the page, generous radius,
 * real gaps), typography-first hierarchy (huge tabular/mono numerals), deep
 * dark background with exactly two accents — green for "now serving", amber
 * for the live queue — plus the doctor's color on the cabinet plate only.
 * Queue status owns ~60% of the screen per clinic-signage practice.
 *
 * A `queue.called` signal for THIS doctor flips the screen to a flat solid
 * green call board + chime + voice; other doctors' calls never disturb it.
 * PII is initials-only (server-enforced). No ticker.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "next/navigation";

import {
  useDoctorBoard,
  type DoctorBoardSlot,
} from "@/hooks/use-doctor-board";
import { CallTakeover, announce, playChime } from "../../_shared";

// ─── Tunables (visual iteration knobs) ──────────────────────────────────────
const OVERLAY_MS = 15_000; // call takeover auto-dismiss
const MAX_WAITING_ROWS = 8; // queue rows before «ещё N»
const MAX_PAST_COMPACT = 2; // finished bookings kept above the now-line
const MAX_UPCOMING_ROWS = 9; // booking rows before «ещё N»
const TILE_RADIUS = 24; // bento tile corner radius, px
// Bento palette — LIGHT theme (owner's boss wants white/light, 2026-07-06).
// Solid layers only; depth = page one step darker than the white tiles +
// hairline tile borders. Accents darkened for contrast on white.
const C = {
  page: "#EEF1F6", // cool light gray — page background
  tile: "#FFFFFF", // tile surface
  inset: "#F1F4F9", // inset chip / highlighted row
  line: "#E2E7EF",
  fg: "#101828", // near-black text
  muted: "#5D6B7E",
};
const FAINT = "#98A2B3";
const GREEN = "#0BA168"; // readable on white
const GREEN_TINT = "#E7F7EF"; // now-serving tile fill
const AMBER = "#D97706"; // readable on white
// ────────────────────────────────────────────────────────────────────────────

interface Overlay {
  ticketNumber: string;
  cabinet: string;
  patientName: string;
}

const SLOT_META: Record<
  DoctorBoardSlot["status"],
  { label: string; color: string }
> = {
  BOOKED: { label: "запись", color: C.muted },
  CONFIRMED: { label: "подтверждена", color: C.muted },
  // Two-lanes: an arrived booking waits on the schedule axis, not in the
  // live queue — the label says so.
  WAITING: { label: "пришёл", color: AMBER },
  IN_PROGRESS: { label: "на приёме", color: GREEN },
  COMPLETED: { label: "завершён", color: FAINT },
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

  // Nothing on the board has second granularity (clock renders HH:mm, lanes
  // split on minutes) — tick every second but only commit state when the
  // minute flips, so signage sticks aren't re-rendering the whole tree 60×/min.
  useEffect(() => {
    const id = setInterval(() => {
      setTime((prev) => {
        const next = new Date();
        return next.getHours() === prev.getHours() &&
          next.getMinutes() === prev.getMinutes()
          ? prev
          : next;
      });
    }, 1000);
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

  // The route returns slots ordered by (date, time) — no client re-sort.
  const slots = data?.slots;
  const { pastSlots, upcomingSlots } = useMemo(() => {
    const past: DoctorBoardSlot[] = [];
    const upcoming: DoctorBoardSlot[] = [];
    for (const s of slots ?? []) {
      (slotMinutes(s.time) < nowMinutes ? past : upcoming).push(s);
    }
    return { pastSlots: past, upcomingSlots: upcoming };
  }, [slots, nowMinutes]);
  const doneCount = useMemo(
    () => (slots ?? []).filter((s) => s.status === "COMPLETED").length,
    [slots],
  );
  const slotCount = slots?.length ?? 0;

  if (notFound) {
    return (
      <Page>
        <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center">
          <p className="text-5xl font-bold">Экран не найден</p>
          <p className="text-2xl" style={{ color: C.muted }}>
            Ссылка недействительна или врач деактивирован
          </p>
        </div>
      </Page>
    );
  }

  // Activation splash — a tap resumes AudioContext so the chime can play.
  if (!activated) {
    return (
      <Page>
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
              className="mb-10 flex h-36 w-36 items-center justify-center text-7xl font-bold"
              style={{
                background: accent,
                color: "#fff",
                borderRadius: TILE_RADIUS,
              }}
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
          <p className="mt-16 text-xl" style={{ color: FAINT }}>
            Нажмите на экран для запуска
          </p>
        </div>
      </Page>
    );
  }

  const timeStr = time.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = time.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
  const weekday = time.toLocaleDateString("ru-RU", { weekday: "long" });

  return (
    <Page>
      {overlay && (
        <CallTakeover
          cabinet={overlay.cabinet}
          patientName={overlay.patientName}
          ticketNumber={overlay.ticketNumber}
          className="board-in"
        />
      )}

      <div className="flex h-full flex-col gap-4 p-5">
        {/* ── Header tile: cabinet plate · doctor · clock ────────────── */}
        <Tile className="shrink-0">
          <div className="flex items-center gap-6 px-7 py-5">
            {data?.doctor.cabinet && (
              <div
                className="flex h-24 w-24 shrink-0 flex-col items-center justify-center"
                style={{
                  background: accent,
                  color: "#fff",
                  borderRadius: TILE_RADIUS - 8,
                }}
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
              <p className="truncate text-4xl font-bold leading-tight">
                {data?.doctor.nameRu ?? "…"}
              </p>
              <p className="mt-1.5 truncate text-2xl" style={{ color: C.muted }}>
                {data?.doctor.specializationRu || "Врач"}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-6xl font-bold tabular-nums leading-none">
                {timeStr}
              </p>
              <p className="mt-1.5 text-xl capitalize" style={{ color: C.muted }}>
                <span
                  className="mr-2.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ background: connected ? GREEN : AMBER }}
                />
                {weekday}, {dateStr}
              </p>
            </div>
          </div>
        </Tile>

        {/* ── Now serving tile — the loudest thing on the board ─────── */}
        <Tile
          className="shrink-0"
          style={data?.queue.current ? { background: GREEN_TINT } : undefined}
        >
          <div className="flex items-center justify-between gap-6 px-7 py-6">
            <div className="min-w-0">
              <p
                className="text-xl font-semibold uppercase tracking-wide"
                style={{ color: data?.queue.current ? GREEN : FAINT }}
              >
                Сейчас принимается
              </p>
              <p
                className="mt-1 truncate text-6xl font-bold leading-tight"
                style={{ color: data?.queue.current ? C.fg : FAINT }}
              >
                {data?.queue.current
                  ? data.queue.current.fullName
                  : "Кабинет свободен"}
              </p>
            </div>
            {data?.queue.current?.ticketNumber && (
              <div
                className="flex shrink-0 items-center px-6 py-3"
                style={{
                  background: "#D3F1E2",
                  borderRadius: TILE_RADIUS - 8,
                }}
              >
                <span
                  className="font-mono text-6xl font-bold tabular-nums"
                  style={{ color: GREEN }}
                >
                  {data.queue.current.ticketNumber}
                </span>
              </div>
            )}
          </div>
        </Tile>

        {/* ── Two lane tiles: queue LEFT, bookings RIGHT — always ───── */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
          {/* LEFT — live queue */}
          <Tile className="flex min-h-0 flex-col">
            <TileHead
              title="Живая очередь"
              value={data ? String(data.queue.waiting.length) : "…"}
              color={AMBER}
            />
            <div className="min-h-0 flex-1 overflow-hidden px-6 pb-4">
              {!data || data.queue.waiting.length === 0 ? (
                <p className="py-8 text-2xl" style={{ color: FAINT }}>
                  {data ? "Очередь пуста" : "Загрузка…"}
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.queue.waiting.slice(0, MAX_WAITING_ROWS).map((w, i) => (
                    <div
                      key={w.id}
                      className="flex items-center gap-4 px-4 py-3"
                      style={{
                        background: i === 0 ? C.inset : "transparent",
                        borderRadius: TILE_RADIUS - 10,
                      }}
                    >
                      <span
                        className="shrink-0 font-mono text-4xl font-bold tabular-nums"
                        style={{ color: i === 0 ? AMBER : C.fg, minWidth: 108 }}
                      >
                        {w.ticketNumber}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-2xl"
                        style={{ color: i === 0 ? C.fg : C.muted }}
                      >
                        {w.fullName}
                      </span>
                      <span
                        className="shrink-0 text-xl tabular-nums"
                        style={{ color: FAINT }}
                      >
                        ~{w.etaMinutes}м
                      </span>
                    </div>
                  ))}
                  {data.queue.waiting.length > MAX_WAITING_ROWS && (
                    <p className="px-4 py-1 text-xl" style={{ color: FAINT }}>
                      ещё {data.queue.waiting.length - MAX_WAITING_ROWS}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Tile>

          {/* RIGHT — today's bookings */}
          <Tile className="flex min-h-0 flex-col">
            <TileHead
              title="Записи"
              value={data ? `${doneCount}/${slotCount}` : "…"}
              color={C.muted}
            />
            <div className="min-h-0 flex-1 overflow-hidden px-6 pb-4">
              {!data || slotCount === 0 ? (
                <p className="py-8 text-2xl" style={{ color: FAINT }}>
                  {data ? "На сегодня записей нет" : "Загрузка…"}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {pastSlots.length > MAX_PAST_COMPACT && (
                    <p className="px-4 py-1 text-lg" style={{ color: FAINT }}>
                      раньше: {pastSlots.length - MAX_PAST_COMPACT}
                    </p>
                  )}
                  {pastSlots.slice(-MAX_PAST_COMPACT).map((s) => (
                    <SlotRow key={s.id} slot={s} compact />
                  ))}

                  {/* Now rule */}
                  <div className="flex items-center gap-3 px-1 py-1.5">
                    <span
                      className="h-[3px] flex-1"
                      style={{ background: accent, borderRadius: 2 }}
                    />
                    <span
                      className="shrink-0 font-mono text-lg font-bold tabular-nums"
                      style={{ color: accent }}
                    >
                      {timeStr}
                    </span>
                  </div>

                  {upcomingSlots.slice(0, MAX_UPCOMING_ROWS).map((s, i) => (
                    <SlotRow key={s.id} slot={s} next={i === 0} />
                  ))}
                  {upcomingSlots.length > MAX_UPCOMING_ROWS && (
                    <p className="px-4 py-1 text-xl" style={{ color: FAINT }}>
                      ещё {upcomingSlots.length - MAX_UPCOMING_ROWS}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Tile>
        </div>

        {/* ── Quiet footer ───────────────────────────────────────────── */}
        <p className="shrink-0 px-2 text-lg" style={{ color: FAINT }}>
          {data?.clinic.nameRu ?? ""}
        </p>
      </div>
    </Page>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-screen overflow-hidden"
      style={{ background: C.page, color: C.fg }}
    >
      {children}
      <style>{`
        @keyframes board-in { from { opacity: 0; } to { opacity: 1; } }
        .board-in { animation: board-in 0.25s ease-out; }
      `}</style>
    </div>
  );
}

/** Bento tile: solid surface one step above the page, real corner radius. */
function Tile({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        background: C.tile,
        borderRadius: TILE_RADIUS,
        border: `1px solid ${C.line}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function TileHead({
  title,
  value,
  color,
}: {
  title: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-baseline justify-between px-6 pt-5 pb-3">
      <h2
        className="text-xl font-semibold uppercase tracking-wide"
        style={{ color: C.muted }}
      >
        {title}
      </h2>
      <span
        className="font-mono text-3xl font-bold tabular-nums"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

function SlotRow({
  slot,
  compact = false,
  next = false,
}: {
  slot: DoctorBoardSlot;
  compact?: boolean;
  next?: boolean;
}) {
  const meta = SLOT_META[slot.status];
  if (compact) {
    return (
      <div className="flex items-center gap-4 px-4 py-1.5" style={{ opacity: 0.4 }}>
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
      className="flex items-center gap-4 px-4 py-2.5"
      style={{
        background: next ? C.inset : "transparent",
        borderRadius: TILE_RADIUS - 10,
      }}
    >
      <span className="w-24 shrink-0 font-mono text-3xl font-bold tabular-nums">
        {slot.time ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate text-2xl">{slot.fullName}</span>
      <span
        className="shrink-0 text-xl font-semibold"
        style={{ color: meta.color }}
      >
        {meta.label}
      </span>
    </div>
  );
}

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

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { useParams } from "next/navigation";

import {
  useDoctorBoard,
  type DoctorBoardSlot,
} from "@/hooks/use-doctor-board";
import { resolveCallDisplay } from "@/lib/queue-call";
import { tashkentPartsOf } from "@/lib/tashkent-time";
import {
  CallTakeover,
  announce,
  playChime,
  useAudioUnlock,
} from "../../_shared";
import { Bi, useTvTranslators } from "../../_i18n";

// ─── Tunables (visual iteration knobs) ──────────────────────────────────────
const OVERLAY_MS = 15_000; // call takeover auto-dismiss
const PAGE_MS = 8_000; // a long list shows its next page this often
const MAX_PAST_COMPACT = 2; // finished bookings kept above the now-line
const TILE_RADIUS = "1.5rem"; // bento tile corner radius
const INNER_RADIUS = "1rem"; // plates and highlighted rows inside a tile
// The whole board is sized in rem and the rem follows the screen: 16px on a
// 1920×1080 (or 1080×1920) screen, 8px on the TV box's 960×540. Fixed pixel
// sizes left the clinic's TCL 32" with the header and «Сейчас принимается»
// filling the screen and the queue cut off (owner report 08.10.2026).
const REM = "clamp(6px, min(100vh, 100vw) / 67.5, 40px)";
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

// Labels live in `tvBoard.doctorBoard.slot.<STATUS>` (both languages).
const SLOT_META: Record<DoctorBoardSlot["status"], { color: string }> = {
  BOOKED: { color: C.muted },
  CONFIRMED: { color: C.muted },
  // Two-lanes: an arrived booking waits on the schedule axis, not in the
  // live queue — the label says so.
  WAITING: { color: AMBER },
  IN_PROGRESS: { color: GREEN },
  COMPLETED: { color: FAINT },
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
  const tv = useTvTranslators();

  // Board renders immediately; sound arms itself on the first stray
  // interaction (one remote press on a TV box) instead of gating the queue
  // behind a splash screen.
  useAudioUnlock();

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
  // The name comes from the event, not from `current` of the snapshot: at
  // this instant the snapshot may still hold the patient who just left
  // (audit Q-10, see resolveCallDisplay).
  useEffect(() => {
    if (!call || call.seq === lastCallSeq.current) return;
    lastCallSeq.current = call.seq;
    const shown = resolveCallDisplay(
      call,
      [data?.queue.current, ...(data?.queue.waiting ?? [])],
      data?.doctor.cabinet,
    );
    playChime();
    announce(shown.patientName, shown.cabinet, shown.ticketNumber, {
      translators: tv,
      lang: call.lang,
    });
  }, [call, data, tv]);

  // Auto-dismiss the call board after OVERLAY_MS (async setState — allowed).
  useEffect(() => {
    if (!call) return;
    const t = setTimeout(() => setDismissedSeq(call.seq), OVERLAY_MS);
    return () => clearTimeout(t);
  }, [call]);

  const overlay: Overlay | null =
    call && call.seq !== dismissedSeq
      ? resolveCallDisplay(
          call,
          [data?.queue.current, ...(data?.queue.waiting ?? [])],
          data?.doctor.cabinet,
        )
      : null;

  const accent = data?.doctor.color || "#2353FF";
  // The TV box's own time zone is whatever the installer left on it; the
  // board and its now-line follow the clinic's wall clock (Asia/Tashkent).
  const clock = tashkentPartsOf(time);
  const nowMinutes = clock.hours * 60 + clock.minutes;

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
  const queuePager = usePagedRows(data?.queue.waiting ?? []);
  const upcomingPager = usePagedRows(upcomingSlots);
  const doneCount = useMemo(
    () => (slots ?? []).filter((s) => s.status === "COMPLETED").length,
    [slots],
  );
  const slotCount = slots?.length ?? 0;

  if (notFound) {
    return (
      <Page>
        <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center">
          <p className="text-5xl font-bold">
            <Bi k="doctorBoard.notFound" stacked uzClassName="mt-2 text-4xl" />
          </p>
          <p className="text-2xl" style={{ color: C.muted }}>
            <Bi k="doctorBoard.notFoundHint" stacked uzClassName="mt-1" />
          </p>
        </div>
      </Page>
    );
  }

  const timeStr = time.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  });
  const dateStr = time.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Tashkent",
  });
  const weekday = time.toLocaleDateString("ru-RU", {
    weekday: "long",
    timeZone: "Asia/Tashkent",
  });

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

      <div className="flex h-full flex-col gap-3 p-4">
        {/* ── Header tile: cabinet plate · doctor · clock ────────────── */}
        <Tile className="shrink-0">
          <div className="flex items-center gap-6 px-7 py-4">
            {data?.doctor.cabinet && (
              <div
                className="flex h-20 w-20 shrink-0 flex-col items-center justify-center"
                style={{
                  background: accent,
                  color: "#fff",
                  borderRadius: INNER_RADIUS,
                }}
              >
                <span className="text-center text-[0.625rem] font-semibold uppercase leading-tight tracking-wider opacity-80">
                  <Bi k="doctorBoard.cabinet" stacked />
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
                {data?.doctor.specializationRu || <Bi k="doctor" />}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-5xl font-bold tabular-nums leading-none">
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

        {/* ── Now serving: one compact band (owner 08.10.2026: it took
            half the screen and pushed the queue off the TV). ─────────── */}
        <Tile
          className="shrink-0"
          style={data?.queue.current ? { background: GREEN_TINT } : undefined}
        >
          <div className="flex items-center justify-between gap-6 px-7 py-3.5">
            <div className="min-w-0">
              <p
                className="text-base font-semibold uppercase tracking-wide"
                style={{ color: data?.queue.current ? GREEN : FAINT }}
              >
                <Bi k="doctorBoard.nowReceiving" />
              </p>
              <p
                className="mt-0.5 truncate text-4xl font-bold leading-tight"
                style={{ color: data?.queue.current ? C.fg : FAINT }}
              >
                {data?.queue.current ? (
                  data.queue.current.fullName
                ) : (
                  <Bi k="doctorBoard.cabinetFree" />
                )}
              </p>
            </div>
            {data?.queue.current?.ticketNumber && (
              <div
                className="flex shrink-0 items-center px-5 py-2"
                style={{
                  background: "#D3F1E2",
                  borderRadius: INNER_RADIUS,
                }}
              >
                <span
                  className="font-mono text-5xl font-bold tabular-nums"
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
          {/* LEFT — live queue. As many rows as fit; a longer queue
              turns its pages every PAGE_MS so everyone finds their number. */}
          <Tile className="flex min-h-0 flex-col">
            <TileHead
              title={<Bi k="doctorBoard.liveQueue" stacked uzClassName="text-base" />}
              value={data ? String(data.queue.waiting.length) : "…"}
              color={AMBER}
              page={queuePager.page}
              pages={queuePager.pages}
            />
            <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
              {!data || data.queue.waiting.length === 0 ? (
                <p className="py-8 text-2xl" style={{ color: FAINT }}>
                  <Bi
                    k={data ? "doctorBoard.queueEmpty" : "doctorBoard.loading"}
                    stacked
                    uzClassName="mt-1 text-xl"
                  />
                </p>
              ) : (
                <div
                  ref={queuePager.boxRef}
                  key={queuePager.page}
                  className="board-in flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
                >
                  {queuePager.rows.map((w, i) => {
                    const first = queuePager.offset + i === 0;
                    return (
                      <div
                        key={w.id}
                        data-row
                        className="flex shrink-0 items-center gap-4 px-4 py-2.5"
                        style={{
                          background: first ? C.inset : "transparent",
                          borderRadius: INNER_RADIUS,
                        }}
                      >
                        <span
                          className="shrink-0 font-mono text-4xl font-bold tabular-nums"
                          style={{ color: first ? AMBER : C.fg, minWidth: "6.75rem" }}
                        >
                          {w.ticketNumber}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-2xl"
                          style={{ color: first ? C.fg : C.muted }}
                        >
                          {w.fullName}
                        </span>
                        <span
                          className="shrink-0 text-xl tabular-nums"
                          style={{ color: FAINT }}
                        >
                          <Bi
                            k="doctorBoard.etaShort"
                            values={{ minutes: String(w.etaMinutes) }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Tile>

          {/* RIGHT — today's bookings */}
          <Tile className="flex min-h-0 flex-col">
            <TileHead
              title={<Bi k="doctorBoard.bookings" stacked uzClassName="text-base" />}
              value={data ? `${doneCount}/${slotCount}` : "…"}
              color={C.muted}
              page={upcomingPager.page}
              pages={upcomingPager.pages}
            />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-4">
              {!data || slotCount === 0 ? (
                <p className="py-8 text-2xl" style={{ color: FAINT }}>
                  <Bi
                    k={data ? "doctorBoard.noBookings" : "doctorBoard.loading"}
                    stacked
                    uzClassName="mt-1 text-xl"
                  />
                </p>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  {pastSlots.length > MAX_PAST_COMPACT && (
                    <p className="px-4 py-1 text-lg" style={{ color: FAINT }}>
                      <Bi
                        k="doctorBoard.earlier"
                        values={{
                          count: String(pastSlots.length - MAX_PAST_COMPACT),
                        }}
                      />
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

                  <div
                    ref={upcomingPager.boxRef}
                    key={upcomingPager.page}
                    className="board-in flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden"
                  >
                    {upcomingPager.rows.map((s, i) => (
                      <SlotRow
                        key={s.id}
                        slot={s}
                        next={upcomingPager.offset + i === 0}
                      />
                    ))}
                  </div>
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
        html { font-size: ${REM}; }
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
  page = 0,
  pages = 1,
}: {
  title: React.ReactNode;
  value: string;
  color: string;
  /** Which page of a long list is on screen: dots, one per page. */
  page?: number;
  pages?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 pt-4 pb-3">
      <h2
        className="text-xl font-semibold uppercase tracking-wide"
        style={{ color: C.muted }}
      >
        {title}
      </h2>
      <div className="flex shrink-0 items-center gap-4">
        {pages > 1 && (
          <div className="flex items-center gap-1.5" aria-hidden>
            {Array.from({ length: pages }, (_, i) => (
              <span
                key={i}
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: i === page ? "1.75rem" : "0.625rem",
                  background: i === page ? color : C.line,
                }}
              />
            ))}
          </div>
        )}
        <span
          className="font-mono text-3xl font-bold tabular-nums"
          style={{ color }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

/**
 * As many rows of a list as fit its box, and the next page every PAGE_MS
 * when they do not all fit. The box is the list's own flex-1 area; a row
 * (`data-row`) is measured once rendered, so the count follows the screen
 * and the board's rem.
 */
function usePagedRows<T>(items: readonly T[]) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [perPage, setPerPage] = useState(0);
  const [page, setPage] = useState(0);
  const count = items.length;

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || count === 0) return;
    const measure = () => {
      const row = box.querySelector<HTMLElement>("[data-row]");
      if (!row || box.clientHeight === 0) return;
      const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
      const fit = Math.floor((box.clientHeight + gap) / (row.offsetHeight + gap));
      setPerPage(Math.max(1, fit));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [count, page]);

  // Until measured, render everything once so a row exists to measure.
  const size = perPage > 0 ? perPage : Math.max(1, count);
  const pages = Math.max(1, Math.ceil(count / size));
  const current = page < pages ? page : 0;

  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS);
    return () => clearInterval(id);
  }, [pages]);

  const offset = current * size;
  return {
    boxRef,
    rows: items.slice(offset, offset + size),
    offset,
    page: current,
    pages,
  };
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
          {slot.status === "COMPLETED" ? (
            "✓"
          ) : (
            <Bi k={`doctorBoard.slot.${slot.status}`} />
          )}
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-4 px-4 py-2.5"
      style={{
        background: next ? C.inset : "transparent",
        borderRadius: INNER_RADIUS,
      }}
    >
      <span className="w-24 shrink-0 font-mono text-3xl font-bold tabular-nums">
        {slot.time ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate text-2xl">{slot.fullName}</span>
      <span
        className="shrink-0 text-right text-xl font-semibold leading-tight"
        style={{ color: meta.color }}
      >
        <Bi
          k={`doctorBoard.slot.${slot.status}`}
          stacked
          uzClassName="text-base font-normal"
        />
      </span>
    </div>
  );
}

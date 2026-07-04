/**
 * Variant C — single source of truth for the live queue.
 *
 * Before this module the TV board, the kiosk doctor list, and the patient
 * ticket each re-derived the queue independently: three sort comparators, three
 * ETA formulas, two per-visit sources (doctor-wide median vs. service-filtered),
 * and a position counter that ignored `queuePriority`. They drifted — a patient
 * urgency-bumped on the board could still show "you're 5th" on their phone.
 *
 * `getQueueProjection` computes the queue ONCE per (clinic, doctor set) and
 * every surface reads the same projection. The canonical rules live here and
 * nowhere else:
 *
 *   - lanes:     waiting = LIVE lane only (walk-ins, `isLiveLane`) — bookings
 *                never enter the queue order, no matter when they checked in
 *                (docs/TZ-two-lanes.md); `current` may come from either lane
 *   - ordering:  queuePriority DESC, then queuedAt ASC (FIFO), then ticketSeq
 *                ASC — the shared `compareQueue` (see `lib/queue-ordering`)
 *   - position:  1-based index within the sorted WAITING list
 *   - ETA:       perVisitMin * (idx + (current ? 1 : 0))   — minutes until seen
 *   - perVisit:  doctor-wide historical median (predictPerVisitMinutes),
 *                falling back per doctor to the next-waiting booked duration
 *   - ticket:    ticketNumberFor(doctorId, ticketSeq ?? queueOrder)
 *                (ticketSeq is immutable, so reorders never churn ticket codes;
 *                null for `current` when a booking was started without
 *                check-in — waiting rows are live-lane and always own a seq)
 */
import { prisma } from "@/lib/prisma";
import { predictPerVisitMinutes } from "@/server/ai/per-visit-eta";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { compareQueue, isLiveLane } from "@/lib/queue-ordering";
import type { EtaOutput } from "@/lib/ai/eta-predictor";

export interface QueueEntry {
  appointmentId: string;
  /** Raw full name — the caller decides whether to reduce to initials. */
  patientFullName: string;
  queueOrder: number | null;
  ticketSeq: number | null;
  ticketNumber: string;
  durationMin: number;
  /** 1-based position within the doctor's WAITING list. */
  position: number;
  /** Minutes until this patient is seen. */
  etaMinutes: number;
}

export interface DoctorQueue {
  doctorId: string;
  perVisitMin: number;
  etaConfidence: EtaOutput["confidence"];
  etaSource: EtaOutput["source"];
  current: {
    appointmentId: string;
    patientFullName: string;
    queueOrder: number | null;
    ticketSeq: number | null;
    /** Null when a booked patient was started without check-in (no seq). */
    ticketNumber: string | null;
    startedAt: Date | null;
  } | null;
  waiting: QueueEntry[];
}

export async function getQueueProjection(opts: {
  clinicId: string;
  doctorIds: string[];
  at?: Date;
}): Promise<Map<string, DoctorQueue>> {
  const { clinicId, doctorIds, at = new Date() } = opts;
  const out = new Map<string, DoctorQueue>();
  if (doctorIds.length === 0) return out;

  const { dayStart, dayEnd } = tashkentDayBounds(at);

  const appts = await prisma.appointment.findMany({
    where: {
      clinicId,
      doctorId: { in: doctorIds },
      date: { gte: dayStart, lt: dayEnd },
      queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
    },
    select: {
      id: true,
      doctorId: true,
      queueStatus: true,
      queueOrder: true,
      queuePriority: true,
      ticketSeq: true,
      channel: true,
      date: true,
      queuedAt: true,
      startedAt: true,
      durationMin: true,
      patient: { select: { fullName: true } },
    },
  });

  type Appt = (typeof appts)[number];
  const byDoctor = new Map<string, Appt[]>();
  for (const a of appts) {
    const bucket = byDoctor.get(a.doctorId);
    if (bucket) bucket.push(a);
    else byDoctor.set(a.doctorId, [a]);
  }

  // Sort each doctor's waiting list once, then derive both the per-doctor ETA
  // fallback (next-waiting booked duration — sharper than a flat 30 when a
  // doctor has no completed-visit history) and the final output from it.
  const waitingByDoc = new Map<string, Appt[]>();
  const currentByDoc = new Map<string, Appt | undefined>();
  const fallbackByDoc = new Map<string, number>();
  for (const id of doctorIds) {
    const own = byDoctor.get(id) ?? [];
    // Two-lanes: the queue is walk-ins only. An arrived booking (WAITING,
    // channel ≠ WALKIN) stays in the schedule lane — it holds a ticket as an
    // identifier but takes no position here. `current` below is lane-agnostic:
    // the doctor may be seeing either a walk-in or a booked patient.
    const waitingSorted = own
      .filter((a) => a.queueStatus === "WAITING" && isLiveLane(a))
      .sort(compareQueue);
    waitingByDoc.set(id, waitingSorted);
    currentByDoc.set(id, own.find((a) => a.queueStatus === "IN_PROGRESS"));
    if (waitingSorted[0]) fallbackByDoc.set(id, waitingSorted[0].durationMin);
  }

  const perVisitByDoc = await predictPerVisitMinutes(doctorIds, fallbackByDoc);

  for (const id of doctorIds) {
    const eta = perVisitByDoc.get(id);
    const perVisitMin = eta?.etaMin ?? 30;

    const inProgress = currentByDoc.get(id);
    const hasCurrent = !!inProgress;
    const waitingSorted = waitingByDoc.get(id) ?? [];

    out.set(id, {
      doctorId: id,
      perVisitMin,
      etaConfidence: eta?.confidence ?? "low",
      etaSource: eta?.source ?? "fallback",
      current: inProgress
        ? {
            appointmentId: inProgress.id,
            patientFullName: inProgress.patient.fullName,
            queueOrder: inProgress.queueOrder,
            ticketSeq: inProgress.ticketSeq,
            ticketNumber: ticketNumberFor(
              id,
              inProgress.ticketSeq ?? inProgress.queueOrder,
            ),
            startedAt: inProgress.startedAt,
          }
        : null,
      waiting: waitingSorted.map((w, idx) => ({
        appointmentId: w.id,
        patientFullName: w.patient.fullName,
        queueOrder: w.queueOrder,
        ticketSeq: w.ticketSeq,
        // Live-lane WAITING rows are minted with ticketSeq at creation
        // (registerWalkin), so the ticket is always printable here.
        ticketNumber: ticketNumberFor(id, w.ticketSeq ?? w.queueOrder)!,
        durationMin: w.durationMin,
        position: idx + 1,
        etaMinutes: perVisitMin * (idx + (hasCurrent ? 1 : 0)),
      })),
    });
  }

  return out;
}

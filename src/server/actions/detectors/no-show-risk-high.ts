/**
 * Detector: NO_SHOW_RISK_HIGH.
 *
 * Iterates BOOKED appointments inside the next `noShowLookaheadHours` hours,
 * runs the pure `computeNoShowRisk()` heuristic on each, and emits one action
 * per appointment whose risk meets the configured threshold.
 *
 * Two gates keep the list about real risk (audit AC-07):
 *   - a patient already in the clinic (WAITING / IN_PROGRESS) is not a
 *     no-show risk. WAITING used to be scanned, so a patient who came early
 *     and sat in the hall was offered to reception as a call;
 *   - the patient needs a history of their own (`noShowMinHistoryVisits`).
 *     With none the score is the smoothing prior 0.5 plus the first-visit
 *     bump 0.1, which is exactly the 0.6 threshold, so every new patient
 *     read as «высокий риск 60%» and drowned the ones who really miss
 *     visits. A new patient who has not confirmed is UNCONFIRMED_24H's job.
 *
 * Severity:
 *   - `high` when risk >= 0.8
 *   - `medium` otherwise
 *
 * `risk` is rounded to 2 decimals before being placed in the payload. This
 * is critical: without rounding, recompute passes would churn `updatedAt`
 * (and audit rows) on every floating-point twitch since the no-show formula
 * mixes Laplace smoothing + visit count denominators.
 *
 * `expiresAt` is the appointment time itself — once the visit happens, the
 * action is irrelevant whether it was acted on or not.
 */
import type { ActionSeverity, NoShowRiskHighPayload } from "@/lib/actions/types";
import { computeNoShowRisk } from "@/lib/ai/no-show-risk";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addHours, round } from "./_shared";

type ApptRow = {
  id: string;
  date: Date;
  patientId: string;
  status: string;
  createdAt: Date;
  patient: {
    id: string;
    fullName: string;
  };
  appointmentReminders?: unknown;
};

export type NoShowRiskHighResult = {
  payload: NoShowRiskHighPayload;
  appointmentAt: Date;
};

export async function detectNoShowRiskHigh(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<NoShowRiskHighPayload[]> {
  const horizon = addHours(now, config.noShowLookaheadHours);

  const appts = (await prisma.appointment.findMany({
    where: {
      // CONFIRMED stays out as before; WAITING / IN_PROGRESS are in the
      // clinic already.
      status: "BOOKED",
      date: { gte: now, lte: horizon },
    },
    select: {
      id: true,
      date: true,
      patientId: true,
      status: true,
      createdAt: true,
      patient: { select: { id: true, fullName: true } },
    },
  })) as ApptRow[];
  if (appts.length === 0) return [];

  const patientIds = Array.from(new Set(appts.map((a) => a.patientId)));

  // Visit history per patient: total non-cancelled visits + no-shows.
  const history = (await prisma.appointment.findMany({
    where: { patientId: { in: patientIds }, status: { in: ["COMPLETED", "NO_SHOW"] } },
    select: { patientId: true, status: true },
  })) as Array<{ patientId: string; status: string }>;
  const counts = new Map<string, { total: number; noShows: number }>();
  for (const h of history) {
    const cur = counts.get(h.patientId) ?? { total: 0, noShows: 0 };
    cur.total += 1;
    if (h.status === "NO_SHOW") cur.noShows += 1;
    counts.set(h.patientId, cur);
  }

  // Reminders per appointment — used to detect "unconfirmed reminder".
  const reminders = (await prisma.notificationSend.findMany({
    where: {
      appointmentId: { in: appts.map((a) => a.id) },
      status: { in: ["QUEUED", "SENT", "DELIVERED"] },
    },
    select: { appointmentId: true, status: true, readAt: true },
  })) as Array<{
    appointmentId: string | null;
    status: string;
    readAt: Date | null;
  }>;
  const remindedSet = new Set(reminders.map((r) => r.appointmentId).filter(Boolean));

  const out: NoShowRiskHighPayload[] = [];
  for (const a of appts) {
    const pc = counts.get(a.patientId) ?? { total: 0, noShows: 0 };
    const hoursToAppointment =
      (a.date.getTime() - now.getTime()) / (60 * 60 * 1000);
    const isFirstVisit = pc.total === 0;
    // "Unconfirmed reminder" — we have a reminder out but the patient hasn't
    // confirmed (no confirmedAt column). Best-effort proxy: a reminder exists
    // but the patient hasn't transitioned status to WAITING.
    const hasUnconfirmedReminder =
      remindedSet.has(a.id) && a.status === "BOOKED";
    if (pc.total < config.noShowMinHistoryVisits) continue;
    const { risk } = computeNoShowRisk({
      totalVisits: pc.total,
      noShows: pc.noShows,
      hasUnconfirmedReminder,
      hoursToAppointment,
      isFirstVisit,
    });
    if (risk < config.noShowRiskThreshold) continue;
    out.push({
      type: "NO_SHOW_RISK_HIGH",
      appointmentId: a.id,
      patientId: a.patientId,
      patientName: a.patient.fullName,
      risk: round(risk, 2),
      appointmentAt: a.date.toISOString(),
    });
  }
  return out;
}

export function severityForNoShowRisk(
  payload: NoShowRiskHighPayload,
): ActionSeverity {
  if (payload.risk >= 0.8) return "high";
  return "medium";
}

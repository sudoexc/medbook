/**
 * Phase 10 — No-show risk (pure, client-safe).
 *
 * Laplace-smoothed historical no-show rate plus light situational bumps:
 *
 *   base    = (noShows + 1) / (totalVisits + 2)        (alpha=1)
 *   +0.10   if isFirstVisit
 *   +0.10   if hasUnconfirmedReminder AND hoursToAppointment < 24
 *   +0.05   if hoursToAppointment > 168 (booked far ahead → drift risk)
 *   clamp   [0, 1]
 *
 * Banding:
 *   < 0.15  → "low"
 *   < 0.35  → "med"
 *   else    → "high"
 *
 * Pure: zero imports. Used by `computeQueueScore` (penalty), the patient card
 * dashboard, and the reminders worker.
 */

export interface NoShowInput {
  totalVisits: number;
  noShows: number;
  hasUnconfirmedReminder: boolean;
  hoursToAppointment: number;
  isFirstVisit: boolean;
}

export interface NoShowOutput {
  risk: number;
  band: "low" | "med" | "high";
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function bandOf(risk: number): NoShowOutput["band"] {
  if (risk < 0.15) return "low";
  if (risk < 0.35) return "med";
  return "high";
}

export function computeNoShowRisk(input: NoShowInput): NoShowOutput {
  const total = Math.max(0, input.totalVisits);
  const ns = Math.max(0, Math.min(input.noShows, total));
  let risk = (ns + 1) / (total + 2);

  if (input.isFirstVisit) risk += 0.1;
  if (input.hasUnconfirmedReminder && input.hoursToAppointment < 24) {
    risk += 0.1;
  }
  if (input.hoursToAppointment > 168) risk += 0.05;

  const clamped = clamp01(risk);
  return { risk: clamped, band: bandOf(clamped) };
}

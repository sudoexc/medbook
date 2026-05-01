/**
 * Phase 10 — Queue priority score (pure, client-safe).
 *
 * Computes a heuristic score for a single appointment in today's queue. The
 * receptionist UI ranks `WAITING` appointments by this score so the next call
 * is always the highest-priority patient given current wait, urgency, VIP
 * status, no-show risk, lateness, and overdue flags.
 *
 * The function is intentionally pure — zero imports — so it can run on the
 * server (resolver) and the client (optimistic re-rank) without dragging in
 * Prisma, auth, or env. All inputs are caller-supplied primitives.
 */

export interface QueueScoreInput {
  /** Minutes elapsed since the patient was either called or scheduled. */
  waitMin: number;
  /** Coarse 0..3 urgency band — derived from service code by the resolver. */
  urgencyLevel: 0 | 1 | 2 | 3;
  /** True when `Patient.segment === "VIP"`. */
  isVip: boolean;
  /** No-show risk in [0, 1] — penalty applied for high-risk patients. */
  noShowRisk: number;
  /** True when the patient checked in past their scheduled time. */
  isLate: boolean;
  /** True when the patient has an overdue follow-up boost. */
  hasOverdue: boolean;
}

export interface QueueScoreOutput {
  score: number;
  components: {
    wait: number;
    urgency: number;
    vip: number;
    noShowPenalty: number;
    latePenalty: number;
    overdueBoost: number;
  };
  band: "low" | "normal" | "high" | "critical";
}

function clampNonNeg(n: number): number {
  return n < 0 ? 0 : n;
}

function bandOf(score: number): QueueScoreOutput["band"] {
  if (score < 30) return "low";
  if (score < 70) return "normal";
  if (score < 120) return "high";
  return "critical";
}

export function computeQueueScore(input: QueueScoreInput): QueueScoreOutput {
  const wait = input.waitMin * 1.0;
  const urgency = input.urgencyLevel * 25;
  const vip = input.isVip ? 30 : 0;
  // Normalize `-0` (from `0 * -20`) to `+0` so deep-equality consumers see a
  // canonical zero.
  const noShowPenaltyRaw = input.noShowRisk * -20;
  const noShowPenalty = noShowPenaltyRaw === 0 ? 0 : noShowPenaltyRaw;
  const latePenalty = input.isLate ? 15 : 0;
  const overdueBoost = input.hasOverdue ? 10 : 0;

  const raw = wait + urgency + vip + noShowPenalty + latePenalty + overdueBoost;
  const score = clampNonNeg(raw);

  return {
    score,
    components: {
      wait,
      urgency,
      vip,
      noShowPenalty,
      latePenalty,
      overdueBoost,
    },
    band: bandOf(score),
  };
}

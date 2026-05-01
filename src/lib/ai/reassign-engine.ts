/**
 * Phase 10 — Reassignment engine (pure, client-safe).
 *
 * Given today's per-doctor load + a list of currently waiting appointments,
 * suggest re-routes to the lightest eligible doctor when the source doctor is
 * overdue. Triggers:
 *
 *   - delayMin >= 20                                → "overdue"
 *   - delayMin >= 15 AND waiting waitMin >= 10      → "overloaded"
 *
 * Eligibility: candidate doctor must be in `waiting.eligibleDoctorIds` (which
 * the resolver derives from the `ServiceOnDoctor` join), must have
 * `capacityRemainingMin >= 30`, and is picked by lowest `remainingTodayMin`.
 *
 * Pure module: zero imports. The reason taxonomy is stable so the UI can
 * localize without inspecting score components.
 */

export interface DoctorLoad {
  doctorId: string;
  /** Minutes the doctor is currently running behind schedule. */
  delayMin: number;
  /** Minutes of work still booked for the rest of today. */
  remainingTodayMin: number;
  /** Minutes of free capacity left in today's schedule. */
  capacityRemainingMin: number;
}

export interface ReassignCandidate {
  appointmentId: string;
  fromDoctorId: string;
  toDoctorId: string;
  reason: "overdue" | "absent" | "overloaded";
  estDelaySaved: number;
}

export interface ReassignInput {
  loads: DoctorLoad[];
  waiting: Array<{
    appointmentId: string;
    doctorId: string;
    serviceId: string;
    waitMin: number;
    eligibleDoctorIds: string[];
  }>;
}

const TRIGGER_OVERDUE_DELAY = 20;
const TRIGGER_OVERLOAD_DELAY = 15;
const TRIGGER_OVERLOAD_WAIT = 10;
const MIN_CAPACITY = 30;

function indexLoads(loads: DoctorLoad[]): Map<string, DoctorLoad> {
  const m = new Map<string, DoctorLoad>();
  for (const l of loads) m.set(l.doctorId, l);
  return m;
}

function pickLightest(
  candidateIds: string[],
  loadIdx: Map<string, DoctorLoad>,
  excludeId: string,
): DoctorLoad | null {
  let best: DoctorLoad | null = null;
  for (const id of candidateIds) {
    if (id === excludeId) continue;
    const load = loadIdx.get(id);
    if (!load) continue;
    if (load.capacityRemainingMin < MIN_CAPACITY) continue;
    if (!best || load.remainingTodayMin < best.remainingTodayMin) {
      best = load;
    }
  }
  return best;
}

export function suggestReassignments(input: ReassignInput): ReassignCandidate[] {
  const loadIdx = indexLoads(input.loads);
  const out: ReassignCandidate[] = [];

  for (const w of input.waiting) {
    const src = loadIdx.get(w.doctorId);
    if (!src) continue;

    const triggerOverdue = src.delayMin >= TRIGGER_OVERDUE_DELAY;
    const triggerOverload =
      src.delayMin >= TRIGGER_OVERLOAD_DELAY && w.waitMin >= TRIGGER_OVERLOAD_WAIT;
    if (!triggerOverdue && !triggerOverload) continue;

    const target = pickLightest(w.eligibleDoctorIds, loadIdx, w.doctorId);
    if (!target) continue;

    out.push({
      appointmentId: w.appointmentId,
      fromDoctorId: w.doctorId,
      toDoctorId: target.doctorId,
      reason: triggerOverdue ? "overdue" : "overloaded",
      estDelaySaved: Math.max(0, src.delayMin - 5),
    });
  }

  return out;
}

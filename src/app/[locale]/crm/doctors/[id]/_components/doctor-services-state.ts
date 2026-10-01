/**
 * Pure state rules of the doctor services editor (audit DR-10), kept apart
 * from the component so they are unit-tested.
 *
 * Two bugs lived here. Save skipped a row whose duration was out of range
 * («3» typed for 30) and PUT replaces the whole set, so the service was
 * silently unlinked from the doctor under a «Сохранено» toast. And every
 * background refetch (window focus, stale time) copied the server state over
 * the admin's unsaved edits. Now an invalid row blocks Save and is pointed
 * at, and a refetch only replaces state the admin has not touched.
 */
import { sumToTiyin } from "@/lib/money-input";
import {
  DOCTOR_SERVICE_DURATION_MAX,
  DOCTOR_SERVICE_DURATION_MIN,
} from "@/lib/doctor-service-terms";

export type AssignmentState = {
  assigned: boolean;
  /** User-facing strings so empty input is distinguishable from 0. */
  priceInput: string;
  durationInput: string;
};

export type AssignmentPayload = {
  serviceId: string;
  priceOverride: number | null;
  durationMinOverride: number | null;
};

/** ServiceOnDoctor.priceOverride is a Postgres int4 in tiyin. */
const PRICE_MAX_TIYIN = 2_147_483_647;

const UNASSIGNED: AssignmentState = {
  assigned: false,
  priceInput: "",
  durationInput: "",
};

/** Same editor content? A missing row reads as unassigned; inputs of unassigned rows do not count. */
export function assignmentsEqual(
  a: Record<string, AssignmentState>,
  b: Record<string, AssignmentState>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k] ?? UNASSIGNED;
    const y = b[k] ?? UNASSIGNED;
    if (x.assigned !== y.assigned) return false;
    if (x.assigned) {
      if (x.priceInput !== y.priceInput) return false;
      if (x.durationInput !== y.durationInput) return false;
    }
  }
  return true;
}

/**
 * The server state changed (refetch, save). Adopt it unless the admin has
 * edits on top of the previous server state; those stay.
 *
 * `previousBaseline` is null until the editor has shown any server state:
 * the first sync always adopts. Passing the first render's baseline there
 * instead broke a remount over cached queries (review of DR-10): the editor
 * started empty, «empty» differed from the cached baseline, so it read as an
 * edit and stayed empty, and the next Save replaced the doctor's whole set
 * with whatever was ticked on top of nothing.
 */
export function adoptBaseline(
  current: Record<string, AssignmentState>,
  previousBaseline: Record<string, AssignmentState> | null,
  nextBaseline: Record<string, AssignmentState>,
): Record<string, AssignmentState> {
  if (previousBaseline === null) return nextBaseline;
  return assignmentsEqual(current, previousBaseline) ? nextBaseline : current;
}

export type RowProblem = { price?: true; duration?: true };

/** What is wrong with one ticked row, or null when it can be saved. */
export function rowProblem(s: AssignmentState): RowProblem | null {
  if (!s.assigned) return null;
  const problem: RowProblem = {};
  if (s.priceInput !== "") {
    const n = Number(s.priceInput);
    if (
      !/^\d+$/.test(s.priceInput) ||
      !Number.isFinite(n) ||
      sumToTiyin(n) > PRICE_MAX_TIYIN
    ) {
      problem.price = true;
    }
  }
  if (s.durationInput !== "") {
    const n = Number(s.durationInput);
    if (
      !/^\d+$/.test(s.durationInput) ||
      n < DOCTOR_SERVICE_DURATION_MIN ||
      n > DOCTOR_SERVICE_DURATION_MAX
    ) {
      problem.duration = true;
    }
  }
  return problem.price || problem.duration ? problem : null;
}

/**
 * The PUT body for the ticked rows, or the rows that block saving. Never
 * drops a ticked row: the PUT replaces the whole set, so a dropped row
 * would unlink the service.
 */
export function buildAssignments(
  state: Record<string, AssignmentState>,
):
  | { ok: true; assignments: AssignmentPayload[] }
  | { ok: false; invalid: Record<string, RowProblem> } {
  const invalid: Record<string, RowProblem> = {};
  const assignments: AssignmentPayload[] = [];
  for (const [serviceId, s] of Object.entries(state)) {
    if (!s.assigned) continue;
    const problem = rowProblem(s);
    if (problem) {
      invalid[serviceId] = problem;
      continue;
    }
    assignments.push({
      serviceId,
      // The input shows сумы; the override is stored in tiyin.
      priceOverride: s.priceInput === "" ? null : sumToTiyin(Number(s.priceInput)),
      durationMinOverride:
        s.durationInput === "" ? null : Number(s.durationInput),
    });
  }
  return Object.keys(invalid).length > 0
    ? { ok: false, invalid }
    : { ok: true, assignments };
}

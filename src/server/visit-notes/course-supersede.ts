/**
 * A later visit's prescription of a drug replaces the earlier course of the
 * same drug (doctor's request 10.10.2026, «Постоянно»).
 *
 * The medication bridge turns every signed prescription row into a
 * Prescription course that reminds the patient. A lifelong course
 * («постоянно», amlodipine for blood pressure) never ends, and the same drug
 * is written again at every control visit: without this, each visit added
 * one more never-ending course, and the patient got one 08:00 reminder per
 * visit for the same pill. A changed dose («1 таб.» then «¼ таб.») was worse:
 * both courses kept reminding, the old dose too.
 *
 * So when a note is bridged, for each course of the same patient bridged
 * from an EARLIER visit (by first signature, which a re-signature never
 * moves):
 *
 *   - REPLACED: a row of this note names the same drug and its own course
 *     reminds (`remindPatient` and a time of day). The older course is
 *     COMPLETED, marked `schedule.supersededByNote`. A row that does not
 *     remind (no time of day, «напоминать» off) replaces nothing: completing
 *     the old course would silently end the reminders of a lifelong drug.
 *
 * A visit that does not repeat a lifelong drug does NOT stop it (owner's
 * decision 10.10.2026: blood pressure and sugar drugs are taken for life, and
 * a control visit about something else need not list them again). A lifelong
 * course ends only by a correction in the window or by the same drug written
 * again. For a few hours on 10.10.2026 a «stopped by omission» rule was live
 * and wrote `schedule.stoppedByNote`; the next pass of that note undoes such
 * a mark like any other.
 *
 * A mark is undone by the next pass of the same note when the reason is gone
 * (an in-window correction): the course comes back to ACTIVE, unless a course
 * of the same drug from a visit signed after its own still reminds, which
 * then takes the mark instead. Only our own marks are undone.
 *
 * The note's own courses follow the same order (`ownCourseState`): a row of
 * an older note re-bridged after a newer visit already took the drug over is
 * written COMPLETED under that newer note, and a course a newer note marked
 * keeps the mark through the older note's re-bridge.
 *
 * Left alone, on purpose:
 *   - PAUSED courses: the patient's or reception's choice;
 *   - COMPLETED without our mark: the patient, reception or the end of days;
 *   - case courses (caseId set): written by reception, not a visit;
 *
 * Pure: the bridge worker reads the rows and writes the plan, tested here.
 */
import { foldCatalogText } from "@/lib/catalogs/search-fold";

/** The key in `Prescription.schedule` naming the note that replaced it. */
export const SUPERSEDED_BY_NOTE_KEY = "supersededByNote";
/**
 * The key the removed «stopped by omission» rule wrote (10.10.2026, a few
 * hours). Never written now; kept so the next pass of that note undoes it.
 */
export const STOPPED_BY_NOTE_KEY = "stoppedByNote";

const MARK_KEYS = [SUPERSEDED_BY_NOTE_KEY, STOPPED_BY_NOTE_KEY] as const;
type MarkKey = (typeof MARK_KEYS)[number];

/** What identifies the drug of a row: catalog id, else the name; the form. */
export type DrugIdentity = {
  drugId?: string | null;
  displayName: string;
  /** TAB, INJ_IM, GEL…: one substance, separate regimens. */
  form?: string | null;
};

export type SupersedeCandidate = {
  id: string;
  /** "ACTIVE" | "COMPLETED" (anything else is ignored). */
  status: string;
  schedule: unknown;
  /** Snapshot of the row's name at bridge time. */
  drugName: string;
  /** The visit note the course was bridged from. */
  noteId: string;
  /** That note's doctor. */
  noteDoctorId: string | null;
  /**
   * When that note was FIRST signed (`firstFinalizedAt ?? finalizedAt`).
   * `finalizedAt` moves to «now» on a revert and re-signature, which would
   * turn the older visit into the newer one.
   */
  noteSignedAt: Date | null;
  /** The visit row the course was bridged from, when it still exists. */
  source: DrugIdentity | null;
};

export type SupersedePlan = {
  /** COMPLETED, with the mark set in the schedule. */
  complete: Array<{ id: string; schedule: Record<string, unknown> }>;
  /** Back to ACTIVE, with the marks removed. */
  restore: Array<{ id: string; schedule: Record<string, unknown> }>;
};

function foldName(name: string): string {
  return foldCatalogText(name).replace(/\s+/g, " ").trim();
}

/**
 * Same drug: by catalog id when both rows have one, else by the folded name
 * (a manual row, written outside the catalog). And the same form when both
 * say one: diclofenac gel at the dermatologist is not the neurologist's
 * diclofenac tablets.
 */
export function isSameDrug(a: DrugIdentity, b: DrugIdentity): boolean {
  let same: boolean;
  if (a.drugId && b.drugId) same = a.drugId === b.drugId;
  else {
    const na = foldName(a.displayName);
    same = na !== "" && na === foldName(b.displayName);
  }
  if (!same) return false;
  return !a.form || !b.form || a.form === b.form;
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Does this stored schedule remind at all (a time of day)? */
function reminds(schedule: Record<string, unknown> | null): boolean {
  return Array.isArray(schedule?.times) && schedule.times.length > 0;
}

function withoutMarks(schedule: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...schedule };
  for (const k of MARK_KEYS) delete rest[k];
  return rest;
}

/** The mark a schedule carries, if any. */
export function courseMark(
  raw: unknown,
): { key: MarkKey; noteId: string } | null {
  const schedule = asObject(raw);
  if (!schedule) return null;
  for (const key of MARK_KEYS) {
    const v = schedule[key];
    if (typeof v === "string" && v !== "") return { key, noteId: v };
  }
  return null;
}

function drugOf(c: SupersedeCandidate): DrugIdentity {
  return c.source ?? { drugId: null, displayName: c.drugName };
}

/**
 * A course of `drug`, from a visit signed after `after`, that reminds and
 * stays ACTIVE: the newer visit the drug goes on under. Its note id, or null.
 */
function laterReminding(
  drug: DrugIdentity,
  after: number,
  candidates: readonly SupersedeCandidate[],
  statusOf: (c: SupersedeCandidate) => string,
  skipId?: string,
): string | null {
  let best: SupersedeCandidate | null = null;
  for (const o of candidates) {
    if (o.id === skipId || statusOf(o) !== "ACTIVE") continue;
    if (o.noteSignedAt == null || o.noteSignedAt.getTime() <= after) continue;
    if (!reminds(asObject(o.schedule)) || !isSameDrug(drug, drugOf(o))) continue;
    if (!best || o.noteSignedAt.getTime() > best.noteSignedAt!.getTime()) best = o;
  }
  return best?.noteId ?? null;
}

/**
 * The courses to complete and to restore when note `noteId`, first signed
 * at `signedAt`, is bridged. `replacing`: its rows whose own course reminds.
 */
export function planCourseSupersede(input: {
  noteId: string;
  signedAt: Date;
  replacing: readonly DrugIdentity[];
  candidates: readonly SupersedeCandidate[];
}): SupersedePlan {
  const plan: SupersedePlan = { complete: [], restore: [] };
  const at = input.signedAt.getTime();

  // Newest first: whether an older course comes back depends on what this
  // pass leaves of the courses between it and this note.
  const ordered = [...input.candidates].sort(
    (a, b) => (b.noteSignedAt?.getTime() ?? 0) - (a.noteSignedAt?.getTime() ?? 0),
  );
  const post = new Map<string, string>();
  const statusOf = (c: SupersedeCandidate) => post.get(c.id) ?? c.status;

  for (const c of ordered) {
    const schedule = asObject(c.schedule);
    if (!schedule) continue;
    const mark = courseMark(schedule);
    const markedByUs = c.status === "COMPLETED" && mark?.noteId === input.noteId;
    const earlier = c.noteSignedAt != null && c.noteSignedAt.getTime() < at;
    if (!(c.status === "ACTIVE" && earlier) && !markedByUs) continue;

    const drug = drugOf(c);
    let target: { key: MarkKey; noteId: string } | null = null;
    if (earlier && input.replacing.some((r) => isSameDrug(r, drug))) {
      target = { key: SUPERSEDED_BY_NOTE_KEY, noteId: input.noteId };
    } else if (markedByUs && c.noteSignedAt != null) {
      // Coming back: unless a newer visit's course of it still reminds.
      const later = laterReminding(drug, c.noteSignedAt.getTime(), ordered, statusOf, c.id);
      if (later && later !== c.noteId) {
        target = { key: SUPERSEDED_BY_NOTE_KEY, noteId: later };
      }
    }

    if (target) {
      post.set(c.id, "COMPLETED");
      const same =
        c.status === "COMPLETED" &&
        mark?.key === target.key &&
        mark.noteId === target.noteId &&
        MARK_KEYS.filter((k) => schedule[k] != null).length === 1;
      if (!same) {
        plan.complete.push({
          id: c.id,
          schedule: { ...withoutMarks(schedule), [target.key]: target.noteId },
        });
      }
    } else if (c.status !== "ACTIVE") {
      post.set(c.id, "ACTIVE");
      plan.restore.push({ id: c.id, schedule: withoutMarks(schedule) });
    }
  }
  return plan;
}

/**
 * The status and mark of one of the note's OWN courses on a (re-)bridge.
 *
 *   - a course another note marked keeps its status and mark while it is
 *     still the same drug: the upsert rewrites the schedule, and losing the
 *     mark meant that note could never bring it back;
 *   - a key whose row is now another drug (the editor renumbers rows on
 *     every save) is that drug's course: it starts over;
 *   - a new, re-activated or renamed course of a drug a NEWER visit's course
 *     already reminds is written COMPLETED under that visit, so an older
 *     note corrected late does not add a second course next to the newer
 *     dose;
 *   - PAUSED and COMPLETED without a mark are left as they are.
 *
 * `status` undefined: keep the stored one. `mark`: merge into the schedule.
 */
export function ownCourseState(input: {
  row: DrugIdentity;
  existing: { status: string; schedule: unknown; drugName: string } | null;
  /** The note's own first signature. */
  signedAt: Date;
  candidates: readonly SupersedeCandidate[];
}): { status: "ACTIVE" | "COMPLETED" | undefined; mark: Record<string, string> } {
  const { existing } = input;
  if (existing) {
    if (existing.status === "PAUSED") return { status: undefined, mark: {} };
    const mark = courseMark(existing.schedule);
    if (existing.status === "COMPLETED") {
      if (!mark) return { status: undefined, mark: {} };
      if (isSameDrug(input.row, { drugId: null, displayName: existing.drugName })) {
        return { status: undefined, mark: { [mark.key]: mark.noteId } };
      }
    }
  }
  const later = laterReminding(
    input.row,
    input.signedAt.getTime(),
    input.candidates,
    (c) => c.status,
  );
  if (later) {
    return { status: "COMPLETED", mark: { [SUPERSEDED_BY_NOTE_KEY]: later } };
  }
  return { status: existing?.status === "ACTIVE" ? undefined : "ACTIVE", mark: {} };
}

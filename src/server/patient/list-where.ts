/**
 * The WHERE of the patients list, shared by the list endpoint, the CSV
 * export worker and the streaming export (audit PT-18, PT-19, INF-02).
 *
 * The export used to rebuild its own filter from a subset of keys: the
 * search box and the period on screen were dropped, so «Экспорт» after
 * searching «Турматов» downloaded the whole base. One builder means the
 * file is the list the admin is looking at.
 *
 * Periods are Tashkent calendar days, both ends included:
 *   - «Дата посещения» (`visitedFrom` / `visitedTo`): the patient had a
 *     visit (on the table or completed) that day. The cell carried that
 *     label but filtered the registration date, and `lte` on UTC midnight
 *     lost the last day after 05:00 Tashkent.
 *   - `registeredFrom` / `registeredTo`: the card's creation. A YYYY-MM-DD
 *     day covers the whole Tashkent day; a full ISO instant (the «Новые за
 *     7 дней» segment) is used as is.
 *
 * A card erased under a DSAR request (`deletedAt`) is not a patient on any
 * list or file any more (audit PT-07).
 */
import {
  isTashkentDateString,
  tashkentDateOf,
  tashkentDayRange,
} from "@/lib/tashkent-time";
import { patientBalanceIdWhere } from "@/server/patient/finance";
import { patientSearchWhere } from "@/server/patient/search-where";

type Where = Record<string, unknown>;

/** A visit that happened: the patient was on the table or was seen. */
export const VISITED_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;

export type PatientListFilterInput = {
  q?: string | null;
  segment?: string | null;
  source?: string | null;
  gender?: string | null;
  tag?: string | null;
  consent?: "yes" | "no" | null;
  balance?: "debt" | "zero" | "credit" | null;
  registeredFrom?: string | Date | null;
  registeredTo?: string | Date | null;
  visitedFrom?: string | null;
  visitedTo?: string | null;
  /** Export only: the list applies the age range on the loaded rows. */
  ageMin?: number | null;
  ageMax?: number | null;
};

/** `gte` / `lt|lte` for a registration bound: a Tashkent day or an instant. */
function registeredRange(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): { gte?: Date; lt?: Date; lte?: Date } | null {
  if (!from && !to) return null;
  const range: { gte?: Date; lt?: Date; lte?: Date } = {};
  if (from) {
    if (typeof from === "string" && isTashkentDateString(from)) {
      range.gte = tashkentDayRange(from, null)!.gte;
    } else {
      const at = from instanceof Date ? from : new Date(from);
      if (!Number.isNaN(at.getTime())) range.gte = at;
    }
  }
  if (to) {
    if (typeof to === "string" && isTashkentDateString(to)) {
      range.lt = tashkentDayRange(null, to)!.lt;
    } else {
      const at = to instanceof Date ? to : new Date(to);
      if (!Number.isNaN(at.getTime())) range.lte = at;
    }
  }
  return Object.keys(range).length > 0 ? range : null;
}

/**
 * Birth dates for an age range, the way the list computes age (full years
 * on today's Tashkent date). Cards without a birth date are out, as on
 * screen.
 */
function ageRange(
  ageMin: number | null | undefined,
  ageMax: number | null | undefined,
  now: Date,
): { gt?: Date; lte?: Date; not: null } | null {
  if (ageMin == null && ageMax == null) return null;
  const today = tashkentDateOf(now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const yearsAgo = (years: number) =>
    new Date(Date.UTC(y - years, m - 1, d, 23, 59, 59, 999));
  const range: { gt?: Date; lte?: Date; not: null } = { not: null };
  // At least `ageMin` full years: born on or before today, ageMin years ago.
  if (ageMin != null) range.lte = yearsAgo(ageMin);
  // At most `ageMax`: born after today's date ageMax + 1 years ago.
  if (ageMax != null) range.gt = yearsAgo(ageMax + 1);
  return range;
}

export async function buildPatientListWhere(
  f: PatientListFilterInput,
  clinicId: string | null,
  now: Date = new Date(),
): Promise<Where> {
  const where: Where = { deletedAt: null };
  if (f.segment) where.segment = f.segment;
  if (f.source) where.source = f.source;
  if (f.gender) where.gender = f.gender;
  if (f.tag) where.tags = { has: f.tag };
  if (f.consent === "yes") where.consentMarketing = true;
  if (f.consent === "no") where.consentMarketing = false;
  // «Должники» on the computed balance (audit PT-08): the `balance` column
  // is never written, so filtering on it matched nobody, or everybody.
  if (f.balance && clinicId) {
    const idWhere = await patientBalanceIdWhere(clinicId, f.balance);
    if (idWhere) where.id = idWhere;
  }
  const createdAt = registeredRange(f.registeredFrom, f.registeredTo);
  if (createdAt) where.createdAt = createdAt;
  const visitedOn = tashkentDayRange(
    f.visitedFrom && isTashkentDateString(f.visitedFrom) ? f.visitedFrom : null,
    f.visitedTo && isTashkentDateString(f.visitedTo) ? f.visitedTo : null,
  );
  if (visitedOn) {
    where.appointments = {
      some: { status: { in: [...VISITED_STATUSES] }, date: visitedOn },
    };
  }
  const birthDate = ageRange(f.ageMin, f.ageMax, now);
  if (birthDate) where.birthDate = birthDate;
  // Name / phone / passport / Telegram, and «Фамилия ГГГГ» (audit PT-03).
  const search = patientSearchWhere(f.q, now);
  if (search) where.AND = [search];
  return where;
}

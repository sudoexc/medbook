/**
 * A patient's age from the birth date on the card (the doctor's visit
 * screen, owner request 05.10.2026). Pure, client-safe.
 */

/**
 * Full years and, under a year, full months: the clinic sees children too,
 * and «0 лет» says nothing about an eight-month-old.
 */
export function ageFromBirth(
  iso: string | null | undefined,
  now: Date = new Date(),
): { years: number; months: number } | null {
  if (!iso) return null;
  const b = new Date(iso);
  if (Number.isNaN(b.getTime())) return null;
  let months =
    (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months };
}

/**
 * Which APPOINTMENT_BEFORE templates `reminder-cadence-5d3d1d3h.ts` may
 * switch off (audit G2-10). Pure, so the unit test drives it.
 *
 * The sweep used to deactivate EVERY active «before the visit» template off
 * the four canonical offsets, while its header promised to leave admin
 * customisations alone: an admin's «напоминание за 1 час» went off silently
 * on the next run after a deploy. Now the sweep touches only rows a seed
 * wrote and nobody changed since:
 *   - the key is one of the retired seed keys below, and the offset is still
 *     the one that seed gave it;
 *   - `createdById` is empty (the CRM sets it on every template an admin
 *     creates; seeds and the onboarding playbook never do);
 *   - no staff audit row names the template (every CRM edit of a template
 *     writes one; seeds write none).
 * Everything else is reported and left as it is.
 */

/** The cascade the scheduler owns: 5 days, 3 days, 1 day, 3 hours before. */
export const CANONICAL_OFFSETS: ReadonlySet<number> = new Set([-7200, -4320, -1440, -180]);

/**
 * APPOINTMENT_BEFORE keys seeds and the onboarding playbook have written,
 * with the offset each was seeded at: the ex-canon 5h / 2h / 1h pings and
 * the playbook's copies of the 3d / 24h bands.
 */
export const SEEDED_REMINDER_OFFSETS: Readonly<Record<string, number>> = {
  "appointment.reminder-5h": -300,
  "appointment.reminder-2h": -120,
  "appointment.reminder-1h": -60,
  "reminder.5h": -300,
  "reminder.2h": -120,
  "reminder.3d": -4320,
  "reminder.24h": -1440,
};

export type CadenceRow = {
  id: string;
  key: string;
  triggerConfig: unknown;
  createdById: string | null;
  createdAt: Date;
};

export function offsetOf(triggerConfig: unknown): number | null {
  const cfg =
    triggerConfig && typeof triggerConfig === "object" && !Array.isArray(triggerConfig)
      ? (triggerConfig as { offsetMin?: unknown })
      : {};
  return typeof cfg.offsetMin === "number" ? cfg.offsetMin : null;
}

/** Written by a seed and untouched by staff since. */
export function isSeedOwned(row: CadenceRow, staffTouched: ReadonlySet<string>): boolean {
  if (row.createdById) return false;
  if (staffTouched.has(row.id)) return false;
  const seeded = SEEDED_REMINDER_OFFSETS[row.key];
  return seeded !== undefined && offsetOf(row.triggerConfig) === seeded;
}

export type CadenceSweep = {
  /** One row per canonical offset that stays on. */
  keep: CadenceRow[];
  /** Seed rows to switch off. */
  retire: CadenceRow[];
  /** Admin rows left on as they are, with the reason, for the log. */
  leftAlone: Array<{ row: CadenceRow; reason: "admin_offset" | "admin_duplicate" }>;
};

/**
 * Split the clinic's ACTIVE APPOINTMENT_BEFORE rows. On each canonical
 * offset one row stays (the canonical `appointment.reminder-*` key first,
 * else the oldest); seed duplicates there and seed rows on retired offsets
 * are switched off.
 */
export function planCadenceSweep(
  active: readonly CadenceRow[],
  staffTouched: ReadonlySet<string>,
): CadenceSweep {
  const rows = [...active].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1),
  );
  const keep: CadenceRow[] = [];
  const retire: CadenceRow[] = [];
  const leftAlone: CadenceSweep["leftAlone"] = [];

  const keeperFor = new Map<number, CadenceRow>();
  for (const off of CANONICAL_OFFSETS) {
    const on = rows.filter((r) => offsetOf(r.triggerConfig) === off);
    const keeper = on.find((r) => r.key.startsWith("appointment.reminder-")) ?? on[0];
    if (keeper) keeperFor.set(off, keeper);
  }

  for (const row of rows) {
    const off = offsetOf(row.triggerConfig);
    const canonical = off !== null && CANONICAL_OFFSETS.has(off);
    if (canonical && keeperFor.get(off!) === row) {
      keep.push(row);
    } else if (isSeedOwned(row, staffTouched)) {
      retire.push(row);
    } else {
      leftAlone.push({ row, reason: canonical ? "admin_duplicate" : "admin_offset" });
    }
  }
  return { keep, retire, leftAlone };
}

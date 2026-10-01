/**
 * Audit G2-10: the template scripts brought back the retired 5h / 2h
 * reminders and switched off admins' own ones.
 *
 *   - backfill-new-templates.ts created an active `reminder.5h` in every
 *     clinic without it, and NEW-CLINIC.md runs it at onboarding: patients of
 *     a new clinic got «за 5 часов» and «за 3 часа» almost back to back;
 *   - reminder-cadence-5d3d1d3h.ts switched off EVERY active «before the
 *     visit» template off the four canonical offsets, an admin's «за 1 час»
 *     included, while its header promised to leave customisations alone;
 *   - findTemplateFor picked one of two templates on a band in no order.
 * Pinned: the backfill creates no reminder, the sweep only switches off
 * seed rows nobody touched, the band lookup is ordered, the docs say so.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_OFFSETS,
  isSeedOwned,
  planCadenceSweep,
  type CadenceRow,
} from "../../scripts/_reminder-cadence-plan";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

let seq = 0;
function row(key: string, offsetMin: number, extra: Partial<CadenceRow> = {}): CadenceRow {
  seq += 1;
  return {
    id: extra.id ?? `t${seq}`,
    key,
    triggerConfig: { offsetMin },
    createdById: null,
    createdAt: new Date(Date.UTC(2026, 5, 1, 0, seq)),
    ...extra,
  };
}

const ids = (rows: CadenceRow[]) => rows.map((r) => r.key).sort();

describe("planCadenceSweep", () => {
  it("leaves exactly the four cascade bands plus the admin's own templates on", () => {
    const active = [
      // What the playbook, seed-notification-templates and the old backfill
      // leave behind in a new clinic.
      row("reminder.3d", -4320),
      row("reminder.24h", -1440),
      row("reminder.2h", -120),
      row("reminder.5h", -300),
      row("appointment.reminder-5d", -7200),
      row("appointment.reminder-3d", -4320),
      row("appointment.reminder-24h", -1440),
      row("appointment.reminder-3h", -180),
      // The admin's «за 1 час», created in the CRM.
      row("custom.1h", -60, { createdById: "u_admin" }),
    ];
    const sweep = planCadenceSweep(active, new Set());
    expect(ids(sweep.keep)).toEqual([
      "appointment.reminder-24h",
      "appointment.reminder-3d",
      "appointment.reminder-3h",
      "appointment.reminder-5d",
    ]);
    expect(ids(sweep.retire)).toEqual(["reminder.24h", "reminder.2h", "reminder.3d", "reminder.5h"]);
    expect(sweep.leftAlone.map((l) => [l.row.key, l.reason])).toEqual([["custom.1h", "admin_offset"]]);
  });

  it("never switches off a seeded key an admin edited in the CRM", () => {
    const edited = row("reminder.5h", -300, { id: "edited" });
    const sweep = planCadenceSweep([edited], new Set(["edited"]));
    expect(sweep.retire).toEqual([]);
    expect(sweep.leftAlone[0]!.row.id).toBe("edited");
  });

  it("never switches off a seeded key the admin moved to another offset", () => {
    const moved = row("appointment.reminder-1h", -90);
    expect(planCadenceSweep([moved], new Set()).retire).toEqual([]);
  });

  it("keeps the admin's duplicate on a canonical band on, and says so", () => {
    const seed = row("appointment.reminder-24h", -1440);
    const admin = row("my.24h", -1440, { createdById: "u_admin" });
    const sweep = planCadenceSweep([admin, seed], new Set());
    expect(sweep.keep.map((r) => r.key)).toEqual(["appointment.reminder-24h"]);
    expect(sweep.retire).toEqual([]);
    expect(sweep.leftAlone.map((l) => [l.row.key, l.reason])).toEqual([["my.24h", "admin_duplicate"]]);
  });

  it("keeps a playbook row when it is the only one on its band", () => {
    const only = row("reminder.24h", -1440);
    const sweep = planCadenceSweep([only], new Set());
    expect(sweep.keep).toEqual([only]);
    expect(sweep.retire).toEqual([]);
  });

  it("matches the scheduler's canonical offsets", () => {
    expect([...CANONICAL_OFFSETS].sort((a, b) => a - b)).toEqual([-7200, -4320, -1440, -180]);
    expect(read("src/server/workers/notifications-scheduler.ts")).toMatch(
      /CANONICAL_OFFSETS = new Set\(\[-7200, -4320, -1440, -180\]\)/,
    );
  });

  it("isSeedOwned needs the seeded key, the seeded offset, no author and no staff edit", () => {
    expect(isSeedOwned(row("reminder.2h", -120), new Set())).toBe(true);
    expect(isSeedOwned(row("reminder.2h", -120, { createdById: "u1" }), new Set())).toBe(false);
    expect(isSeedOwned(row("reminder.2h", -100), new Set())).toBe(false);
    expect(isSeedOwned(row("whatever", -120), new Set())).toBe(false);
    expect(isSeedOwned(row("reminder.2h", -120, { id: "x" }), new Set(["x"]))).toBe(false);
  });
});

describe("the template scripts and docs", () => {
  it("backfill-new-templates creates no reminder before a visit and dry-runs by default", () => {
    const src = read("scripts/backfill-new-templates.ts");
    expect(src).not.toMatch(/key: "reminder\.5h"/);
    expect(src).not.toMatch(/APPOINTMENT_BEFORE/);
    expect(src).toMatch(/key: "case\.repeat-due"/);
    expect(src).toMatch(/const APPLY = process\.env\.APPLY === "1"/);
  });

  it("reminder-cadence plans with the shared sweep, reads staff edits and dry-runs by default", () => {
    const src = read("scripts/reminder-cadence-5d3d1d3h.ts");
    expect(src).toMatch(/planCadenceSweep\(/);
    expect(src).toMatch(/entityType: "NotificationTemplate"/);
    expect(src).toMatch(/const APPLY = process\.env\.APPLY === "1"/);
    expect(src).not.toMatch(/Rows whose offset an admin customised away from the seeded value are\s+\*\s+left untouched/);
    // The helper ships with the script in the worker image.
    const allow = read("scripts/worker-allowlist.txt");
    expect(allow).toMatch(/^_reminder-cadence-plan\.ts$/m);
  });

  it("findTemplateFor resolves two templates on one band the same way every time", () => {
    const src = read("src/server/notifications/triggers.ts");
    const body = src.slice(src.indexOf("async function findTemplateFor("));
    const call = body.slice(0, body.indexOf("if (!row) return null;"));
    expect(call).toMatch(/orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
  });

  it.each(["docs/operations/NEW-CLINIC.md", "docs/operations/GO-LIVE.md"])(
    "%s no longer promises reminder.5h and runs the cadence with APPLY=1",
    (f) => {
      const doc = read(f);
      expect(doc).not.toMatch(/добавляет более поздние ключи: `reminder\.5h`/);
      expect(doc).not.toMatch(/поздние ключи \(`reminder\.5h`/);
      expect(doc).toMatch(/-e APPLY=1 worker npx tsx scripts\/backfill-new-templates\.ts/);
      expect(doc).toMatch(/-e APPLY=1 worker npx tsx scripts\/reminder-cadence-5d3d1d3h\.ts/);
    },
  );
});

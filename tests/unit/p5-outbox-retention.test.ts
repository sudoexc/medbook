/**
 * Audit INF-04 — the event outbox stops growing without bound.
 *
 *   - the doctor's autosave (`visit-note.draftSaved`, every debounced
 *     keystroke) is broadcast after the commit, not stored;
 *   - an hourly sweep deletes DELIVERED rows after 7 days, DEAD after 30;
 *   - the pumper's scan has a `(status, createdAt)` index, delivers a first
 *     attempt at once (no 1 s floor) and gives its transaction room;
 *   - a DSAR erasure deletes the patient's events (p5-privacy-dsar-erasure).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queries: [] as string[],
  txOptions: [] as unknown[],
  executed: [] as Array<{ sql: string; values: unknown[] }>,
  deleteResults: [] as number[],
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      db.queries.push(strings.join("?"));
      return [];
    }),
    eventOutbox: { update: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: unknown) => unknown, opts?: unknown) => {
        db.txOptions.push(opts);
        return fn(tx);
      }),
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        db.executed.push({ sql: strings.join("?"), values });
        return db.deleteResults.shift() ?? 0;
      }),
      auditLog: { createMany: vi.fn() },
    },
  };
});
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_ctx: unknown, fn: () => unknown) => fn(),
}));

import {
  DEAD_RETENTION_MS,
  DELIVERED_RETENTION_MS,
  pruneOutboxOnce,
  pumpOnce,
} from "@/server/workers/outbox-pumper";
import { publishEphemeralEnvelope } from "@/server/realtime/publish";
import { getEventBus } from "@/server/realtime/event-bus";
import { clinicChannel } from "@/server/realtime/channels";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

beforeEach(() => {
  db.queries = [];
  db.txOptions = [];
  db.executed = [];
  db.deleteResults = [];
});

describe("the pumper", () => {
  it("delivers a first attempt at once; the backoff applies to retries only", async () => {
    await pumpOnce();
    const sql = db.queries[0]!.replace(/\s+/g, " ");
    expect(sql).toContain("WHERE status IN ('PENDING', 'FAILED')");
    expect(sql).toContain("attempts = 0 OR");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("runs its batch in a transaction with an explicit 30 s timeout (not Prisma's 5 s)", async () => {
    await pumpOnce();
    expect(db.txOptions[0]).toEqual({ maxWait: 5_000, timeout: 30_000 });
  });

  it("the scan has an index that starts with status", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model EventOutbox {"));
    expect(model.slice(0, model.indexOf("}"))).toContain("@@index([status, createdAt])");
    const dir = readdirSync(path.join(process.cwd(), "prisma/migrations")).find((d) =>
      d.endsWith("_event_outbox_status_created_idx"),
    );
    expect(dir).toBeDefined();
    expect(read(`prisma/migrations/${dir}/migration.sql`)).toContain(
      'CREATE INDEX "EventOutbox_status_createdAt_idx" ON "EventOutbox"("status", "createdAt");',
    );
  });
});

describe("the retention sweep", () => {
  it("deletes DELIVERED after 7 days and DEAD after 30, batch by batch", async () => {
    const now = new Date("2026-10-01T10:00:00Z");
    // DELIVERED: one full batch then a short one; DEAD: a short one.
    db.deleteResults = [5_000, 12, 3];
    const res = await pruneOutboxOnce(now);
    expect(res).toEqual({ delivered: 5_012, dead: 3 });
    expect(db.executed).toHaveLength(3);
    const [first, second, third] = db.executed;
    expect(first!.sql).toContain('DELETE FROM "EventOutbox"');
    expect(first!.values).toEqual([
      "DELIVERED",
      new Date(now.getTime() - DELIVERED_RETENTION_MS),
      5_000,
    ]);
    expect(second!.values[0]).toBe("DELIVERED");
    expect(third!.values).toEqual(["DEAD", new Date(now.getTime() - DEAD_RETENTION_MS), 5_000]);
    expect(DELIVERED_RETENTION_MS).toBe(7 * 24 * 3600 * 1000);
    expect(DEAD_RETENTION_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it("never touches rows still to be delivered", async () => {
    await pruneOutboxOnce();
    for (const e of db.executed) {
      expect(["DELIVERED", "DEAD"]).toContain(e.values[0]);
    }
  });

  it("runs hourly in the worker", () => {
    expect(read("src/server/workers/start.ts")).toContain("startOutboxRetentionWorker()");
  });
});

describe("the doctor's autosave is not stored", () => {
  it("the visit-note PATCH no longer writes draftSaved to the outbox; it broadcasts after the commit", () => {
    const src = read("src/app/api/crm/visit-notes/[id]/route.ts");
    expect(src).not.toContain("publishViaOutbox");
    const txEnd = src.indexOf("if (draftSaved) publishEphemeralEnvelope(draftSaved);");
    expect(txEnd).toBeGreaterThan(src.indexOf('type: "visit-note.draftSaved"'));
  });

  it("the ephemeral broadcast reaches live subscribers and never throws", async () => {
    const seen: unknown[] = [];
    const off = getEventBus().subscribe(clinicChannel("c1"), (e) => seen.push(e));
    publishEphemeralEnvelope({
      type: "visit-note.draftSaved",
      correlationId: "corr-1",
      actor: {
        role: "DOCTOR",
        userId: "u1",
        patientId: null,
        onBehalfOfPatientId: null,
        label: "user:u1",
      },
      surface: "DOCTOR_CABINET",
      tenantScope: { clinicId: "c1", doctorId: "d1", patientId: "p1" },
      payload: { visitNoteId: "n1", doctorId: "d1", patientId: "p1", changedFields: ["complaints"] },
    });
    await new Promise((r) => setTimeout(r, 0));
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "visit-note.draftSaved", tenantScope: { clinicId: "c1" } });
    expect(typeof (seen[0] as { eventId: string }).eventId).toBe("string");

    // A malformed envelope is dropped with a warning, not thrown at the doctor.
    expect(() =>
      publishEphemeralEnvelope({ type: "nope" } as never),
    ).not.toThrow();
  });
});

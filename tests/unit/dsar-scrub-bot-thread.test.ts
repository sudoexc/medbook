/**
 * Audit TG-11 — DSAR anonymization scrubbed chat only in threads linked to
 * the card (`patientId`). The patient's own bot chat, which nobody linked,
 * kept his messages. A private chat's id is his Telegram id, so that chat is
 * found by the id the card held before anonymization cleared it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  convWheres: [] as unknown[],
  convUpdates: [] as unknown[],
  telegramId: "555" as string | null,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/server/queue", () => ({ getQueue: vi.fn() }));
vi.mock("@/server/storage/minio", () => ({ deleteObject: vi.fn() }));
// The audit-log redaction (SEC-09) is pinned in its own tests.
vi.mock("@/server/dsar/audit-scrub", () => ({
  scrubPatientFromAuditLog: vi.fn(async () => undefined),
}));
vi.mock("@/server/patient/cipher-fields", () => ({
  hydratePatientForRead: (p: { passport: string | null }) => p,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dataDeletionJob: {
      findUnique: vi.fn(async () => ({
        id: "job_1",
        clinicId: "clinic_A",
        patientId: "p1",
        status: "APPROVED",
        mode: "ANONYMIZE",
        scheduledFor: new Date("2026-01-01T00:00:00Z"),
      })),
      update: vi.fn(async () => ({})),
    },
    patient: {
      findUnique: vi.fn(async () => ({
        id: "p1",
        fullName: "Каримова Дилноза",
        phone: "+998901234567",
        phoneNormalized: "+998901234567",
        telegramId: state.telegramId,
        telegramUsername: "dilnoza",
        passport: null,
      })),
      update: vi.fn(async () => ({})),
    },
    medicalCase: { updateMany: vi.fn(async () => ({ count: 0 })) },
    appointment: { updateMany: vi.fn(async () => ({ count: 0 })) },
    patientReview: { updateMany: vi.fn(async () => ({ count: 0 })) },
    conversation: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        state.convWheres.push(where);
        return [{ id: "conv_linked" }, { id: "conv_bot" }];
      }),
      updateMany: vi.fn(async ({ where }: { where: unknown }) => {
        state.convUpdates.push(where);
        return { count: 2 };
      }),
    },
    message: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 3 })),
    },
    patientClinicalNote: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    reminder: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    // The other carriers (audit PT-07) are pinned in p5-dsar-erasure.test.ts.
    lead: { updateMany: vi.fn(async () => ({ count: 0 })) },
    onlineRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
    notificationSend: { updateMany: vi.fn(async () => ({ count: 0 })) },
    communication: { updateMany: vi.fn(async () => ({ count: 0 })) },
    call: { updateMany: vi.fn(async () => ({ count: 0 })) },
    review: { updateMany: vi.fn(async () => ({ count: 0 })) },
    document: { findMany: vi.fn(async () => []), delete: vi.fn() },
    visitNoteRevision: { findMany: vi.fn(async () => []), update: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

import { executeDeletionJob } from "@/server/workers/data-deletion";

beforeEach(() => {
  state.convWheres = [];
  state.convUpdates = [];
  state.telegramId = "555";
});

describe("DSAR anonymization reaches the patient's unlinked bot chat", () => {
  it("scrubs threads linked to the card AND his private bot chat", async () => {
    await executeDeletionJob("job_1");
    const expected = {
      OR: [
        { patientId: "p1" },
        { clinicId: "clinic_A", channel: "TG", externalId: "555" },
      ],
    };
    expect(state.convWheres).toEqual([expected]);
    expect(state.convUpdates).toEqual([expected]);
  });

  it("a card with no Telegram scrubs its linked threads only", async () => {
    state.telegramId = null;
    await executeDeletionJob("job_1");
    expect(state.convWheres).toEqual([{ OR: [{ patientId: "p1" }] }]);
  });
});

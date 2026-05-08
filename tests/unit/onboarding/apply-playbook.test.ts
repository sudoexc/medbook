/**
 * Phase 19 Wave 2 — onboarding playbook applier behavior tests.
 *
 * DB-less. Mocks `@/lib/prisma` with in-memory tables for Service /
 * NotificationTemplate / Clinic / AuditLog and runs `applyPlaybook` end-to-
 * end. Asserts:
 *   - first apply creates expected counts of services + templates
 *   - schedule fields land on the Clinic row
 *   - exactly one PLAYBOOK_APPLIED audit row is emitted
 *   - re-applying the same playbook is idempotent (no duplicate rows,
 *     a second audit row IS expected per call but neither services nor
 *     templates inflate)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const fakeDb = vi.hoisted(() => ({
  service: [] as Array<{ clinicId: string; code: string }>,
  notificationTemplate: [] as Array<{ clinicId: string; key: string }>,
  clinic: { id: "clinic_1", workdayStart: "09:00", workdayEnd: "18:00", slotMin: 30 },
  audit: [] as Array<Record<string, unknown>>,
  reset() {
    this.service.length = 0;
    this.notificationTemplate.length = 0;
    this.clinic = { id: "clinic_1", workdayStart: "09:00", workdayEnd: "18:00", slotMin: 30 };
    this.audit.length = 0;
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    service: {
      findMany: vi.fn(async ({ where }: { where: { clinicId: string } }) =>
        fakeDb.service.filter((s) => s.clinicId === where.clinicId),
      ),
      create: vi.fn(async ({ data }: { data: { clinicId: string; code: string } }) => {
        fakeDb.service.push({ clinicId: data.clinicId, code: data.code });
        return data;
      }),
    },
    notificationTemplate: {
      findMany: vi.fn(async ({ where }: { where: { clinicId: string } }) =>
        fakeDb.notificationTemplate.filter((t) => t.clinicId === where.clinicId),
      ),
      create: vi.fn(async ({ data }: { data: { clinicId: string; key: string } }) => {
        fakeDb.notificationTemplate.push({ clinicId: data.clinicId, key: data.key });
        return data;
      }),
    },
    clinic: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (fakeDb.clinic.id === where.id) {
          fakeDb.clinic = { ...fakeDb.clinic, ...data } as typeof fakeDb.clinic;
        }
        return fakeDb.clinic;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        fakeDb.audit.push(data);
        return data;
      }),
    },
  },
}));

import { applyPlaybook } from "@/server/onboarding/apply-playbook";
import { PLAYBOOKS } from "@/server/onboarding/playbooks";

const CLINIC_ID = "clinic_1";

beforeEach(() => {
  fakeDb.reset();
});

describe("applyPlaybook / first apply", () => {
  it("seeds every service and template from the chosen playbook", async () => {
    const pb = PLAYBOOKS.neurology;
    const result = await applyPlaybook(CLINIC_ID, "neurology");

    expect(result.servicesCreated).toBe(pb.services.length);
    expect(result.templatesCreated).toBe(pb.templates.length);
    expect(result.scheduleSet).toBe(true);

    const codes = fakeDb.service.map((s) => s.code).sort();
    expect(codes).toEqual(pb.services.map((s) => s.code).sort());
  });

  it("writes the playbook schedule to the clinic row", async () => {
    const pb = PLAYBOOKS.dental;
    await applyPlaybook(CLINIC_ID, "dental");
    expect(fakeDb.clinic.workdayStart).toBe(pb.schedule.workdayStart);
    expect(fakeDb.clinic.workdayEnd).toBe(pb.schedule.workdayEnd);
    expect(fakeDb.clinic.slotMin).toBe(pb.schedule.slotMin);
  });

  it("emits exactly one PLAYBOOK_APPLIED audit row", async () => {
    await applyPlaybook(CLINIC_ID, "general");
    expect(fakeDb.audit.length).toBe(1);
    expect(fakeDb.audit[0].action).toBe("PLAYBOOK_APPLIED");
    expect(fakeDb.audit[0].entityType).toBe("Clinic");
    expect(fakeDb.audit[0].entityId).toBe(CLINIC_ID);
    const meta = fakeDb.audit[0].meta as Record<string, unknown>;
    expect(meta.slug).toBe("general");
    expect(meta.servicesCreated).toBeGreaterThanOrEqual(5);
    expect(meta.templatesCreated).toBeGreaterThanOrEqual(3);
    expect(meta.scheduleSet).toBe(true);
  });
});

describe("applyPlaybook / idempotency", () => {
  it("re-applying the same playbook does not duplicate service/template rows", async () => {
    await applyPlaybook(CLINIC_ID, "pediatric");
    const servicesAfterFirst = fakeDb.service.length;
    const templatesAfterFirst = fakeDb.notificationTemplate.length;

    const second = await applyPlaybook(CLINIC_ID, "pediatric");
    expect(second.servicesCreated).toBe(0);
    expect(second.templatesCreated).toBe(0);
    expect(fakeDb.service.length).toBe(servicesAfterFirst);
    expect(fakeDb.notificationTemplate.length).toBe(templatesAfterFirst);
  });

  it("each apply still emits one audit row (re-apply is observable)", async () => {
    await applyPlaybook(CLINIC_ID, "cosmetology");
    await applyPlaybook(CLINIC_ID, "cosmetology");
    expect(fakeDb.audit.length).toBe(2);
    for (const row of fakeDb.audit) {
      expect(row.action).toBe("PLAYBOOK_APPLIED");
    }
  });

  it("partial overlap: pre-existing service code is skipped, others created", async () => {
    const pb = PLAYBOOKS.general;
    // Pre-seed one service that the playbook also wants to create.
    fakeDb.service.push({ clinicId: CLINIC_ID, code: pb.services[0].code });

    const result = await applyPlaybook(CLINIC_ID, "general");
    expect(result.servicesCreated).toBe(pb.services.length - 1);
    // No duplicates of the pre-existing code.
    const matches = fakeDb.service.filter((s) => s.code === pb.services[0].code);
    expect(matches.length).toBe(1);
  });
});

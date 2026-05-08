/**
 * Phase 15 Wave 3 — `src/server/ai/tools/*` registry contract tests.
 *
 * Coverage:
 *   - The 4 registered tools (findFreeSlots, findPatient,
 *     getAppointmentsToday, searchActions) have shaped input_schemas.
 *   - executeTool('unknownTool', ...) throws UnknownToolError.
 *   - findFreeSlots returns the expected ToolResult shape with structurally
 *     stubbed prisma. We hoist the prisma stub via vi.mock so the tool
 *     module sees it on import.
 */

import { describe, it, expect, vi } from "vitest";

// Hoisted prisma stub. We mutate the underlying functions per-test by
// reassigning the mocked methods.
vi.mock("@/lib/prisma", () => {
  const stub = {
    doctor: { findMany: vi.fn() },
    doctorSchedule: { findMany: vi.fn() },
    appointment: { findMany: vi.fn(), count: vi.fn() },
    patient: { findMany: vi.fn() },
    action: { findMany: vi.fn() },
  };
  return { prisma: stub };
});

import { prisma } from "@/lib/prisma";
import {
  TOOL_REGISTRY,
  executeTool,
  getToolDescriptors,
  UnknownToolError,
} from "@/server/ai/tools";

const baseCtx = {
  clinicId: "c1",
  userId: "u1",
  locale: "ru" as const,
};

describe("registry — descriptors", () => {
  it("registers exactly the 4 read-only tools", () => {
    const names = Object.keys(TOOL_REGISTRY).sort();
    expect(names).toEqual(
      ["findFreeSlots", "findPatient", "getAppointmentsToday", "searchActions"].sort(),
    );
  });

  it("every tool exposes a JSON-Schema-shaped input_schema", () => {
    for (const t of getToolDescriptors()) {
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.input_schema).toMatchObject({ type: "object" });
      expect(t.input_schema).toHaveProperty("properties");
    }
  });

  it("findPatient marks `query` as required", () => {
    const desc = getToolDescriptors().find((t) => t.name === "findPatient");
    expect(desc).toBeTruthy();
    const schema = desc!.input_schema as { required?: string[] };
    expect(schema.required).toContain("query");
  });
});

describe("executeTool — unknown tool", () => {
  it("throws UnknownToolError with the offending name", async () => {
    let thrown: unknown = null;
    try {
      await executeTool("doesNotExist", {}, baseCtx);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnknownToolError);
    expect((thrown as UnknownToolError).toolName).toBe("doesNotExist");
  });
});

describe("findFreeSlots — happy path with stubbed prisma", () => {
  it("returns up to 5 free slots and produces matching chips", async () => {
    // 1 doctor, working Mon-Sun 9-18, no appointments → all hourly buckets
    // should be free until we hit the cap of 5.
    type Pf = { findMany: ReturnType<typeof vi.fn> };
    const dPrisma = prisma as unknown as {
      doctor: Pf;
      doctorSchedule: Pf;
      appointment: Pf;
    };

    dPrisma.doctor.findMany.mockResolvedValue([
      {
        id: "doc-1",
        nameRu: "Иванов",
        nameUz: "Ivanov",
        specializationRu: "Невролог",
        specializationUz: "Nevrolog",
      },
    ]);

    // Schedule: every weekday 0-6, 09:00-18:00.
    dPrisma.doctorSchedule.findMany.mockResolvedValue(
      [0, 1, 2, 3, 4, 5, 6].map((wd) => ({
        doctorId: "doc-1",
        weekday: wd,
        startTime: "09:00",
        endTime: "18:00",
      })),
    );

    dPrisma.appointment.findMany.mockResolvedValue([]);

    const result = await executeTool(
      "findFreeSlots",
      {
        specialty: "Невролог",
        preferredTimeOfDay: "morning",
      },
      baseCtx,
    );

    expect(result.ok).toBe(true);
    const data = result.data as { slots: Array<{ doctorId: string; deeplink: string }> };
    expect(Array.isArray(data.slots)).toBe(true);
    expect(data.slots.length).toBeGreaterThan(0);
    expect(data.slots.length).toBeLessThanOrEqual(5);
    expect(data.slots[0]!.doctorId).toBe("doc-1");
    expect(data.slots[0]!.deeplink).toContain("/crm/calendar?doctor=doc-1");
    expect(result.chips).toBeTruthy();
    expect(result.chips!.length).toBe(data.slots.length);
    expect(result.chips!.every((c) => c.kind === "slot")).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("returns empty list and friendly summary when no doctors match", async () => {
    type Pf = { findMany: ReturnType<typeof vi.fn> };
    const dPrisma = prisma as unknown as {
      doctor: Pf;
      doctorSchedule: Pf;
      appointment: Pf;
    };
    dPrisma.doctor.findMany.mockResolvedValue([]);
    dPrisma.doctorSchedule.findMany.mockResolvedValue([]);
    dPrisma.appointment.findMany.mockResolvedValue([]);

    const result = await executeTool(
      "findFreeSlots",
      { specialty: "Гинеколог" },
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect((result.data as { slots: unknown[] }).slots).toEqual([]);
    expect(result.summary.toLowerCase()).toMatch(/не нашёл|not found|topilmadi|врач/);
  });
});

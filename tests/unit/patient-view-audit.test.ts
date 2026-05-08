/**
 * Phase 17 Wave 1 — Unit test for the PatientView audit helper.
 *
 * The whole point of this row is the 5-minute throttle, so we assert:
 *   - First call writes a row.
 *   - Immediate second call (same viewer / patient / context) is suppressed.
 *   - A "stale" row outside the throttle window does NOT block a new write.
 *
 * We feed in a hand-rolled Prisma stub so the test runs without a database.
 */
import { describe, expect, it, vi } from "vitest";

import { recordPatientView } from "@/server/audit/patient-view";
import type { PrismaClient } from "@/generated/prisma/client";

type PatientViewLike = {
  id: string;
  clinicId: string;
  viewerUserId: string;
  patientId: string;
  context: string;
  createdAt: Date;
};

function makePrisma(initialRows: PatientViewLike[] = []) {
  const rows = [...initialRows];
  const findFirst = vi.fn(
    async (args: {
      where: {
        clinicId: string;
        viewerUserId: string;
        patientId: string;
        context: string;
        createdAt: { gte: Date };
      };
    }) => {
      const w = args.where;
      const hit = rows.find(
        (r) =>
          r.clinicId === w.clinicId &&
          r.viewerUserId === w.viewerUserId &&
          r.patientId === w.patientId &&
          r.context === w.context &&
          r.createdAt >= w.createdAt.gte,
      );
      return hit ? { id: hit.id } : null;
    },
  );
  const create = vi.fn(async (args: { data: Omit<PatientViewLike, "id" | "createdAt"> }) => {
    const row: PatientViewLike = {
      id: `pv_${rows.length + 1}`,
      ...args.data,
      createdAt: new Date(),
    };
    rows.push(row);
    return row;
  });
  return {
    prisma: {
      patientView: { findFirst, create },
    } as unknown as PrismaClient,
    rows,
    findFirst,
    create,
  };
}

const baseInput = {
  clinicId: "clinic_1",
  viewerUserId: "user_1",
  viewerRole: "DOCTOR",
  patientId: "patient_1",
  context: "patient.detail" as const,
};

describe("recordPatientView", () => {
  it("writes a row on first call", async () => {
    const { prisma, create } = makePrisma();
    const written = await recordPatientView({ prisma, ...baseInput });
    expect(written).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("suppresses a second call inside the throttle window", async () => {
    const { prisma, create } = makePrisma();
    const first = await recordPatientView({ prisma, ...baseInput });
    expect(first).toBe(true);
    const second = await recordPatientView({ prisma, ...baseInput });
    expect(second).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not suppress when the most-recent row is older than the window", async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    const { prisma, create } = makePrisma([
      {
        id: "pv_old",
        clinicId: baseInput.clinicId,
        viewerUserId: baseInput.viewerUserId,
        patientId: baseInput.patientId,
        context: baseInput.context,
        createdAt: stale,
      },
    ]);
    const written = await recordPatientView({ prisma, ...baseInput });
    expect(written).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not suppress different viewer / patient / context tuples", async () => {
    const { prisma, create } = makePrisma();
    await recordPatientView({ prisma, ...baseInput });
    // Different viewer.
    await recordPatientView({
      prisma,
      ...baseInput,
      viewerUserId: "user_2",
    });
    // Different patient.
    await recordPatientView({
      prisma,
      ...baseInput,
      patientId: "patient_2",
    });
    // Different context.
    await recordPatientView({
      prisma,
      ...baseInput,
      context: "appointment.drawer",
    });
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("truncates a long User-Agent to 200 chars", async () => {
    const { prisma, create } = makePrisma();
    const ua = "x".repeat(500);
    await recordPatientView({ prisma, ...baseInput, userAgent: ua });
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]![0] as unknown as {
      data: { userAgent: string | null };
    };
    expect(arg.data.userAgent?.length).toBe(200);
  });

  it("returns false (does not throw) when the DB call rejects", async () => {
    const broken = {
      patientView: {
        findFirst: vi.fn().mockRejectedValue(new Error("db down")),
        create: vi.fn(),
      },
    } as unknown as PrismaClient;
    const written = await recordPatientView({ prisma: broken, ...baseInput });
    expect(written).toBe(false);
  });
});

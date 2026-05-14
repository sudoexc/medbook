/**
 * GET /api/crm/doctors/me/labs/unread — RESULTED labs the doctor hasn't
 * marked REVIEWED yet. Backs the «Анализы» card on /doctor/my-day and the
 * inbox-style list on the action center.
 *
 * Ordered by `receivedAt DESC` so freshest first; CRITICAL flags are NOT
 * sorted ahead in this version — the UI badges them so they pop visually
 * without us having to express two-axis sort here. Pagination is offset-
 * less (limit+1 sentinel + cursor on id) to keep the API consistent with
 * the other /doctors/me list endpoints.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, parseQuery } from "@/server/http";

const QuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const take = q.limit + 1;
    const rows = await prisma.labResult.findMany({
      where: { doctorId: ctx.userId, status: "RESULTED" },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: {
        id: true,
        patientId: true,
        testName: true,
        testCode: true,
        value: true,
        unit: true,
        refRange: true,
        flag: true,
        notes: true,
        status: true,
        receivedAt: true,
        patient: { select: { id: true, fullName: true, photoUrl: true } },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    const total = await prisma.labResult.count({
      where: { doctorId: ctx.userId, status: "RESULTED" },
    });

    return ok({
      rows: rows.map((r) => ({
        id: r.id,
        patientId: r.patientId,
        patientFullName: r.patient?.fullName ?? null,
        patientPhotoUrl: r.patient?.photoUrl ?? null,
        testName: r.testName,
        testCode: r.testCode,
        value: r.value,
        unit: r.unit,
        refRange: r.refRange,
        flag: r.flag,
        notes: r.notes,
        status: r.status,
        receivedAt: r.receivedAt.toISOString(),
      })),
      nextCursor,
      total,
    });
  },
);

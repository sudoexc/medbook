/**
 * /api/crm/doctors/[id]/reviews — patient reviews (NPS) for a single doctor.
 *
 * Source: PatientReview rows where doctorId matches. Sorted newest first.
 * Returns a cursor-paginated `rows` list plus a `summary` (count, avg, score
 * distribution 1..10) computed across the full doctor history — the summary
 * is independent of the page so the header card stays stable while the user
 * scrolls.
 *
 * DOCTOR role can only read their own reviews.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound, forbidden } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/[id]/reviews → id is second-from-last
  return parts[parts.length - 2] ?? "";
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async ({ request, ctx }) => {
    const doctorId = idFromUrl(request);
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
    );
    const cursor = url.searchParams.get("cursor");

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true, userId: true },
    });
    if (!doctor) return notFound();
    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }

    const [rows, grouped] = await Promise.all([
      prisma.patientReview.findMany({
        where: { doctorId },
        orderBy: [{ respondedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          score: true,
          comment: true,
          source: true,
          respondedAt: true,
          appointmentId: true,
          patient: { select: { id: true, fullName: true } },
        },
      }),
      prisma.patientReview.groupBy({
        by: ["score"],
        where: { doctorId },
        _count: { _all: true },
      }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    let total = 0;
    let weighted = 0;
    const distribution: Record<number, number> = {};
    for (let s = 1; s <= 10; s++) distribution[s] = 0;
    for (const g of grouped) {
      const n = g._count._all;
      total += n;
      weighted += g.score * n;
      if (g.score >= 1 && g.score <= 10) distribution[g.score] = n;
    }
    const avgScore = total > 0 ? weighted / total : null;

    return ok({
      rows: page.map((r) => ({
        id: r.id,
        score: r.score,
        comment: r.comment,
        source: r.source,
        respondedAt: r.respondedAt,
        appointmentId: r.appointmentId,
        patientId: r.patient?.id ?? null,
        patientName: r.patient?.fullName ?? null,
      })),
      nextCursor,
      summary: {
        count: total,
        avgScore,
        distribution,
      },
    });
  },
);

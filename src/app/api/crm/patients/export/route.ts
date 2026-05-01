/**
 * /api/crm/patients/export — streaming CSV export. See docs/TZ.md §6.4.
 * ADMIN only. UTF-8 BOM, comma-separated, RFC 4180 quoting.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { parseQuery } from "@/server/http";
import { QueryPatientSchema } from "@/server/schemas/patient";

const COLUMNS = [
  "id",
  "fullName",
  "phone",
  "gender",
  "birthDate",
  "segment",
  "source",
  "ltv",
  "visitsCount",
  "balance",
  "lastVisitAt",
  "tags",
  "createdAt",
] as const;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join("|")
        : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryPatientSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.segment) where.segment = q.segment;
    if (q.source) where.source = q.source;
    if (q.gender) where.gender = q.gender;
    if (q.tag) where.tags = { has: q.tag };
    if (q.q) {
      const term = q.q.trim();
      const phoneDigits = term.replace(/\D/g, "");
      const phoneNorm = normalizePhone(term);
      const or: Array<Record<string, unknown>> = [
        { fullName: { contains: term, mode: "insensitive" } },
      ];
      if (phoneDigits.length >= 3) {
        or.push({ phoneNormalized: { contains: phoneDigits } });
        if (phoneNorm) or.push({ phoneNormalized: { contains: phoneNorm } });
      }
      where.OR = or;
    }

    const encoder = new TextEncoder();
    const BOM = "﻿";
    const header = COLUMNS.join(",") + "\n";

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(BOM + header));
        const PAGE = 500;
        let cursor: string | undefined;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const batch = await prisma.patient.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: PAGE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          });
          if (batch.length === 0) break;
          for (const row of batch) {
            const rec = row as unknown as Record<string, unknown>;
            const line =
              COLUMNS.map((c) => csvEscape(rec[c])).join(",") + "\n";
            controller.enqueue(encoder.encode(line));
          }
          cursor = batch[batch.length - 1]?.id;
          if (batch.length < PAGE) break;
        }
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="patients.csv"`,
      },
    });
  }
);

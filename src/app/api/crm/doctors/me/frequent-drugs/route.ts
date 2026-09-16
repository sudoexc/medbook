/**
 * GET /api/crm/doctors/me/frequent-drugs — what THIS doctor prescribes most.
 *
 * The prescription chips were a hand-ordered list of presets, so every doctor
 * saw the same drugs in the same order regardless of practice. The neurologist
 * asked for the obvious thing instead: put what he actually writes at the
 * front.
 *
 * Frequency is counted from prescriptions he really issued, not from chip
 * clicks — a click counter would reward whatever sits highest and cement the
 * existing order (rich-get-richer). Two sources, because the doctor uses both
 * lanes:
 *   - `VisitPrescription` — the structured constructor
 *   - `VisitNote.prescriptions` — the free-text quick entry under the
 *     patient's name
 *
 * Recency-bounded: a drug he stopped using six months ago should fade rather
 * than hold its place forever.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, parseQuery } from "@/server/http";
import { z } from "zod";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(12),
  /** How far back to count. Long enough to survive a quiet week. */
  days: z.coerce.number().int().min(7).max(730).default(180),
});

export type FrequentDrugRow = {
  /** What to insert — the display name as the doctor writes it. */
  label: string;
  /** Times prescribed in the window. */
  count: number;
  /** Catalog id when the row came from the structured constructor. */
  drugId: string | null;
  /** Most recent dose used with this drug, as a suggestion. */
  lastDose: string | null;
};

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { limit, days } = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const since = new Date(Date.now() - days * 86_400_000);

    // Structured prescriptions, newest first so the dose snapshot below is the
    // most recent one rather than an arbitrary row.
    const structured = await prisma.visitPrescription.findMany({
      where: {
        visitNote: { doctorId: doctor.id, createdAt: { gte: since } },
      },
      select: {
        displayName: true,
        dose: true,
        drugId: true,
        visitNote: { select: { createdAt: true } },
      },
      orderBy: { visitNote: { createdAt: "desc" } },
      take: 2000,
    });

    // Free-text quick-entry lines.
    const notes = await prisma.visitNote.findMany({
      where: { doctorId: doctor.id, createdAt: { gte: since } },
      select: { prescriptions: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    type Acc = { label: string; count: number; drugId: string | null; lastDose: string | null };
    const acc = new Map<string, Acc>();

    /** Group case-insensitively; keep the first spelling seen (the newest). */
    const bump = (raw: string, drugId: string | null, dose: string | null) => {
      const label = raw.trim();
      if (label.length < 2) return;
      const key = label.toLowerCase();
      const cur = acc.get(key);
      if (cur) {
        cur.count += 1;
        cur.drugId = cur.drugId ?? drugId;
        cur.lastDose = cur.lastDose ?? dose;
        return;
      }
      acc.set(key, { label, count: 1, drugId, lastDose: dose });
    };

    for (const p of structured) bump(p.displayName, p.drugId, p.dose);
    for (const n of notes) for (const line of n.prescriptions) bump(line, null, null);

    const rows: FrequentDrugRow[] = [...acc.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"))
      .slice(0, limit)
      .map((r) => ({
        label: r.label,
        count: r.count,
        drugId: r.drugId,
        lastDose: r.lastDose,
      }));

    return ok({ rows, windowDays: days });
  },
);

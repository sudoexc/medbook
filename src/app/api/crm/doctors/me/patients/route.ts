/**
 * /api/crm/doctors/me/patients — list of patients seen (or scheduled) by the
 * currently signed-in DOCTOR. Backs `/doctor/patients`.
 *
 * "Мои пациенты" = every patient with ≥1 Appointment whose doctorId matches
 * the Doctor row joined to session.userId. We deliberately scope to the
 * doctor's own caseload here instead of the clinic-wide /api/crm/patients
 * list so the doctor surface stays focused even in a multi-doctor clinic.
 *
 * Each row is enriched with:
 *   - lastVisit:  the most recent COMPLETED appointment + its VisitNote
 *                 diagnosis (if any) — drives the "Последний визит /
 *                 диагноз" columns in the table.
 *   - nextBooked: the next BOOKED/WAITING appointment in the future —
 *                 drives the "Следующий приём" column.
 *   - hasActiveAppointment: true while an IN_PROGRESS appointment exists
 *                 (lights up the "На приёме" status badge in real time).
 *
 * The three enrichment queries run in parallel as one batch per page and
 * are joined back by patientId in memory — Prisma can't express "latest
 * row per group" cleanly without raw SQL, and the page is bounded by
 * `limit + 1` so the row count is small.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, parseQuery } from "@/server/http";
import { normalizePhone } from "@/lib/phone";
import {
  classifyDoctorSegment,
  DAY_MS,
  type DoctorSegmentKey,
} from "@/lib/doctor-patient-segments";

const QuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  tab: z
    .enum(["all", "active", "new", "watch", "returned", "dormant"])
    .default("all"),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type DoctorPatientRow = {
  id: string;
  fullName: string;
  photoUrl: string | null;
  birthDate: string | null;
  phone: string;
  segment: "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";
  hasActiveAppointment: boolean;
  lastVisitWithMeAt: string | null;
  lastDiagnosisCode: string | null;
  lastDiagnosisName: string | null;
  nextAppointmentWithMeAt: string | null;
};

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    // Resolve doctorId from the session user. We do this in-handler rather
    // than caching on the JWT because the doctor row could be deactivated /
    // re-linked outside of a session refresh and we want every request to
    // see the current row.
    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }
    const doctorId = doctor.id;
    const now = new Date();

    // ── Build the patient-level WHERE clause ──────────────────────────────
    // The clinicId scope is injected by the Prisma tenant-scope extension;
    // we only need the doctor-caseload + tab + search filters here.
    const where: Record<string, unknown> = {
      // "Patients of mine" = at least one appointment as this doctor.
      appointments: { some: { doctorId } },
    };

    // Search by name / phone — match the CRM /api/crm/patients behaviour so
    // a doctor's muscle memory works the same.
    if (q.q) {
      const term = q.q.trim();
      const phoneDigits = term.replace(/\D/g, "");
      const phoneNorm = normalizePhone(term);
      const or: Array<Record<string, unknown>> = [
        { fullName: { contains: term, mode: "insensitive" } },
      ];
      if (phoneDigits.length >= 3) {
        or.push({ phone: { contains: term } });
        or.push({ phoneNormalized: { contains: phoneDigits } });
        if (phoneNorm) or.push({ phoneNormalized: { contains: phoneNorm } });
      }
      where.OR = or;
    }

    // Tab filters use the same classifier as the segmentation donut so the
    // donut counts and the table rows always agree. See
    // `src/lib/doctor-patient-segments.ts` for the canonical rules. We
    // compute the eligible patient-ID set in-process: groupBy completed
    // appointments by patient → classify → keep only IDs in the target
    // bucket, then layer `id: { in: ids }` on the main query.
    //
    // `tab === "all"` skips this step and falls through to the plain
    // doctor-caseload filter above.
    if (q.tab !== "all") {
      const grouped = await prisma.appointment.groupBy({
        by: ["patientId"],
        where: { doctorId, status: "COMPLETED" },
        _count: { _all: true },
        _max: { completedAt: true, date: true },
      });
      const nowMs = now.getTime();
      const target = q.tab as DoctorSegmentKey;
      const eligibleIds: string[] = [];
      for (const row of grouped) {
        const last = row._max.completedAt ?? row._max.date;
        if (!last) continue;
        const days = Math.floor((nowMs - last.getTime()) / DAY_MS);
        if (classifyDoctorSegment(row._count._all, days) === target) {
          eligibleIds.push(row.patientId);
        }
      }
      if (eligibleIds.length === 0) {
        // Short-circuit — the segment is empty, no further work needed.
        return ok({ rows: [], nextCursor: null, total: 0 });
      }
      // `id IN (...)` already implies "had a completed visit with this
      // doctor" — every id came from `groupBy(doctorId, COMPLETED)` above —
      // so drop the redundant `appointments.some` join filter.
      delete where.appointments;
      where.id = { in: eligibleIds };
    }

    // ── Page the patients ─────────────────────────────────────────────────
    // Order by `lastVisitAt` desc — this is the clinic-wide last-visit
    // timestamp on Patient, not the per-doctor one, but it's close enough
    // for the doctor's caseload sort. Cursor on `id` to keep pagination
    // deterministic when many patients share the same lastVisitAt.
    const take = q.limit + 1;
    const rows = await prisma.patient.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        photoUrl: true,
        birthDate: true,
        phone: true,
        segment: true,
        lastVisitAt: true,
      },
      orderBy: [{ lastVisitAt: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    const patientIds = rows.map((p) => p.id);

    // ── Enrichment ────────────────────────────────────────────────────────
    // 1. Last COMPLETED appointment per patient + its VisitNote diagnosis.
    // 2. Next BOOKED/WAITING appointment in the future per patient.
    // 3. Whether the patient currently has an IN_PROGRESS appointment.
    //
    // Each query returns at most O(patientIds.length) rows because we sort
    // and take the first per patient in JS — Prisma can't express
    // DISTINCT ON without raw SQL.
    let lastCompletedMap = new Map<
      string,
      { date: Date; diagnosisCode: string | null; diagnosisName: string | null }
    >();
    let nextBookedMap = new Map<string, Date>();
    let inProgressSet = new Set<string>();

    if (patientIds.length > 0) {
      const [completed, booked, inProgress] = await Promise.all([
        prisma.appointment.findMany({
          where: {
            doctorId,
            patientId: { in: patientIds },
            status: "COMPLETED",
          },
          select: {
            patientId: true,
            date: true,
            visitNote: {
              select: { diagnosisCode: true, diagnosisName: true },
            },
          },
          orderBy: [{ patientId: "asc" }, { date: "desc" }],
        }),
        prisma.appointment.findMany({
          where: {
            doctorId,
            patientId: { in: patientIds },
            status: { in: ["BOOKED", "WAITING"] },
            date: { gte: now },
          },
          select: { patientId: true, date: true },
          orderBy: [{ patientId: "asc" }, { date: "asc" }],
        }),
        prisma.appointment.findMany({
          where: {
            doctorId,
            patientId: { in: patientIds },
            status: "IN_PROGRESS",
          },
          select: { patientId: true },
        }),
      ]);

      for (const a of completed) {
        // findMany is sorted by patientId asc then date desc → the FIRST
        // row we see per patientId is the most recent.
        if (lastCompletedMap.has(a.patientId)) continue;
        lastCompletedMap.set(a.patientId, {
          date: a.date,
          diagnosisCode: a.visitNote?.diagnosisCode ?? null,
          diagnosisName: a.visitNote?.diagnosisName ?? null,
        });
      }
      for (const a of booked) {
        if (nextBookedMap.has(a.patientId)) continue; // earliest future
        nextBookedMap.set(a.patientId, a.date);
      }
      for (const a of inProgress) inProgressSet.add(a.patientId);
    }

    const out: DoctorPatientRow[] = rows.map((p) => {
      const last = lastCompletedMap.get(p.id);
      const next = nextBookedMap.get(p.id);
      return {
        id: p.id,
        fullName: p.fullName,
        photoUrl: p.photoUrl,
        birthDate: p.birthDate ? p.birthDate.toISOString() : null,
        phone: p.phone,
        segment: p.segment,
        hasActiveAppointment: inProgressSet.has(p.id),
        lastVisitWithMeAt: last ? last.date.toISOString() : null,
        lastDiagnosisCode: last?.diagnosisCode ?? null,
        lastDiagnosisName: last?.diagnosisName ?? null,
        nextAppointmentWithMeAt: next ? next.toISOString() : null,
      };
    });

    const total = await prisma.patient.count({ where });

    return ok({ rows: out, nextCursor, total });
  },
);

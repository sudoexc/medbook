/**
 * /api/crm/analytics/funnels — Phase 8a conversion-funnel KPIs.
 *
 *   - tg:        TG → appointment %  (sparkline + total/converted counts)
 *   - call:      Call → appointment % (sparkline + total/converted counts)
 *   - noShow:    top-10 doctors / top-10 services by no-show rate
 *   - waitTime:  per-doctor average WAITING → IN_PROGRESS in seconds
 *
 * Period:
 *   ?period=week|month|quarter
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * RBAC: ADMIN + DOCTOR (matches the parent /api/crm/analytics endpoint —
 * doctor sees the full set; the dashboard hides what isn't relevant). The
 * heavy aggregations are bounded by the time window so doctor scope doesn't
 * win us much, but we keep the role list aligned with the existing route
 * to avoid surprising the frontend.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import {
  addDays,
  resolveAnalyticsRange,
} from "@/server/analytics/range";
import {
  computeAverageWaitTime,
  computeCallFunnel,
  computeNoShowRanks,
  computeTgFunnel,
} from "@/server/analytics/funnels";

const FUNNEL_LOOKAHEAD_DAYS = 7;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request }) => {
    const url = new URL(request.url);
    const { from, to, period } = resolveAnalyticsRange(url);

    const ctx = getTenant();
    const clinicId =
      ctx?.kind === "TENANT" ? ctx.clinicId : null;

    // Doctor scope (mirrors /api/crm/analytics): a DOCTOR only sees their
    // own slice for no-show + wait-time. Funnel KPIs (TG/Call) are
    // clinic-wide either way — they describe top-of-funnel acquisition,
    // not the doctor's individual practice.
    const userId =
      ctx?.kind === "TENANT" && ctx.role === "DOCTOR" ? ctx.userId : null;
    const doctorFilter = userId
      ? await prisma.doctor.findFirst({
          where: { userId },
          select: { id: true },
        })
      : null;
    const doctorId = doctorFilter?.id ?? null;

    // ── 1. TG funnel ────────────────────────────────────────────────────
    // Conversations in window with at least one IN-direction message.
    // We need each conversation's earliest IN-message createdAt for the
    // anchor.
    //
    // The Prisma tenant extension scopes by clinicId automatically, but we
    // pass `clinicId` explicitly here so the multi-tenant invariant is
    // visible at the call-site (and to make the query plan less reliant
    // on the extension's behavior).
    const tgConversationsRaw = clinicId
      ? await prisma.conversation.findMany({
          where: {
            clinicId,
            channel: "TG",
            messages: {
              some: { direction: "IN", createdAt: { gte: from, lt: to } },
            },
          },
          select: {
            id: true,
            patientId: true,
            messages: {
              where: { direction: "IN", createdAt: { gte: from, lt: to } },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        })
      : [];

    const tgConversations = tgConversationsRaw
      .filter((c) => c.messages.length > 0)
      .map((c) => ({
        id: c.id,
        patientId: c.patientId,
        firstInboundAt: c.messages[0]!.createdAt,
      }));

    // Appointments to test for "booked within ≤7 days after the anchor".
    // We need anything created in `[from, to + 7d)` because a conversation
    // anchored on `to - 1d` could be matched by an appointment created up
    // to 7 days later.
    const apptLookahead = addDays(to, FUNNEL_LOOKAHEAD_DAYS);
    const conversionAppts = clinicId
      ? await prisma.appointment.findMany({
          where: {
            clinicId,
            createdAt: { gte: from, lt: apptLookahead },
          },
          select: { patientId: true, createdAt: true, status: true },
        })
      : [];

    const tg = computeTgFunnel({
      window: { from, to },
      conversations: tgConversations,
      appointments: conversionAppts,
      windowDays: FUNNEL_LOOKAHEAD_DAYS,
    });

    // ── 2. Call funnel ───────────────────────────────────────────────────
    // "Completed-equivalent" call: not MISSED and durationSec > 0 (real
    // talk happened). Anonymous calls without a patientId still count
    // toward the denominator but never the numerator.
    const callsRaw = clinicId
      ? await prisma.call.findMany({
          where: {
            clinicId,
            createdAt: { gte: from, lt: to },
          },
          select: {
            id: true,
            patientId: true,
            createdAt: true,
            direction: true,
            durationSec: true,
          },
        })
      : [];

    const calls = callsRaw.map((c) => ({
      id: c.id,
      patientId: c.patientId,
      createdAt: c.createdAt,
      completed: c.direction !== "MISSED" && (c.durationSec ?? 0) > 0,
    }));

    const call = computeCallFunnel({
      window: { from, to },
      calls,
      appointments: conversionAppts,
      windowDays: FUNNEL_LOOKAHEAD_DAYS,
    });

    // ── 3. No-show by doctor / service ───────────────────────────────────
    const noShowAppts = clinicId
      ? await prisma.appointment.findMany({
          where: {
            clinicId,
            date: { gte: from, lt: to },
            status: { in: ["COMPLETED", "NO_SHOW"] },
            ...(doctorId ? { doctorId } : {}),
          },
          select: { doctorId: true, serviceId: true, status: true },
        })
      : [];

    const noShowRanks = computeNoShowRanks({
      appointments: noShowAppts,
      limit: 10,
    });

    // Hydrate display names (single round-trip per ranking).
    const doctorIds = noShowRanks.byDoctor.map((r) => r.id);
    const serviceIds = noShowRanks.byService.map((r) => r.id);
    const [doctorRows, serviceRows] = await Promise.all([
      doctorIds.length
        ? prisma.doctor.findMany({
            where: { id: { in: doctorIds } },
            select: { id: true, nameRu: true, nameUz: true },
          })
        : Promise.resolve([]),
      serviceIds.length
        ? prisma.service.findMany({
            where: { id: { in: serviceIds } },
            select: { id: true, nameRu: true, nameUz: true },
          })
        : Promise.resolve([]),
    ]);
    const doctorById = new Map(doctorRows.map((d) => [d.id, d]));
    const serviceById = new Map(serviceRows.map((s) => [s.id, s]));

    const noShowByDoctor = noShowRanks.byDoctor.map((r) => {
      const d = doctorById.get(r.id);
      return {
        doctorId: r.id,
        name: d?.nameRu ?? r.id,
        nameUz: d?.nameUz ?? null,
        rate: r.rate,
        noShow: r.noShow,
        completed: r.completed,
        total: r.total,
      };
    });
    const noShowByService = noShowRanks.byService.map((r) => {
      const s = serviceById.get(r.id);
      return {
        serviceId: r.id,
        name: s?.nameRu ?? r.id,
        nameUz: s?.nameUz ?? null,
        rate: r.rate,
        noShow: r.noShow,
        completed: r.completed,
        total: r.total,
      };
    });

    // ── 4. Average wait time per doctor ─────────────────────────────────
    const waitAppts = clinicId
      ? await prisma.appointment.findMany({
          where: {
            clinicId,
            date: { gte: from, lt: to },
            calledAt: { not: null },
            startedAt: { not: null },
            ...(doctorId ? { doctorId } : {}),
          },
          select: { doctorId: true, calledAt: true, startedAt: true },
        })
      : [];

    const waitTimeRaw = computeAverageWaitTime({ appointments: waitAppts });
    const waitDoctorIds = waitTimeRaw.map((w) => w.doctorId);
    const waitDoctorRows = waitDoctorIds.length
      ? await prisma.doctor.findMany({
          where: { id: { in: waitDoctorIds } },
          select: { id: true, nameRu: true, nameUz: true },
        })
      : [];
    const waitDocById = new Map(waitDoctorRows.map((d) => [d.id, d]));
    const waitTime = waitTimeRaw.map((w) => {
      const d = waitDocById.get(w.doctorId);
      return {
        doctorId: w.doctorId,
        name: d?.nameRu ?? w.doctorId,
        nameUz: d?.nameUz ?? null,
        avgWaitSec: w.avgWaitSec,
        samples: w.samples,
      };
    });

    return ok({
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      doctorOnly: Boolean(doctorId),
      windowDays: FUNNEL_LOOKAHEAD_DAYS,
      tg,
      call,
      noShowByDoctor,
      noShowByService,
      waitTime,
      // Mini App booking funnel drop-off — INTENTIONALLY NOT IMPLEMENTED.
      // See `src/server/analytics/funnels.ts` header for the rationale
      // (no per-step events tracked; would need a new MiniAppEvent table
      // and instrumentation in /api/miniapp/{slots,appointments}).
      miniAppFunnel: null,
    });
  },
);

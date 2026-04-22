/**
 * /api/crm/payments — list + create.
 * See docs/TZ.md §6.2 оплата.
 *
 * POST upserts a payment. If the created/updated row is PAID and has
 * a patientId, we synchronously recompute Patient.ltv via recalcLtv().
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, parseQuery } from "@/server/http";
import {
  CreatePaymentSchema,
  QueryPaymentSchema,
} from "@/server/schemas/payment";
import { recalcLtv } from "@/server/services/ltv";
import { fireTrigger } from "@/server/notifications/triggers";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryPaymentSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.method) where.method = q.method;
    if (q.patientId) where.patientId = q.patientId;
    if (q.appointmentId) where.appointmentId = q.appointmentId;
    if (q.from || q.to) {
      where.paidAt = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }

    const take = q.limit + 1;
    const rows = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        appointment: { select: { id: true, date: true, doctorId: true } },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    const total = await prisma.payment.count({ where });
    return ok({ rows, nextCursor, total });
  }
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: CreatePaymentSchema,
  },
  async ({ request, body }) => {
    const data: Record<string, unknown> = {
      currency: body.currency,
      amount: body.amount,
      method: body.method,
      status: body.status,
      appointmentId: body.appointmentId ?? null,
      patientId: body.patientId ?? null,
      receiptNumber: body.receiptNumber ?? null,
      receiptUrl: body.receiptUrl ?? null,
      externalRef: body.externalRef ?? null,
      paidAt: body.status === "PAID" ? (body.paidAt ?? new Date()) : body.paidAt ?? null,
    };

    // Attach USD snapshot via latest FX rate for reporting.
    if (body.currency === "USD") {
      const rate = await prisma.exchangeRate.findFirst({
        orderBy: { date: "desc" },
        select: { rateUsd: true },
      });
      if (rate) {
        data.fxRate = rate.rateUsd;
        data.amountUsdSnap = body.amount;
      }
    } else {
      const rate = await prisma.exchangeRate.findFirst({
        orderBy: { date: "desc" },
        select: { rateUsd: true },
      });
      if (rate) {
        data.fxRate = rate.rateUsd;
        data.amountUsdSnap = Math.round(
          body.amount * Number(rate.rateUsd)
        );
      }
    }

    const created = await prisma.payment.create({ data: data as never });

    // Fallback: derive patientId from the appointment if not provided directly.
    let patientId = created.patientId;
    if (!patientId && created.appointmentId) {
      const appt = await prisma.appointment.findUnique({
        where: { id: created.appointmentId },
        select: { patientId: true },
      });
      patientId = appt?.patientId ?? null;
      if (patientId) {
        await prisma.payment.update({
          where: { id: created.id },
          data: { patientId },
        });
      }
    }

    if (created.status === "PAID" && patientId) {
      try {
        await recalcLtv(patientId);
      } catch (e) {
        console.error("[payments.POST] recalcLtv failed", e);
      }
      // Phase 3a: cancel any pending payment.due notifications for this
      // appointment since the patient just paid.
      fireTrigger({
        kind: "payment.paid",
        appointmentId: created.appointmentId ?? null,
      });
      const tenant = getTenant();
      const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
      if (clinicId) {
        publishEventSafe(clinicId, {
          type: "payment.paid",
          payload: {
            paymentId: created.id,
            appointmentId: created.appointmentId ?? null,
            patientId,
            amount: created.amount,
            currency: created.currency,
            status: created.status,
          },
        });
      }
    }

    await audit(request, {
      action: "payment.create",
      entityType: "Payment",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);

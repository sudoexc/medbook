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
import { ok, err, parseQuery } from "@/server/http";
import {
  CreatePaymentSchema,
  QueryPaymentSchema,
} from "@/server/schemas/payment";
import { recalcLtv } from "@/server/services/ltv";
import { fireTrigger } from "@/server/notifications/triggers";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";
import { tiyinToUsdCents, uzsPerUsd } from "@/lib/fx";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryPaymentSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    // Privacy guard: DOCTOR and CALL_OPERATOR can only inspect a single
    // patient's payments (e.g. inside the patient card). Unscoped clinic-wide
    // listing is reserved for ADMIN / RECEPTIONIST who actually need it for
    // reconciliation. Without this, the patient-card payments tab keeps
    // working but a curious doctor cannot dump the whole cashflow.
    if (
      ctx.kind === "TENANT" &&
      (ctx.role === "DOCTOR" || ctx.role === "CALL_OPERATOR") &&
      !q.patientId
    ) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

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
    // Resolve the idempotency key. Body wins; otherwise fall back to the
    // standard `Idempotency-Key` HTTP header so well-behaved clients don't
    // need a payload change. Trim + cap length defensively.
    const headerKey = request.headers.get("idempotency-key");
    const rawKey =
      (typeof body.idempotencyKey === "string" && body.idempotencyKey) ||
      (headerKey && headerKey.trim()) ||
      null;
    const idempotencyKey = rawKey ? rawKey.trim().slice(0, 200) : null;

    // If the caller supplied a key and we already have a payment for it in
    // this clinic, return the original row. Mirrors how POST acts when the
    // unique index fires below — but cheaper, with no failed insert.
    if (idempotencyKey) {
      const existing = await prisma.payment.findFirst({
        where: { idempotencyKey },
      });
      if (existing) return ok(existing, 200);
    }

    // A payment for a visit is what every visit-level number reads: the
    // doctor's revenue, «Топ врачей», the drawer's payments, the «Неоплаченные»
    // filter and the paid-visit price lock (audit AN-02). The visit must be
    // this clinic's (the tenant scope) and this patient's: a payment filed
    // under another patient's visit would mark that visit paid.
    let patientId = body.patientId ?? null;
    if (body.appointmentId) {
      const appt = await prisma.appointment.findUnique({
        where: { id: body.appointmentId },
        select: { patientId: true },
      });
      if (!appt) {
        return err("ValidationError", 422, { reason: "appointment_not_found" });
      }
      if (patientId && appt.patientId !== patientId) {
        return err("ValidationError", 422, {
          reason: "appointment_patient_mismatch",
        });
      }
      patientId = appt.patientId;
    }

    const data: Record<string, unknown> = {
      currency: body.currency,
      amount: body.amount,
      method: body.method,
      status: body.status,
      appointmentId: body.appointmentId ?? null,
      patientId,
      receiptNumber: body.receiptNumber ?? null,
      receiptUrl: body.receiptUrl ?? null,
      externalRef: body.externalRef ?? null,
      idempotencyKey,
      paidAt: body.status === "PAID" ? (body.paidAt ?? new Date()) : body.paidAt ?? null,
    };

    // USD snapshot for reporting, from the latest rate in the one convention
    // (сум per 1 USD, audit AN-01). A missing or implausible rate leaves the
    // snapshot empty: reporting must never be the reason a payment fails.
    const latest = await prisma.exchangeRate.findFirst({
      orderBy: { date: "desc" },
      select: { rateUsd: true },
    });
    const rate = uzsPerUsd(latest?.rateUsd);
    if (rate !== null) {
      data.fxRate = rate;
      data.amountUsdSnap =
        body.currency === "USD"
          ? body.amount
          : tiyinToUsdCents(body.amount, rate);
    }

    let created;
    try {
      created = await prisma.payment.create({ data: data as never });
    } catch (e: unknown) {
      // Unique-constraint race: another concurrent request already inserted
      // a payment for this same (clinicId, idempotencyKey). Return that row.
      const code = (e as { code?: string } | null)?.code;
      if (code === "P2002" && idempotencyKey) {
        const existing = await prisma.payment.findFirst({
          where: { idempotencyKey },
        });
        if (existing) return ok(existing, 200);
      }
      throw e;
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

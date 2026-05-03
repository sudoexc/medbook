/**
 * /api/crm/payments/[id] — patch (status/refund/etc).
 * See docs/TZ.md §6.2 оплата.
 *
 * When status transitions to/from PAID we recompute the patient LTV.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdatePaymentSchema } from "@/server/schemas/payment";
import { recalcLtv } from "@/server/services/ltv";
import { fireTrigger } from "@/server/notifications/triggers";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST"], bodySchema: UpdatePaymentSchema },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.payment.findUnique({ where: { id } });
    if (!before) return notFound();

    // Cap refund at the payment amount. Prisma stores amount as Int (minor
    // units) so a direct compare is safe.
    if (typeof body.refundedAmount === "number") {
      const targetAmount =
        typeof body.amount === "number" ? body.amount : before.amount;
      if (body.refundedAmount > targetAmount) {
        return err("ValidationError", 422, {
          reason: "refund_exceeds_amount",
          amount: targetAmount,
          refundedAmount: body.refundedAmount,
        });
      }
    }

    const data: Record<string, unknown> = { ...body };
    if (
      body.status === "PAID" &&
      before.status !== "PAID" &&
      body.paidAt === undefined
    ) {
      data.paidAt = new Date();
    }

    const after = await prisma.payment.update({
      where: { id },
      data: data as never,
    });

    const ltvShouldRecalc =
      before.status !== after.status &&
      (before.status === "PAID" || after.status === "PAID");
    if (ltvShouldRecalc && after.patientId) {
      try {
        await recalcLtv(after.patientId);
      } catch (e) {
        console.error("[payments.PATCH] recalcLtv failed", e);
      }
    }

    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "payment.update",
      entityType: "Payment",
      entityId: id,
      meta: d,
    });
    if (before.status !== "PAID" && after.status === "PAID") {
      fireTrigger({
        kind: "payment.paid",
        appointmentId: after.appointmentId ?? null,
      });
      const tenant = getTenant();
      const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
      if (clinicId) {
        publishEventSafe(clinicId, {
          type: "payment.paid",
          payload: {
            paymentId: after.id,
            appointmentId: after.appointmentId ?? null,
            patientId: after.patientId ?? null,
            amount: after.amount,
            currency: after.currency,
            status: after.status,
          },
        });
      }
    }
    return ok(after);
  }
);

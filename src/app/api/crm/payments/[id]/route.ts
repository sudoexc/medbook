/**
 * /api/crm/payments/[id] — patch (status/refund/etc).
 * See docs/TZ.md §6.2 оплата.
 *
 * What a change may do is decided by `planPaymentUpdate` (audit AN-11): an
 * amount correction is ADMIN-only and only before a refund, a refund is
 * recorded once with its date, REFUNDED is final. Any change to the money
 * (amount, refund, status) recomputes the patient LTV. The write is
 * conditional on the values the plan was made from, so two people refunding
 * the same payment at once cannot both succeed.
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
import { tiyinToUsdCents } from "@/lib/fx";
import { retireSettledDebt } from "@/server/actions/settled-debt";
import { planPaymentUpdate } from "@/server/payments/payment-update";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST"], bodySchema: UpdatePaymentSchema },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.payment.findUnique({ where: { id } });
    if (!before) return notFound();

    const role = ctx.kind === "TENANT" ? ctx.role : "SUPER_ADMIN";
    const plan = planPaymentUpdate(
      {
        status: before.status,
        amount: before.amount,
        refundedAmount: before.refundedAmount,
        refundedAt: before.refundedAt,
        paidAt: before.paidAt,
      },
      body,
      role,
      new Date(),
    );
    if (!plan.ok) {
      return err(
        plan.status === 403 ? "Forbidden" : "ValidationError",
        plan.status,
        { reason: plan.reason },
      );
    }

    const data = plan.data;
    if (typeof data.amount === "number") {
      // The USD snapshot follows the corrected amount at the rate the
      // payment was taken at (сум per 1 USD, audit AN-01).
      data.amountUsdSnap =
        before.currency === "USD"
          ? data.amount
          : tiyinToUsdCents(data.amount, before.fxRate);
    }

    // Conditional on what the plan was made from: a concurrent refund or
    // correction makes this one a no-op and the caller gets 409.
    const written = await prisma.payment.updateMany({
      where: {
        id,
        status: before.status,
        amount: before.amount,
        refundedAmount: before.refundedAmount,
      },
      data: data as never,
    });
    if (written.count === 0) {
      return err("Conflict", 409, { reason: "payment_changed" });
    }
    const after = await prisma.payment.findUnique({ where: { id } });
    if (!after) return notFound();

    if (plan.moneyChanged && after.patientId) {
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
      // A paid visit is no longer a «задолженность» (audit AC-17). Never
      // throws.
      if (clinicId && after.appointmentId) {
        await retireSettledDebt(prisma, clinicId, after.appointmentId);
      }
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

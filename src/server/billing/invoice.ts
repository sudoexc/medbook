/**
 * Phase 19 Wave 3 — invoice lifecycle for plan upgrades.
 *
 * Two operations:
 *
 *   - `createUpgradeInvoice({ clinicId, fromPlanId, toPlanId, now })`
 *     mints a DRAFT Invoice and stamps `Subscription.pendingPlanId =
 *     toPlanId`. Amount is the destination plan's full monthly price
 *     (no proration in the MVP — the gap between an inflight period
 *     and a freshly-billed full month is small enough not to warrant
 *     the complexity at this stage). One audit row is emitted with
 *     `INVOICE_CREATED`.
 *
 *   - `markInvoicePaid(invoiceId, paymentRef, opts)` flips the row to
 *     PAID, sets `paidAt` + `paymentRef`, and swaps the subscription's
 *     `planId` to the invoice's own `targetPlanId` (NOT to whatever
 *     `pendingPlanId` holds at payment time, so paying an older invoice
 *     can't grant a newer queued plan). `opts.expectedAmountTiins`, when
 *     supplied by the webhook, must equal the invoice amount or the call
 *     throws. The status flip is an atomic conditional updateMany, so the
 *     function is idempotent and race-safe under webhook redelivery.
 *
 * Both helpers run inside `runWithTenant({ kind: "SYSTEM" })` so the
 * tenant-scope Prisma extension does not double-filter — the caller is
 * the platform / the webhook / a stub button, not a logged-in tenant
 * user. Audit rows still carry the `clinicId` explicitly.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 30;
const DUE_DAYS = 7;

export interface CreateUpgradeInvoiceOpts {
  clinicId: string;
  fromPlanId: string;
  toPlanId: string;
  now?: Date;
}

export interface CreateUpgradeInvoiceResult {
  invoiceId: string;
  number: string;
  amountTiins: bigint;
}

/**
 * Convert `Plan.priceMonth` (Decimal in UZS) to tiins (×100). We round
 * to the nearest tiin to absorb floating-point noise from the Prisma
 * Decimal → Number coercion. Plans are seeded as integer-soum values
 * today so the rounding is a no-op in practice.
 */
function priceMonthToTiins(priceMonth: { toString: () => string }): bigint {
  // Decimal → string → cents-style integer math, no floats.
  const s = priceMonth.toString();
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const tiins = BigInt(whole) * BigInt(100) + BigInt(fracPadded || "0");
  return tiins;
}

export async function createUpgradeInvoice(
  opts: CreateUpgradeInvoiceOpts,
): Promise<CreateUpgradeInvoiceResult> {
  const now = opts.now ?? new Date();
  const periodStart = now;
  const periodEnd = new Date(now.getTime() + PERIOD_DAYS * ONE_DAY_MS);
  const dueAt = new Date(now.getTime() + DUE_DAYS * ONE_DAY_MS);

  // Lazy import keeps the module DAG identical to the other billing
  // helpers and lets the test mocks intercept `nextInvoiceNumber`.
  const { nextInvoiceNumber } = await import(
    "@/server/billing/invoice-number"
  );

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const toPlan = await prisma.plan.findUnique({
      where: { id: opts.toPlanId },
      select: { priceMonth: true, slug: true, currency: true },
    });
    if (!toPlan) {
      throw new Error(`Plan not found: ${opts.toPlanId}`);
    }

    const amountTiins = priceMonthToTiins(toPlan.priceMonth);
    const number = await nextInvoiceNumber(opts.clinicId, now.getUTCFullYear());

    const invoice = await prisma.invoice.create({
      data: {
        clinicId: opts.clinicId,
        number,
        status: "DRAFT",
        amountTiins,
        currency: toPlan.currency,
        // Bind the destination plan to the invoice itself — the PAID handler
        // upgrades to this, regardless of any newer pending upgrade.
        targetPlanId: opts.toPlanId,
        periodStart,
        periodEnd,
        dueAt,
      },
      select: { id: true, number: true, amountTiins: true },
    });

    // Stamp pendingPlanId so the billing UI shows "upgrade pending
    // payment". The actual planId swap happens in `markInvoicePaid`.
    await prisma.subscription.update({
      where: { clinicId: opts.clinicId },
      data: { pendingPlanId: opts.toPlanId },
    });

    try {
      await prisma.auditLog.create({
        data: {
          clinicId: opts.clinicId,
          action: AUDIT_ACTION.INVOICE_CREATED,
          entityType: "Invoice",
          entityId: invoice.id,
          meta: {
            number: invoice.number,
            fromPlanId: opts.fromPlanId,
            toPlanId: opts.toPlanId,
            amountTiins: invoice.amountTiins.toString(),
            planSlug: toPlan.slug,
          },
        },
      });
    } catch (err) {
      console.warn("[invoice] audit INVOICE_CREATED failed", err);
    }

    return {
      invoiceId: invoice.id,
      number: invoice.number,
      amountTiins: invoice.amountTiins,
    };
  });
}

export interface MarkInvoicePaidOpts {
  /**
   * Amount the payment provider reported charging, in tiins. When present it
   * MUST equal the invoice amount or the call throws — a mismatch means a
   * tampered/misrouted webhook, never a legitimate payment for this invoice.
   * Omitted by the dev simulate-pay stub, which trusts itself.
   */
  expectedAmountTiins?: bigint;
  now?: Date;
}

export async function markInvoicePaid(
  invoiceId: string,
  paymentRef: string,
  opts: MarkInvoicePaidOpts = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        clinicId: true,
        status: true,
        number: true,
        amountTiins: true,
        targetPlanId: true,
      },
    });
    if (!inv) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }
    if (inv.status === "PAID") {
      // Fast-path idempotency — webhook redelivery is the common cause. The
      // atomic updateMany below is the authoritative guard against races.
      return;
    }

    if (
      opts.expectedAmountTiins !== undefined &&
      opts.expectedAmountTiins !== inv.amountTiins
    ) {
      throw new Error(
        `Invoice ${invoiceId} amount mismatch: expected ${inv.amountTiins.toString()} ` +
          `got ${opts.expectedAmountTiins.toString()}`,
      );
    }

    // Atomic, race-safe flip: only the writer that actually transitions the
    // row out of its non-PAID state proceeds to swap the plan and emit audit.
    // A concurrent redelivery sees count=0 and no-ops — no double upgrade, no
    // duplicate audit row.
    const flipped = await prisma.invoice.updateMany({
      where: { id: invoiceId, status: { not: "PAID" } },
      data: { status: "PAID", paidAt: now, paymentRef },
    });
    if (flipped.count === 0) {
      return;
    }

    // Swap the subscription to the plan bound to THIS invoice (not whatever
    // pendingPlanId currently holds). Only clear pendingPlanId when it still
    // points at this same plan — a newer queued upgrade must survive so its
    // own invoice can still be paid.
    const sub = await prisma.subscription.findUnique({
      where: { clinicId: inv.clinicId },
      select: { id: true, planId: true, pendingPlanId: true },
    });
    const previousPlanId = sub?.planId ?? null;
    let newPlanId = previousPlanId;
    if (sub && inv.targetPlanId) {
      newPlanId = inv.targetPlanId;
      await prisma.subscription.update({
        where: { clinicId: inv.clinicId },
        data: {
          planId: inv.targetPlanId,
          pendingPlanId:
            sub.pendingPlanId === inv.targetPlanId ? null : sub.pendingPlanId,
          status: "ACTIVE",
        },
      });
    }

    try {
      await prisma.auditLog.create({
        data: {
          clinicId: inv.clinicId,
          action: AUDIT_ACTION.INVOICE_PAID,
          entityType: "Invoice",
          entityId: inv.id,
          meta: {
            number: inv.number,
            amountTiins: inv.amountTiins.toString(),
            paymentRef,
            previousPlanId,
            newPlanId,
          },
        },
      });
    } catch (err) {
      console.warn("[invoice] audit INVOICE_PAID failed", err);
    }
  });
}

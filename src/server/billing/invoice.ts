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
 *     `INVOICE_CREATED`. An unpaid invoice for the same plan that is not
 *     overdue yet is handed back instead of a new one, so every click on
 *     «Перейти на …» no longer leaves another DRAFT behind (audit AN-13).
 *     Numbers are per clinic (AN-12); a number taken by a concurrent
 *     invoice is re-read and retried.
 *
 *   - `markInvoicePaid(invoiceId, paymentRef, opts)` flips the row to
 *     PAID, sets `paidAt` + `paymentRef`, and swaps the subscription's
 *     `planId` to the invoice's own `targetPlanId` (NOT to whatever
 *     `pendingPlanId` holds at payment time, so paying an older invoice
 *     can't grant a newer queued plan). `opts.expectedAmountTiins`, when
 *     supplied by the webhook, must equal the invoice amount or the call
 *     throws. The status flip is an atomic conditional updateMany, so the
 *     function is idempotent and race-safe under webhook redelivery. The
 *     subscription becomes ACTIVE until the end of the paid period
 *     (`currentPeriodEndsAt`), after which the trial-expiry scheduler moves
 *     it to PAST_DUE (audit G5-02).
 *
 * Both helpers run inside `runWithTenant({ kind: "SYSTEM" })` so the
 * tenant-scope Prisma extension does not double-filter — the caller is
 * the platform / the webhook / a stub button, not a logged-in tenant
 * user. Audit rows still carry the `clinicId` explicitly.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { tashkentComponents } from "@/lib/booking-validation";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 30;
const DUE_DAYS = 7;
/** Attempts at a fresh number when a concurrent invoice took ours. */
const NUMBER_ATTEMPTS = 3;

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "P2002";
}

/**
 * Where the paid period ends: the invoice's own period, or a full period
 * from the payment when the invoice is paid after its period already ran
 * out (a late payment still buys a month, not a subscription that is
 * overdue the moment it is paid).
 */
export function paidPeriodEnd(invoicePeriodEnd: Date, now: Date): Date {
  return invoicePeriodEnd.getTime() > now.getTime()
    ? invoicePeriodEnd
    : new Date(now.getTime() + PERIOD_DAYS * ONE_DAY_MS);
}

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

    // The same upgrade still waiting for payment: hand it back.
    const open = await prisma.invoice.findFirst({
      where: {
        clinicId: opts.clinicId,
        targetPlanId: opts.toPlanId,
        status: { in: ["DRAFT", "ISSUED"] },
        amountTiins,
        dueAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, amountTiins: true },
    });
    if (open) {
      await prisma.subscription.update({
        where: { clinicId: opts.clinicId },
        data: { pendingPlanId: opts.toPlanId },
      });
      return {
        invoiceId: open.id,
        number: open.number,
        amountTiins: open.amountTiins,
      };
    }

    // The clinic's (Tashkent) year: on 1 January before 05:00 the UTC year
    // is still the old one.
    const year = Number(tashkentComponents(now).date.slice(0, 4));
    let invoice: { id: string; number: string; amountTiins: bigint } | null =
      null;
    for (let attempt = 1; invoice === null; attempt += 1) {
      const number = await nextInvoiceNumber(opts.clinicId, year);
      try {
        invoice = await prisma.invoice.create({
          data: {
            clinicId: opts.clinicId,
            number,
            status: "DRAFT",
            amountTiins,
            currency: toPlan.currency,
            // Bind the destination plan to the invoice itself — the PAID
            // handler upgrades to this, regardless of any newer pending
            // upgrade.
            targetPlanId: opts.toPlanId,
            periodStart,
            periodEnd,
            dueAt,
          },
          select: { id: true, number: true, amountTiins: true },
        });
      } catch (e) {
        // (clinicId, number) is unique: a concurrent invoice took this
        // number between the read and the insert. Read the next one.
        if (!isUniqueViolation(e) || attempt >= NUMBER_ATTEMPTS) throw e;
      }
    }

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
        periodEnd: true,
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
    // A paid invoice buys its period (audit G5-02): ACTIVE until then, the
    // grace clock of a PAST_DUE subscription stops.
    const currentPeriodEndsAt = inv.periodEnd
      ? paidPeriodEnd(inv.periodEnd, now)
      : null;
    if (sub) {
      if (inv.targetPlanId) newPlanId = inv.targetPlanId;
      await prisma.subscription.update({
        where: { clinicId: inv.clinicId },
        data: {
          ...(inv.targetPlanId
            ? {
                planId: inv.targetPlanId,
                pendingPlanId:
                  sub.pendingPlanId === inv.targetPlanId
                    ? null
                    : sub.pendingPlanId,
              }
            : {}),
          status: "ACTIVE",
          graceEndsAt: null,
          cancelledAt: null,
          ...(currentPeriodEndsAt ? { currentPeriodEndsAt } : {}),
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
            currentPeriodEndsAt: currentPeriodEndsAt?.toISOString() ?? null,
          },
        },
      });
    } catch (err) {
      console.warn("[invoice] audit INVOICE_PAID failed", err);
    }
  });
}

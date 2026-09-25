/**
 * Audit AN-01 data fix: one USD rate convention, сум per 1 USD («12600»).
 *
 * Before the fix the code disagreed with itself: the seed stored «USD per
 * сум» (1/12700, which `Decimal(12, 4)` rounded to 0.0001), the payment
 * route multiplied by the rate, LTV divided by it, and the settings screen
 * asked for «12600». This brings the stored data to the one convention the
 * code now uses (`src/lib/fx.ts`):
 *
 *   1. ExchangeRate rows below 1 are the old form. They cannot be inverted
 *      precisely (0.0001 is all that is left of 1/12700; its inverse, 10000,
 *      is 27% off), so they become LEGACY_RATE: default 12700, the rate the
 *      seed meant. The seed was the only writer of such values. Pass
 *      LEGACY_RATE=<сум за $1> to use another.
 *   2. Payment.fxRate: the same mapping; then the snapshot is recomputed
 *      from it: amountUsdSnap = amount for USD, round(тийин / rate) for UZS.
 *      A rate that is still implausible leaves both columns empty, the same
 *      as a payment taken with no rate on file.
 *   3. Patient.ltv of every patient with a PAID USD payment is recomputed
 *      with `computeLtv`, the code `recalcLtv` runs.
 *
 * Rates ≥ 1 outside 1000..100000 are reported and left alone: a person has
 * to say what was meant.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-an01-fx-rate-convention.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-an01-fx-rate-convention.ts
 *   (optionally -e LEGACY_RATE=12650)
 *
 * Idempotent: every value is recomputed and written only when it differs.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { tiyinToUsdCents, uzsPerUsd } from "../src/lib/fx";
import { computeLtv } from "../src/server/services/ltv-compute";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

const LEGACY_RATE = Number(process.env.LEGACY_RATE ?? 12700);
if (uzsPerUsd(LEGACY_RATE) === null) {
  throw new Error(`LEGACY_RATE=${process.env.LEGACY_RATE} is not a plausible сум per 1 USD`);
}

/** The stored rate in the one convention, or null when it cannot be one. */
function corrected(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1) return LEGACY_RATE;
  return uzsPerUsd(n);
}

function sameNumber(a: unknown, b: number | null): boolean {
  if (a === null || a === undefined) return b === null;
  return b !== null && Number(a) === b;
}

async function fixRates(): Promise<void> {
  const rows = await prisma.exchangeRate.findMany({
    select: { id: true, clinicId: true, date: true, rateUsd: true, source: true },
    orderBy: { date: "asc" },
  });
  let changed = 0;
  for (const r of rows) {
    const next = corrected(r.rateUsd);
    const day = r.date.toISOString().slice(0, 10);
    if (next === null) {
      console.log(`  ? rate ${day} (${r.source ?? "manual"}): ${String(r.rateUsd)} is not plausible, left alone`);
      continue;
    }
    if (sameNumber(r.rateUsd, next)) continue;
    changed += 1;
    console.log(`  rate ${day} (${r.source ?? "manual"}): ${String(r.rateUsd)} → ${next}`);
    if (APPLY) {
      await prisma.exchangeRate.update({ where: { id: r.id }, data: { rateUsd: next } });
    }
  }
  console.log(`│ exchange rates: ${rows.length}, ${APPLY ? "fixed" : "to fix"}: ${changed}`);
}

async function fixPayments(): Promise<Set<string>> {
  const rows = await prisma.payment.findMany({
    where: { OR: [{ fxRate: { not: null } }, { amountUsdSnap: { not: null } }] },
    select: {
      id: true,
      currency: true,
      amount: true,
      fxRate: true,
      amountUsdSnap: true,
      status: true,
      patientId: true,
    },
  });
  const usdPatients = new Set<string>();
  let changed = 0;
  for (const p of rows) {
    const rate = corrected(p.fxRate);
    let snap: number | null;
    if (p.currency === "USD") {
      // A USD payment is its own snapshot; the rate only converts it to сум.
      snap = p.amount;
    } else {
      snap = rate === null ? null : tiyinToUsdCents(p.amount, rate);
    }
    const fxRate = p.currency === "USD" || snap !== null ? rate : null;
    if (p.currency === "USD" && p.status === "PAID" && p.patientId) {
      usdPatients.add(p.patientId);
    }
    if (sameNumber(p.fxRate, fxRate) && sameNumber(p.amountUsdSnap, snap)) continue;
    changed += 1;
    console.log(
      `  payment ${p.id} ${p.currency} ${p.amount}: fxRate ${String(p.fxRate)} → ${fxRate}, ` +
        `amountUsdSnap ${String(p.amountUsdSnap)} → ${snap}`,
    );
    if (APPLY) {
      await prisma.payment.update({
        where: { id: p.id },
        data: { fxRate, amountUsdSnap: snap },
      });
    }
  }
  // USD payments without any snapshot still count toward LTV.
  const bare = await prisma.payment.findMany({
    where: { currency: "USD", status: "PAID", patientId: { not: null } },
    select: { patientId: true },
  });
  for (const b of bare) if (b.patientId) usdPatients.add(b.patientId);
  console.log(`│ payments with a snapshot: ${rows.length}, ${APPLY ? "fixed" : "to fix"}: ${changed}`);
  return usdPatients;
}

async function fixLtv(patientIds: Set<string>): Promise<void> {
  let changed = 0;
  for (const id of patientIds) {
    const patient = await prisma.patient.findUnique({
      where: { id },
      select: { clinicId: true, fullName: true, ltv: true },
    });
    if (!patient) continue;
    const [payments, latest] = await Promise.all([
      prisma.payment.findMany({
        where: { patientId: id, status: "PAID" },
        select: { amount: true, currency: true, fxRate: true },
      }),
      prisma.exchangeRate.findFirst({
        where: { clinicId: patient.clinicId },
        orderBy: { date: "desc" },
        select: { rateUsd: true },
      }),
    ]);
    // In a dry run the rows above still hold the old values: convert them
    // the way the apply will have stored them.
    const ltv = computeLtv(
      payments.map((p) => ({ ...p, fxRate: corrected(p.fxRate) })),
      corrected(latest?.rateUsd),
    );
    if (ltv === patient.ltv) continue;
    changed += 1;
    console.log(`  ltv ${patient.fullName}: ${patient.ltv} → ${ltv}`);
    if (APPLY) {
      await prisma.patient.update({ where: { id }, data: { ltv } });
    }
  }
  console.log(`│ patients with USD payments: ${patientIds.size}, ${APPLY ? "fixed" : "to fix"}: ${changed}`);
}

async function main() {
  console.log(`┌─ ${APPLY ? "APPLY" : "DRY RUN"}: USD rate convention (LEGACY_RATE=${LEGACY_RATE})`);
  await fixRates();
  const usdPatients = await fixPayments();
  await fixLtv(usdPatients);
  console.log(`└─ ${APPLY ? "done" : "nothing written; run again with APPLY=1"}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

/**
 * Pre-deploy check for the subscription lifecycle and the API quota guard
 * (audit G5-02, SEC-10; review of 79422ba).
 *
 * That release makes the trial-expiry scheduler close every state (TRIAL or
 * ACTIVE past its date to PAST_DUE with 14 days of grace, PAST_DUE with no
 * grace date gets one, PAST_DUE past its grace to CANCELLED) and makes the
 * CRM's patient create, booking and walk-in call `ensureQuotaForApi`, which
 * answers 402 on Basic limits (50 patients, 100 appointments a month) for a
 * clinic on the Basic plan, with a cancelled subscription or with none.
 * The first tick acts on every existing row, so this shows, before the new
 * app and worker start, what they will do to each clinic.
 *
 * What it prints, per clinic: the subscription (status, plan, dates), the
 * step the first tick takes, the later steps if nobody acts, and the quota
 * guard's answer today and after the last step, with today's counts. Then
 * the check: the clinic named by CLINIC (default neurofax) must be active,
 * with an ACTIVE subscription, no `currentPeriodEndsAt` and a plan that is
 * not Basic, the one state neither the scheduler nor the guard touches.
 * Exit code 2 when it is not (1 is a crash).
 *
 * Dry run (default, writes nothing; run it with the new worker image after
 * the migration, before `docker compose up -d` starts the new app/worker):
 *   docker compose run --rm --no-deps worker npx tsx scripts/subscription-lifecycle-dryrun.ts
 * Every deploy runs it there and stops on a non-zero exit code, the old
 * containers still serving: ops/deploy.sh, and the `[precheck]` step of
 * _deploy.sh in docs/operations/DEPLOY.md.
 * Pin a clinic to an open-ended ACTIVE subscription (CLINIC is required
 * here; PLAN defaults to the plan it is on, and Basic is refused):
 *   docker compose run --rm --no-deps -e APPLY=1 -e CLINIC=neurofax -e PLAN=pro worker npx tsx scripts/subscription-lifecycle-dryrun.ts
 *
 * Idempotent: an already pinned clinic gets no write, and the update only
 * lands while the row is as it was read (a scheduler tick or an admin
 * action in between makes it a no-op to run again). The write is audited
 * (`subscription.update`) with the subscription as it was (`previous`),
 * which the output prints too: setting those values back on
 * /admin/clinics/<id>/billing reverses it.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  PLATFORM_CLINIC_SLUG,
  snapshotOf,
} from "../src/server/platform/subscription-lifecycle";
import {
  guardCounts,
  quotaCountQuery,
  type GuardQuota,
} from "../src/server/billing/quota-rule";
import {
  GUARD_QUOTAS,
  dailyCoreProblems,
  forecastClinic,
  planPinOpenEnded,
  quotaOutcomes,
  type ClinicRow,
  type PlanRow,
  type QuotaOutcome,
} from "./_subscription-lifecycle-plan";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const CLINIC_GIVEN = process.env.CLINIC?.trim() || null;
const CLINIC = CLINIC_GIVEN ?? PLATFORM_CLINIC_SLUG;
const PLAN = process.env.PLAN?.trim() || null;
const TAG = "[sub-lifecycle]";

const iso = (d: Date | null) => (d ? d.toISOString() : "none");

function describeOutcomes(list: QuotaOutcome[]): string {
  return list
    .map((o) =>
      o.counted
        ? `${o.quota} ${o.current}/${o.max}${o.blocks ? " BLOCKS (402)" : " ok"}`
        : `${o.quota} not counted (plan does not block)`,
    )
    .join("; ");
}

async function countsFor(clinicId: string, now: Date): Promise<Record<GuardQuota, number>> {
  // The guard's own count (`quotaCountQuery`), so the forecast matches it.
  const out = { maxPatients: 0, maxAppointmentsPerMonth: 0 };
  for (const quota of GUARD_QUOTAS) {
    const q = quotaCountQuery(clinicId, quota, now);
    out[quota] =
      q.model === "patient"
        ? await prisma.patient.count({ where: q.where })
        : await prisma.appointment.count({ where: q.where });
  }
  return out;
}

async function loadClinics(): Promise<Array<ClinicRow & { updatedAt: Date | null }>> {
  const clinics = await prisma.clinic.findMany({
    select: {
      id: true,
      slug: true,
      nameRu: true,
      active: true,
      subscription: {
        select: {
          id: true,
          status: true,
          planId: true,
          trialEndsAt: true,
          currentPeriodEndsAt: true,
          graceEndsAt: true,
          cancelledAt: true,
          updatedAt: true,
          plan: { select: { id: true, slug: true, isActive: true, features: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return clinics.map((c) => ({
    id: c.id,
    slug: c.slug,
    nameRu: c.nameRu,
    active: c.active,
    updatedAt: c.subscription?.updatedAt ?? null,
    subscription: c.subscription
      ? {
          id: c.subscription.id,
          status: c.subscription.status,
          planId: c.subscription.planId,
          trialEndsAt: c.subscription.trialEndsAt,
          currentPeriodEndsAt: c.subscription.currentPeriodEndsAt,
          graceEndsAt: c.subscription.graceEndsAt,
          cancelledAt: c.subscription.cancelledAt,
          plan: c.subscription.plan,
        }
      : null,
  }));
}

async function report(now: Date): Promise<void> {
  const clinics = await loadClinics();
  console.log(`${TAG} now ${now.toISOString()}${APPLY ? "" : "  DRY RUN, nothing is written"}`);
  console.log(
    `${TAG} clinics: ${clinics.length}, with a subscription: ${clinics.filter((c) => c.subscription).length}`,
  );

  let moved = 0;
  const blockedNow: string[] = [];
  const blockedLater: string[] = [];
  for (const c of clinics) {
    const f = forecastClinic(c, now);
    const needCounts = GUARD_QUOTAS.some(
      (q) => guardCounts(f.nowContext, q) || guardCounts(f.finalContext, q),
    );
    const counts = needCounts
      ? await countsFor(c.id, now)
      : { maxPatients: 0, maxAppointmentsPerMonth: 0 };
    const nowOutcome = quotaOutcomes(f.nowContext, counts);
    const finalOutcome = quotaOutcomes(f.finalContext, counts);

    console.log("");
    console.log(`${c.slug}  «${c.nameRu}»  ${c.active ? "clinic active" : "CLINIC INACTIVE (staff locked out)"}`);
    const s = c.subscription;
    if (!s) {
      console.log("  subscription: NONE (Basic limits)");
    } else {
      console.log(
        `  subscription: ${s.status} on ${s.plan.slug}${s.plan.isActive ? "" : " (plan switched off)"}, ` +
          `trialEndsAt ${iso(s.trialEndsAt)}, currentPeriodEndsAt ${iso(s.currentPeriodEndsAt)}, ` +
          `graceEndsAt ${iso(s.graceEndsAt)}, cancelledAt ${iso(s.cancelledAt)}`,
      );
    }
    if (f.platformClinic) {
      console.log(
        "  first tick: nothing (the platform owner's clinic: the scheduler never moves it, " +
          "it stays as it is until it is pinned)",
      );
    } else if (f.firstTick) {
      moved += 1;
      console.log(
        `  first tick: ${f.firstTick.reason} -> ${f.firstTick.to}` +
          (f.firstTick.data.graceEndsAt ? ` (grace until ${iso(f.firstTick.data.graceEndsAt)})` : ""),
      );
    } else {
      console.log("  first tick: nothing");
    }
    for (const { at, step } of f.steps) {
      if (step === f.firstTick) continue;
      console.log(`  then at ${at.toISOString()}: ${step.reason} -> ${step.to}`);
    }
    console.log(`  quota guard today: ${describeOutcomes(nowOutcome)}`);
    if (f.steps.length > 0) {
      console.log(`  quota guard as ${f.finalStatus}: ${describeOutcomes(finalOutcome)}`);
    }
    if (nowOutcome.some((o) => o.counted && o.blocks)) blockedNow.push(c.slug);
    else if (finalOutcome.some((o) => o.counted && o.blocks)) blockedLater.push(c.slug);
  }

  console.log("");
  console.log(`${TAG} the first tick moves ${moved} subscription(s)`);
  console.log(
    `${TAG} the quota guard blocks today: ${blockedNow.length ? blockedNow.join(", ") : "none"}`,
  );
  console.log(
    `${TAG} the quota guard blocks after the steps above: ${blockedLater.length ? blockedLater.join(", ") : "none"}`,
  );

  const target = clinics.find((c) => c.slug === CLINIC);
  if (!target) {
    console.log(`${TAG} clinic "${CLINIC}": NOT FOUND`);
    process.exitCode = 2;
    return;
  }
  const problems = dailyCoreProblems(target);
  if (problems.length === 0) {
    console.log(`${TAG} clinic "${CLINIC}": SAFE (open-ended ACTIVE on ${target.subscription!.plan.slug})`);
    return;
  }
  console.log(`${TAG} clinic "${CLINIC}": NOT SAFE`);
  for (const p of problems) console.log(`  - ${p}`);
  console.log(
    `${TAG} to pin it: APPLY=1 CLINIC=${CLINIC} PLAN=<pro|enterprise> (see the header of this script)`,
  );
  process.exitCode = 2;
}

async function apply(now: Date): Promise<void> {
  if (!CLINIC_GIVEN) {
    console.error(`${TAG} APPLY=1 needs CLINIC=<slug>, the clinic to pin. Nothing written.`);
    process.exitCode = 2;
    return;
  }
  const clinics = await loadClinics();
  const target = clinics.find((c) => c.slug === CLINIC_GIVEN);
  if (!target) {
    console.error(`${TAG} clinic "${CLINIC_GIVEN}" not found. Nothing written.`);
    process.exitCode = 2;
    return;
  }
  let plan: PlanRow | null = target.subscription?.plan ?? null;
  if (PLAN) {
    plan = await prisma.plan.findUnique({
      where: { slug: PLAN },
      select: { id: true, slug: true, isActive: true, features: true },
    });
  }
  const pin = planPinOpenEnded(target, plan);
  if (!pin.ok) {
    console.error(`${TAG} refused: ${pin.reason}. Nothing written.`);
    process.exitCode = 2;
    return;
  }
  if (pin.action === "none") {
    console.log(`${TAG} "${CLINIC_GIVEN}" is already an open-ended ACTIVE on ${plan!.slug}. Nothing written.`);
    return;
  }

  const previous = target.subscription ? snapshotOf(target.subscription) : null;
  console.log(`${TAG} previous: ${JSON.stringify(previous)}`);
  let subscriptionId: string;
  if (pin.action === "create") {
    // The platform owner's explicit pin for a clinic with no row at all;
    // the app itself only creates TRIALs (`createSubscription`).
    const created = await prisma.subscription.create({
      data: { clinicId: target.id, planId: pin.planId, status: "ACTIVE" },
      select: { id: true },
    });
    subscriptionId = created.id;
  } else {
    const sub = target.subscription!;
    const res = await prisma.subscription.updateMany({
      // Only the row as it was read: a tick or an admin action since wins.
      where: { id: sub.id, status: sub.status, updatedAt: target.updatedAt ?? undefined },
      data: pin.data,
    });
    if (res.count === 0) {
      console.error(`${TAG} the subscription changed since it was read. Nothing written; run again.`);
      process.exitCode = 2;
      return;
    }
    subscriptionId = sub.id;
  }
  await prisma.auditLog.create({
    data: {
      clinicId: target.id,
      action: "subscription.update",
      entityType: "Subscription",
      entityId: subscriptionId,
      meta: {
        previous,
        to: "ACTIVE",
        currentPeriodEndsAt: null,
        planSlug: plan!.slug,
        at: now.toISOString(),
        via: "scripts/subscription-lifecycle-dryrun.ts",
      },
      actorId: null,
      actorRole: null,
      actorLabel: "system",
    },
  });
  console.log(
    `${TAG} "${CLINIC_GIVEN}" is now an open-ended ACTIVE on ${plan!.slug} (${pin.action}).`,
  );
}

async function main() {
  const now = new Date();
  if (APPLY) await apply(now);
  // Always end with the report: after APPLY it shows the pinned state.
  if (process.exitCode === undefined || process.exitCode === 0) await report(now);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

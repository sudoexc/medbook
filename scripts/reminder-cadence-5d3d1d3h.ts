/**
 * TZ-risk-outcomes §7 — one-off data migration to the 5d/3d/1d/3h reminder
 * cascade (offsets -7200 / -4320 / -1440 / -180). Iterates every existing
 * Clinic (neurofax included) and per clinic:
 *
 *   1. Upserts the four canonical cascade rows from
 *      `DEFAULT_APPOINTMENT_TEMPLATES` (keys `appointment.reminder-5d` /
 *      `-3d` / `-24h` / `-3h`). An existing seed row with the same key gets
 *      its `triggerConfig.offsetMin` set to the canonical value (other config
 *      keys and the body text survive). A row an admin created or edited in
 *      the CRM keeps the offset he gave it and is only reported. A row an
 *      admin renamed but left on a canonical offset is detected by offset and
 *      left alone: `whereForTrigger` resolves by enum + offsetMin, not key.
 *   2. Switches off the SEED rows the cascade replaced (audit G2-10, see
 *      `_reminder-cadence-plan.ts`): the ex-canon 5h / 2h / 1h pings and the
 *      seed duplicates of a canonical band (`isActive=false` +
 *      `triggerConfig.enabled=false`, so the dynamic scheduler pass stops
 *      firing them). A template an admin created, edited or moved to another
 *      offset is NEVER switched off: it is printed as `[admin]` and stays on.
 *      (The sweep used to switch off every active template off the four
 *      offsets, admins' «за 1 час» included, while this header said the
 *      opposite.)
 *
 * Idempotent, safe to re-run: creates are keyed on (clinicId, key), updates
 * converge to the same values, already-inactive rows are not read.
 * DRY RUN by default (prints the plan); APPLY=1 writes.
 *
 * Usage (prod, after deploy):
 *
 *   docker compose exec -T worker npx tsx scripts/reminder-cadence-5d3d1d3h.ts
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/reminder-cadence-5d3d1d3h.ts
 *
 * Without docker: from the repo root, with `DATABASE_URL` in env:
 *
 *   APPLY=1 npx tsx scripts/reminder-cadence-5d3d1d3h.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_APPOINTMENT_TEMPLATES } from "../src/server/notifications/default-templates";
import { offsetOf, planCadenceSweep } from "./_reminder-cadence-plan";

const APPLY = process.env.APPLY === "1";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

/** The four canonical cascade keys, in fire order (farthest first). */
const CASCADE_KEYS = [
  "appointment.reminder-5d",
  "appointment.reminder-3d",
  "appointment.reminder-24h",
  "appointment.reminder-3h",
] as const;

/**
 * Templates staff have touched in the CRM: every create and edit there
 * writes an audit row naming the template; seeds write none.
 */
async function staffTouchedTemplates(clinicId: string): Promise<Set<string>> {
  const rows = await prisma.auditLog.findMany({
    where: { clinicId, entityType: "NotificationTemplate", entityId: { not: null } },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  return new Set(rows.map((r) => r.entityId!).filter(Boolean));
}

function mergeConfig(
  triggerConfig: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const cfg =
    triggerConfig && typeof triggerConfig === "object" && !Array.isArray(triggerConfig)
      ? (triggerConfig as Record<string, unknown>)
      : {};
  return { ...cfg, ...patch };
}

async function main() {
  const cascadeDefaults = DEFAULT_APPOINTMENT_TEMPLATES.filter((t) =>
    (CASCADE_KEYS as readonly string[]).includes(t.key),
  );
  if (cascadeDefaults.length !== CASCADE_KEYS.length) {
    throw new Error(
      `expected ${CASCADE_KEYS.length} cascade defaults, got ${cascadeDefaults.length} — default-templates.ts drifted`,
    );
  }

  const clinics = await prisma.clinic.findMany({
    select: { id: true, slug: true, nameRu: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${clinics.length} clinic(s)`);

  let createdCount = 0;
  let updatedCount = 0;
  let retiredCount = 0;
  let skippedCount = 0;
  let leftAloneCount = 0;

  for (const clinic of clinics) {
    const touched = await staffTouchedTemplates(clinic.id);
    const movedConfig = new Map<string, Record<string, unknown>>();
    // 1. Ensure the four cascade rows exist with the canonical offsetMin.
    for (const t of cascadeDefaults) {
      const target = offsetOf(t.triggerConfig);
      if (target === null) throw new Error(`default ${t.key} has no offsetMin`);

      const existing = await prisma.notificationTemplate.findUnique({
        where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
        select: { id: true, triggerConfig: true, createdById: true },
      });

      if (existing) {
        if (offsetOf(existing.triggerConfig) === target) {
          skippedCount += 1;
          console.log(`  [skip]   ${clinic.slug} :: ${t.key} (already ${target})`);
          continue;
        }
        // The admin moved this band himself (audit G2-10): his choice stands.
        if (existing.createdById || touched.has(existing.id)) {
          skippedCount += 1;
          console.log(
            `  [admin]  ${clinic.slug} :: ${t.key} (offset ${offsetOf(existing.triggerConfig)} set in the CRM, left as is)`,
          );
          continue;
        }
        const moved = mergeConfig(existing.triggerConfig, { offsetMin: target });
        // The sweep below plans on the moved offset in a dry run as well.
        movedConfig.set(existing.id, moved);
        if (APPLY) {
          await prisma.notificationTemplate.update({
            where: { id: existing.id },
            data: { triggerConfig: moved as never },
          });
        }
        updatedCount += 1;
        console.log(`  [offset] ${clinic.slug} :: ${t.key} → ${target}`);
        continue;
      }

      // No row under the canonical key — but an admin-renamed row already on
      // the canonical offset serves this band (enum + offsetMin match), so
      // creating a second one would be a duplicate.
      const byOffset = await prisma.notificationTemplate.findFirst({
        where: {
          clinicId: clinic.id,
          trigger: "APPOINTMENT_BEFORE",
          isActive: true,
          triggerConfig: { path: ["offsetMin"], equals: target },
        },
        select: { id: true, key: true },
      });
      if (byOffset) {
        skippedCount += 1;
        console.log(
          `  [skip]   ${clinic.slug} :: ${t.key} (offset ${target} covered by "${byOffset.key}")`,
        );
        continue;
      }

      if (APPLY) {
        await prisma.notificationTemplate.create({
          data: {
            clinicId: clinic.id,
            key: t.key,
            nameRu: t.nameRu,
            nameUz: t.nameUz,
            channel: t.channel,
            category: t.category,
            trigger: t.trigger,
            triggerConfig: (t.triggerConfig ?? undefined) as never,
            bodyRu: t.bodyRu,
            bodyUz: t.bodyUz,
            variables: t.variables,
            isActive: true,
          },
        });
      }
      createdCount += 1;
      console.log(`  [+]      ${clinic.slug} :: ${t.key} (${target})`);
    }

    // 2. Sweep: one row stays on each canonical offset; seed rows the
    //    cascade replaced go off; admin rows stay on (audit G2-10).
    const active = await prisma.notificationTemplate.findMany({
      where: {
        clinicId: clinic.id,
        trigger: "APPOINTMENT_BEFORE",
        isActive: true,
      },
      select: { id: true, key: true, triggerConfig: true, createdById: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const sweep = planCadenceSweep(
      active.map((r) => ({ ...r, triggerConfig: movedConfig.get(r.id) ?? r.triggerConfig })),
      touched,
    );
    for (const row of sweep.retire) {
      if (APPLY) {
        await prisma.notificationTemplate.update({
          where: { id: row.id },
          data: {
            isActive: false,
            triggerConfig: mergeConfig(row.triggerConfig, {
              enabled: false,
            }) as never,
          },
        });
      }
      retiredCount += 1;
      console.log(
        `  [retire] ${clinic.slug} :: ${row.key} (${offsetOf(row.triggerConfig) ?? "no-offset"})`,
      );
    }
    for (const { row, reason } of sweep.leftAlone) {
      leftAloneCount += 1;
      console.log(
        `  [admin]  ${clinic.slug} :: ${row.key} (${offsetOf(row.triggerConfig) ?? "no-offset"}) ` +
          (reason === "admin_duplicate"
            ? "shares a canonical band, left on; the band sends one template"
            : "set up in the CRM, left on"),
      );
    }
  }

  console.log(
    `\nDone. Created: ${createdCount}, updated: ${updatedCount}, retired: ${retiredCount}, ` +
      `admin rows left on: ${leftAloneCount}, skipped: ${skippedCount}` +
      (APPLY ? "" : "\nDRY RUN, nothing written. APPLY=1 writes."),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * TZ-risk-outcomes §7 — one-off data migration to the 5d/3d/1d/3h reminder
 * cascade (offsets -7200 / -4320 / -1440 / -180). Iterates every existing
 * Clinic (neurofax included) and per clinic:
 *
 *   1. Upserts the four canonical cascade rows from
 *      `DEFAULT_APPOINTMENT_TEMPLATES` (keys `appointment.reminder-5d` /
 *      `-3d` / `-24h` / `-3h`). An existing row with the same key gets its
 *      `triggerConfig.offsetMin` forced to the canonical value (other config
 *      keys + admin-edited body text survive). A row an admin renamed but
 *      left on a canonical offset is detected by offset and left alone —
 *      `whereForTrigger` resolves by enum + offsetMin, not key.
 *   2. Retires the ex-canon seeded pings — `appointment.reminder-5h`
 *      (-300) and `appointment.reminder-1h` (-60) — by flipping
 *      `isActive=false` + `triggerConfig.enabled=false`, so the dynamic
 *      scheduler pass doesn't keep firing them on top of the new cascade.
 *      Rows whose offset an admin customised away from the seeded value are
 *      left untouched (they're deliberate dynamic-offset variants).
 *
 * Idempotent — safe to re-run: creates are keyed on (clinicId, key),
 * updates converge to the same values, retires skip already-inactive rows.
 *
 * Usage (prod, after deploy):
 *
 *   docker compose exec -T worker npx tsx scripts/reminder-cadence-5d3d1d3h.ts
 *
 * Without docker: from the repo root, with `DATABASE_URL` in env:
 *
 *   npx tsx scripts/reminder-cadence-5d3d1d3h.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_APPOINTMENT_TEMPLATES } from "../src/server/notifications/default-templates";

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

/** Ex-canon pings to retire — only when still on the seeded offset. */
const RETIRE = [
  { key: "appointment.reminder-5h", offsetMin: -300 },
  { key: "appointment.reminder-1h", offsetMin: -60 },
] as const;

function offsetOf(triggerConfig: unknown): number | null {
  const cfg =
    triggerConfig && typeof triggerConfig === "object" && !Array.isArray(triggerConfig)
      ? (triggerConfig as { offsetMin?: unknown })
      : {};
  return typeof cfg.offsetMin === "number" ? cfg.offsetMin : null;
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

  for (const clinic of clinics) {
    // 1. Ensure the four cascade rows exist with the canonical offsetMin.
    for (const t of cascadeDefaults) {
      const target = offsetOf(t.triggerConfig);
      if (target === null) throw new Error(`default ${t.key} has no offsetMin`);

      const existing = await prisma.notificationTemplate.findUnique({
        where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
        select: { id: true, triggerConfig: true },
      });

      if (existing) {
        if (offsetOf(existing.triggerConfig) === target) {
          skippedCount += 1;
          console.log(`  [skip]   ${clinic.slug} :: ${t.key} (already ${target})`);
          continue;
        }
        await prisma.notificationTemplate.update({
          where: { id: existing.id },
          data: {
            triggerConfig: mergeConfig(existing.triggerConfig, {
              offsetMin: target,
            }) as never,
          },
        });
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
      createdCount += 1;
      console.log(`  [+]      ${clinic.slug} :: ${t.key} (${target})`);
    }

    // 2. Retire the ex-canon 5h/1h pings still sitting on their seeded
    //    offsets — otherwise the dynamic scheduler pass keeps firing them.
    for (const r of RETIRE) {
      const row = await prisma.notificationTemplate.findUnique({
        where: { clinicId_key: { clinicId: clinic.id, key: r.key } },
        select: { id: true, isActive: true, triggerConfig: true },
      });
      if (!row) continue;
      if (offsetOf(row.triggerConfig) !== r.offsetMin) {
        skippedCount += 1;
        console.log(
          `  [skip]   ${clinic.slug} :: ${r.key} (offset customised — left active)`,
        );
        continue;
      }
      if (!row.isActive) {
        skippedCount += 1;
        console.log(`  [skip]   ${clinic.slug} :: ${r.key} (already retired)`);
        continue;
      }
      await prisma.notificationTemplate.update({
        where: { id: row.id },
        data: {
          isActive: false,
          // The UI writes both flags for safety — mirror that here.
          triggerConfig: mergeConfig(row.triggerConfig, {
            enabled: false,
          }) as never,
        },
      });
      retiredCount += 1;
      console.log(`  [retire] ${clinic.slug} :: ${r.key} (${r.offsetMin})`);
    }
  }

  console.log(
    `\nDone. Created: ${createdCount}, updated: ${updatedCount}, retired: ${retiredCount}, skipped: ${skippedCount}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Standalone seed for DoctorPreset rows (local dev / staging).
 *
 * Matches doctors by Russian specialization keyword (not slug), so it works
 * both on the synthetic seed (slugs `neurologist` / `cardiologist`) AND on
 * real clinic data where slugs are surnames. Edit `PRESETS_BY_SLUG` in
 * `_preset-data.ts` to change the bundles.
 *
 * Run: `npx tsx prisma/seed-presets.ts`
 *
 * For production where the standalone Next image has no tsx, generate raw
 * SQL via `prisma/seed-presets-sql.ts` instead.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { PRESETS_BY_SLUG } from "./_preset-data";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MATCHES: { pattern: string; bundle: keyof typeof PRESETS_BY_SLUG }[] = [
  { pattern: "%невролог%", bundle: "neurologist" },
  { pattern: "%кардиолог%", bundle: "cardiologist" },
];

async function main() {
  let total = 0;
  for (const { pattern, bundle } of MATCHES) {
    const presets = PRESETS_BY_SLUG[bundle];
    if (!presets) continue;

    const doctors = await prisma.doctor.findMany({
      where: {
        OR: [
          { specializationRu: { contains: pattern.replace(/%/g, ""), mode: "insensitive" } },
          { slug: bundle },
        ],
      },
      select: { id: true, clinicId: true, slug: true, specializationRu: true },
    });

    for (const d of doctors) {
      await prisma.doctorPreset.deleteMany({
        where: { clinicId: d.clinicId, doctorId: d.id },
      });

      const created = await prisma.doctorPreset.createMany({
        data: presets.map((p, i) => ({
          clinicId: d.clinicId,
          doctorId: d.id,
          field: p.field,
          label: p.label,
          fieldValue: p.fieldValue ?? p.label,
          noteTemplate: p.noteTemplate,
          sortOrder: i,
        })),
      });
      total += created.count;
      console.log(
        `  ${bundle} → ${d.slug} (${d.specializationRu}) — seeded ${created.count} presets`,
      );
    }
  }
  console.log(`Done. ${total} presets total.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

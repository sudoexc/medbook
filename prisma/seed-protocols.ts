/**
 * Seeds the curated GLOBAL ClinicalProtocol rows from `_protocol-data.ts`.
 *
 * Idempotent and additive (audit G2-05): creates the global rows that are
 * missing and refreshes the existing ones in place, keyed by
 * `diagnosisCodePrefix`. Clinic protocols and doctors' personal protocols
 * share the table and the prefixes and are never read, changed or deleted
 * (see `_protocol-seed.ts`). It used to delete every row with a curated
 * prefix, the neurologist's own G43 / M54 protocols included.
 *
 * DRY RUN by default; APPLY=1 writes.
 *   Local: `APPLY=1 npx tsx prisma/seed-protocols.ts`
 *   Prod:  `docker compose exec -e APPLY=1 worker npx tsx prisma/seed-protocols.ts`
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { PROTOCOLS } from "./_protocol-data";
import { seedGlobalProtocols } from "./_protocol-seed";

const APPLY = process.env.APPLY === "1";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const r = await seedGlobalProtocols(prisma, PROTOCOLS, { apply: APPLY });
  console.log(
    `Global clinical protocols: created=${r.created} updated=${r.updated}` +
      (APPLY ? "" : " (dry run, APPLY=1 writes)"),
  );
  if (r.duplicates.length > 0) {
    console.log(
      `Left alone: ${r.duplicates.length} extra global rows share a curated prefix (${r.duplicates.join(", ")}).`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

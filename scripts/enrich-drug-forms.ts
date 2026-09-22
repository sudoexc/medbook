/**
 * Merge dosage forms from the state register into the curated catalog.
 *
 * The register import was deliberately add-only: it must never overwrite the
 * hand-written dosing, indications and interaction data of the curated core.
 * But that also meant the curated rows kept their ORIGINAL form list while
 * the register knew more — acetylcysteine is listed here as powder + tablets
 * while the register also registers an injectable (АЦЦ Инжект). A doctor
 * picking the form during prescribing simply could not choose it.
 *
 * This fills that gap and nothing else: forms and strengths are UNIONED,
 * never replaced, and no other column is touched.
 *
 * Idempotent. DRY RUN by default; APPLY=1 writes.
 *   docker compose run --rm -e APPLY=1 -v /opt/neurofax/scripts:/app/scripts \
 *     -v /opt/neurofax/prisma/uzpharm-registry.json:/app/prisma/uzpharm-registry.json \
 *     worker npx tsx scripts/enrich-drug-forms.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.env.APPLY === "1";

type FormEntry = { form: string; strengths: string[] };
type RegistryEntity = {
  nameRu: string;
  forms: FormEntry[];
  brands: { name: string }[];
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[®™]/g, "").replace(/\s+/g, " ").trim();

/** Strengths differ only by spacing in the register («200мг» vs «200 мг»). */
const normStrength = (s: string) =>
  s.toLowerCase().replace(/\s+/g, "").replace(",", ".");

function mergeForms(current: FormEntry[], incoming: FormEntry[]): FormEntry[] {
  const byForm = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const src of [current, incoming]) {
    for (const f of src) {
      if (!f?.form) continue;
      if (!byForm.has(f.form)) {
        byForm.set(f.form, new Set());
        order.push(f.form);
      }
      const set = byForm.get(f.form)!;
      for (const s of f.strengths ?? []) {
        // Keep the first spelling seen for a strength, drop duplicates.
        if (![...set].some((v) => normStrength(v) === normStrength(s))) {
          set.add(s);
        }
      }
    }
  }
  return order.map((form) => ({
    form,
    strengths: [...(byForm.get(form) ?? [])],
  }));
}

async function main() {
  const payload = JSON.parse(
    readFileSync(join(process.cwd(), "prisma", "uzpharm-registry.json"), "utf8"),
  ) as { entities: RegistryEntity[] };

  // Index the register by substance name and by every brand it carries, so a
  // curated row matches however it is named.
  const byHandle = new Map<string, RegistryEntity>();
  for (const e of payload.entities) {
    const key = norm(e.nameRu);
    if (!byHandle.has(key)) byHandle.set(key, e);
    for (const b of e.brands) {
      const bk = norm(b.name);
      if (!byHandle.has(bk)) byHandle.set(bk, e);
    }
  }

  // Curated rows only: ids from the register start with «uzr-» and already
  // carry the register's own forms.
  const curated = await prisma.drug.findMany({
    where: { NOT: { id: { startsWith: "uzr-" } } },
    select: { id: true, nameRu: true, forms: true, brands: { select: { name: true } } },
  });

  let changed = 0;
  let untouched = 0;
  const examples: string[] = [];

  for (const d of curated) {
    const hit =
      byHandle.get(norm(d.nameRu)) ??
      d.brands.map((b) => byHandle.get(norm(b.name))).find(Boolean);
    if (!hit) {
      untouched += 1;
      continue;
    }
    const current = Array.isArray(d.forms) ? (d.forms as FormEntry[]) : [];
    const merged = mergeForms(current, hit.forms);
    const same =
      JSON.stringify(merged.map((f) => [f.form, f.strengths.length])) ===
      JSON.stringify(current.map((f) => [f.form, f.strengths.length]));
    if (same) {
      untouched += 1;
      continue;
    }
    changed += 1;
    if (examples.length < 8) {
      examples.push(
        `${d.nameRu}: ${current.map((f) => f.form).join("/") || "—"} → ${merged
          .map((f) => f.form)
          .join("/")}`,
      );
    }
    if (APPLY) {
      await prisma.drug.update({
        where: { id: d.id },
        data: { forms: merged as never },
      });
    }
  }

  console.log(`[forms] curated rows: ${curated.length}`);
  console.log(`[forms] to enrich: ${changed}, already complete: ${untouched}`);
  for (const e of examples) console.log(`[forms]   ${e}`);
  if (!APPLY) console.log("[forms] DRY RUN — set APPLY=1 to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

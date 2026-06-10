/**
 * Pins the tenant-allowlist invariant: every Prisma model WITHOUT a
 * `clinicId` column must be listed in MODELS_WITHOUT_TENANT, otherwise the
 * tenant extension injects `clinicId` into `where`/`data`, Prisma rejects
 * the unknown argument and the route 500s — silently, because catalog UIs
 * degrade to empty states (the G1–G5 catalogs shipped broken this way).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MODELS_TENANT_BYPASSABLE,
  MODELS_WITHOUT_TENANT,
} from "@/lib/tenant-allowlist";

function modelsWithoutClinicId(): string[] {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const out: string[] = [];
  const re = /^model (\w+) \{([\s\S]*?)^\}/gm;
  for (let m = re.exec(schema); m; m = re.exec(schema)) {
    const [, name, body] = m;
    if (!/^\s+clinicId\s/m.test(body)) out.push(name);
  }
  return out;
}

describe("tenant allowlist vs schema", () => {
  it("every model lacking clinicId is exempt from auto-injection", () => {
    const missing = modelsWithoutClinicId().filter(
      (name) =>
        !MODELS_WITHOUT_TENANT.has(name) &&
        !MODELS_TENANT_BYPASSABLE.has(name),
    );
    expect(
      missing,
      `models without clinicId not in MODELS_WITHOUT_TENANT: ${missing.join(", ")} — TENANT queries against them will throw "Unknown argument clinicId"`,
    ).toEqual([]);
  });

  it("parses the schema (sanity)", () => {
    // Drug gained a nullable clinicId in Ф4 (clinic-local rows), so the
    // canary is Plan — platform-level, will never carry clinicId.
    expect(modelsWithoutClinicId()).toContain("Plan");
    expect(modelsWithoutClinicId()).not.toContain("Drug");
  });
});

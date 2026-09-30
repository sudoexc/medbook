/**
 * Audits CT-04 and CT-11 — browsing the ICD-10 catalog by chapter.
 *
 * CT-04: the visit's ICD drawer asked for PAGE × clicks codes in one
 * request; the route caps a page at 200, so the third «Ещё» got a 400 and
 * chapter G stopped at G57.2. The drawer now pages by offset.
 *
 * CT-11: the doctor's reference page knew 18 chapters, parked 2315 codes
 * (P, Q, V to Y) under a «не классифицированы» banner, and imported the
 * whole 1.4 MB catalog into the browser. One chapter list serves both
 * screens now, every code has a chapter, and the page reads codes from the
 * API a chapter at a time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ICD10_ENTRIES } from "@/server/icd10/data";
import { icd10ChapterCounts } from "@/server/icd10/chapters";
import {
  DEFAULT_ICD10_CHAPTER,
  ICD10_CHAPTERS,
  chapterIdFor,
} from "@/lib/icd10-chapters";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("the chapter list", () => {
  it("gives every code of the catalog a chapter", () => {
    const orphans = ICD10_ENTRIES.filter((e) => chapterIdFor(e.code) === null);
    expect(orphans.map((e) => e.code)).toEqual([]);
  });

  it("has the perinatal, congenital, external-cause and COVID-19 chapters", () => {
    const ids = ICD10_CHAPTERS.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(["P00-P96", "Q00-Q99", "V01-Y98", "U00-U85"]),
    );
    expect(chapterIdFor("Q03.9")).toBe("Q00-Q99");
    expect(chapterIdFor("Q28.2")).toBe("Q00-Q99");
    expect(chapterIdFor("W19")).toBe("V01-Y98");
    expect(chapterIdFor("U09.9")).toBe("U00-U85");
    expect(chapterIdFor("D48.9")).toBe("C00-D48");
    expect(chapterIdFor("D50.0")).toBe("D50-D89");
  });

  it("counts every code once, on the server", () => {
    const counts = icd10ChapterCounts();
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(ICD10_ENTRIES.length);
    for (const ch of ICD10_CHAPTERS) expect(counts[ch.id]).toBeGreaterThan(0);
  });

  it("opens the neurologist's chapter first", () => {
    expect(DEFAULT_ICD10_CHAPTER).toBe("G00-G99");
  });

  it("names every chapter in both languages", () => {
    for (const lang of ["ru", "uz"]) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), "src", "messages", `${lang}.json`), "utf8"),
      ) as { doctor: { references: { icd10: Record<string, unknown> } } };
      const icd = messages.doctor.references.icd10;
      const titles = icd.chapters as Record<string, string>;
      for (const ch of ICD10_CHAPTERS) expect(titles[ch.id], `${lang} ${ch.id}`).toBeTruthy();
      expect(icd.unmapped).toBeUndefined();
    }
  });
});

async function page(range: string, offset: number, limit: number) {
  const { GET } = await import("@/app/api/crm/icd10/search/route");
  return GET(
    new Request(
      `https://x/api/crm/icd10/search?range=${range}&offset=${offset}&limit=${limit}`,
    ),
  );
}

/** What the drawer and the reference page do: next page by offset. */
async function browse(range: string, limit: number): Promise<string[]> {
  const codes: string[] = [];
  for (;;) {
    const res = await page(range, codes.length, limit);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { code: string }[]; total: number };
    codes.push(...body.rows.map((r) => r.code));
    if (body.rows.length === 0 || codes.length >= body.total) return codes;
  }
}

describe("browsing a chapter page by page", () => {
  it("reaches the end of chapter G, past G57.2", async () => {
    const codes = await browse("G00-G99", 100);
    const all = ICD10_ENTRIES.filter((e) => e.code.startsWith("G")).map((e) => e.code);
    expect(codes).toEqual(all);
    expect(codes).toEqual(expect.arrayContaining(["G57.3", "G90.9", "G93.4"]));
  });

  it("reaches the end of the biggest chapters too", async () => {
    for (const range of ["S00-T98", "V01-Y98"]) {
      const codes = await browse(range, 200);
      expect(codes.length).toBe(icd10ChapterCounts()[range]);
    }
  });

  it("still refuses a page bigger than the route allows", async () => {
    expect((await page("G00-G99", 0, 300)).status).toBe(400);
  });
});

describe("the browser never ships the catalog", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return files(p);
      return /\.tsx?$/.test(name) ? [p] : [];
    });
  }

  it("no client module imports the payload, only its type", () => {
    const offenders = [
      ...files(join(process.cwd(), "src", "app")),
      ...files(join(process.cwd(), "src", "components")),
      ...files(join(process.cwd(), "src", "hooks")),
      ...files(join(process.cwd(), "src", "lib")),
    ].filter((p) => {
      const src = readFileSync(p, "utf8");
      if (!/^["']use client["']/m.test(src)) return false;
      return /import\s+(?!type\b)[^;]*from\s+["']@\/server\/icd10\/data["']/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

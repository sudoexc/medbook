/**
 * Audit VW-05 — «Изменения в лечении» on the signed conclusion and on the
 * patient's handout said «отменено: Конкор» when the drug was continued as
 * a text line (a template, a protocol, a free-typed history line), right
 * above a prescription list reading «Конкор 5 мг». The diff saw only the
 * structured rows.
 *
 * Pinned:
 *   1. Acceptance: last visit a structured Конкор, this visit Конкор as a
 *      text line: no «отменено: Конкор».
 *   2. Continued under another name the catalog knows (a «Бисопролол» row,
 *      a «Конкор 5 мг» line): matched by the resolved drug id.
 *   3. The other way round (a text line last time, a row now) is not
 *      «добавлено».
 *   4. A drug really stopped is still reported, and a line naming another
 *      drug does not hide it.
 *   5. The print route feeds the lines of both visits, resolved through the
 *      catalog, into the diff.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  diffTreatments,
  formatTreatmentDiff,
  type TreatmentDiffRow,
} from "@/lib/catalogs/treatment-diff";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drug: {
      findMany: vi.fn(async () => [
        {
          id: "bisoprolol",
          inn: "Bisoprolol",
          nameRu: "Бисопролол",
          atcCode: "C07AB07",
          brands: [{ name: "Конкор" }],
        },
        {
          id: "amlodipine",
          inn: "Amlodipine",
          nameRu: "Амлодипин",
          atcCode: "C08CA01",
          brands: [{ name: "Норваск" }],
        },
      ]),
    },
  },
}));

function row(partial: Partial<TreatmentDiffRow> & { displayName: string }): TreatmentDiffRow {
  return {
    drugId: null,
    strength: "5 мг",
    dose: "5 мг",
    timesOfDay: ["MORNING"],
    mealRelation: "NO_MATTER",
    durationDays: 30,
    ...partial,
  };
}

const konkorRow = row({ drugId: "bisoprolol", displayName: "Конкор (бисопролол)" });

describe("a drug continued as a text line", () => {
  it("is not «отменено» (acceptance)", () => {
    const out = diffTreatments([konkorRow], [], {
      next: ["Конкор 5 мг, по 1 таб утром"],
    });
    expect(out).toEqual([]);
    expect(formatTreatmentDiff(out, "ru").join(" ")).not.toContain("отменено: Конкор");
  });

  it("matches another name of the same drug through the resolved id", () => {
    const prev = [row({ drugId: "bisoprolol", displayName: "Бисопролол" })];
    expect(
      diffTreatments(prev, [], { next: [{ text: "Конкор 5 мг", drugId: "bisoprolol" }] }),
    ).toEqual([]);
    // Without the id the names differ: still reported, never guessed.
    expect(diffTreatments(prev, [], { next: ["Конкор 5 мг"] })).toEqual([
      { kind: "REMOVED", name: "Бисопролол" },
    ]);
  });

  it("a row continuing last visit's text line is not «добавлено»", () => {
    expect(diffTreatments([], [konkorRow], { prev: ["Конкор 5 мг утром"] })).toEqual([]);
  });

  it("a drug really stopped is still reported", () => {
    const out = diffTreatments(
      [konkorRow, row({ drugId: "amlodipine", displayName: "Амлодипин" })],
      [],
      { next: ["Конкор 5 мг"] },
    );
    expect(out).toEqual([{ kind: "REMOVED", name: "Амлодипин" }]);
  });

  it("a line must name the drug as whole words", () => {
    // «Конкорд» is not «Конкор».
    expect(diffTreatments([konkorRow], [], { next: ["Конкорд 1 таб"] })).toEqual([
      { kind: "REMOVED", name: "Конкор (бисопролол)" },
    ]);
  });

  it("without lines the diff is what it was", () => {
    expect(diffTreatments([konkorRow], [])).toEqual([
      { kind: "REMOVED", name: "Конкор (бисопролол)" },
    ]);
  });
});

describe("the print route", () => {
  it("resolves text lines to catalog drugs", async () => {
    const { resolveLineDrugIds } = await import("@/server/visit-notes/legacy-line-drugs");
    expect(
      await resolveLineDrugIds(["Конкор 5 мг утром", "Норваск 5 мг", "Мумиё"]),
    ).toEqual(["bisoprolol", "amlodipine", null]);
    expect(await resolveLineDrugIds([])).toEqual([]);
  });

  it("feeds both visits' lines into the diff", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/api/crm/visit-notes/[id]/print/route.ts"),
      "utf8",
    );
    expect(src).toContain("resolveLineDrugIds([...prevText, ...nextText])");
    const prev = readFileSync(
      path.join(process.cwd(), "src/server/visit-notes/previous-visit.ts"),
      "utf8",
    );
    expect(prev).toContain("prescriptions: true");
  });
});

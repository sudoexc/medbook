/**
 * Audit VW-14 — the CDS engine read every active Drug row, so a drug another
 * clinic's admin added under a real INN resolved this clinic's prescription
 * lines and drove its warnings with that clinic's data.
 *
 * Pinned:
 *   1. A written line never resolves to another clinic's own drug; the
 *      global catalog answers it instead.
 *   2. The clinic's own drug still resolves its lines.
 *   3. A structured row pinned to another clinic's drug id is not checked
 *      against that clinic's row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cdsState, check, resetCdsState, type FixtureDrug } from "./cds-fixture";

vi.mock("@/lib/prisma", async () => {
  const { makeCdsPrisma } = await import("./cds-fixture");
  return { prisma: makeCdsPrisma() };
});

const own = (id: string, nameRu: string, clinicId: string): FixtureDrug => ({
  id,
  inn: `Carbamazepine retard ${clinicId}`,
  nameRu,
  atcCode: "N03AF01",
  pregnancyCat: "X",
  contraindications: [],
  brands: [],
  clinicId,
});

beforeEach(() => resetCdsState());

describe("CDS reads only the global catalog and the clinic's own drugs", () => {
  it("a line naming another clinic's drug resolves to the global row", async () => {
    cdsState.register = [own("c2-retard", "Карбамазепин ретард", "c2")];
    const r = await check([], { lines: ["Карбамазепин ретард 200 мг 2 раза"] });
    expect(r.resolvedDrugs.map((d) => d.id)).toEqual(["carbamazepine"]);
  });

  it("the clinic's own drug still resolves its lines", async () => {
    cdsState.register = [own("c1-retard", "Карбамазепин ретард", "c1")];
    const r = await check([], { lines: ["Карбамазепин ретард 200 мг 2 раза"] });
    expect(r.resolvedDrugs.map((d) => d.id)).toEqual(["c1-retard"]);
  });

  it("an id pinned to another clinic's drug is not read", async () => {
    cdsState.register = [own("c2-retard", "Карбамазепин ретард", "c2")];
    const r = await check(["c2-retard"]);
    expect(r.resolvedDrugs).toEqual([]);
  });
});

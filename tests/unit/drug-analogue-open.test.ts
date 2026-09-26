import { afterEach, describe, expect, it, vi } from "vitest";

import { drawerSelection } from "@/lib/catalogs/drawer-selection";
import { fetchDrugById } from "@/app/[locale]/doctor/references/_hooks/use-drug-catalog";

/**
 * Audit CT-01, client half: a click on an analogue in «Чем заменить» must
 * open THAT analogue. The reference looked it up among its loaded rows and
 * silently did nothing; the prescription drawer's auto-select then replaced
 * it with the first search result, a different drug.
 */
describe("prescription drawer selection", () => {
  const rows = [{ id: "ketorolac" }, { id: "difengidramin-ketorolak" }];

  it("keeps an opened analogue even though the results do not contain it", () => {
    const analogue = { id: "diclofenac" };
    const s = drawerSelection(rows, "diclofenac", analogue);
    expect(s.selected).toBe(analogue);
    expect(s.selectedId).toBe("diclofenac");
  });

  it("prefers the result row when the analogue is also in the results", () => {
    const s = drawerSelection(rows, "ketorolac", { id: "ketorolac" });
    expect(s.selected).toBe(rows[0]);
  });

  it("falls back to the first result for a stale selection with no analogue", () => {
    expect(drawerSelection(rows, "gone", null)).toEqual({
      selected: rows[0],
      selectedId: "ketorolac",
    });
    // An analogue that is no longer the selection does not pin anything.
    expect(drawerSelection(rows, "gone", { id: "diclofenac" }).selectedId).toBe(
      "ketorolac",
    );
    expect(drawerSelection(rows, null, null).selectedId).toBe("ketorolac");
  });

  it("clears the card when there are no results and no analogue", () => {
    expect(drawerSelection([], "x", null)).toEqual({
      selected: null,
      selectedId: null,
    });
  });
});

describe("fetchDrugById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the catalog for exactly that id and returns its card", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({ rows: [{ id: "diclofenac", nameRu: "Диклофенак" }], total: 1 }),
        ),
    );
    vi.stubGlobal("window", { location: { origin: "http://clinic.test" } });
    vi.stubGlobal("fetch", fetchMock);

    const drug = await fetchDrugById("diclofenac");
    expect(drug?.nameRu).toBe("Диклофенак");
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.pathname).toBe("/api/crm/catalogs/drugs");
    expect(url.searchParams.get("ids")).toBe("diclofenac");
  });

  it("returns null when the clinic cannot see the drug", async () => {
    vi.stubGlobal("window", { location: { origin: "http://clinic.test" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ rows: [], total: 0 }))),
    );
    expect(await fetchDrugById("hidden-one")).toBeNull();
  });

  it("throws on a failed request so the card can say it could not open", async () => {
    vi.stubGlobal("window", { location: { origin: "http://clinic.test" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(fetchDrugById("diclofenac")).rejects.toThrow();
  });
});

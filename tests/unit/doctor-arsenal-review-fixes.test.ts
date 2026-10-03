/**
 * Review fixes of «Мой арсенал» (03.10.2026).
 *
 *   [0] The arsenal page's queued writes: only the last one to settle
 *       reloads the list, so a reload never brings back the order without
 *       a move still queued (a drag made then lost that move).
 *   [1] The «10 · 20 · 30» switch clicked while «Частые» still loads keeps
 *       that load (cancelled, the column read «empty» for five minutes)
 *       and shows the saved choice once it lands; the switch is disabled
 *       until the list is there.
 *   [2] A dose that is the strength copied over («500 мг/4 мл») is never
 *       carried into an arsenal schema, nor applied from one: the «Мои»
 *       click goes through the dose prompt like the «Частые» one.
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStrengthCopiedAsDose,
  parseDrugArsenalSchema,
  schemaFromUsual,
  type DrugArsenalSchema,
} from "@/lib/arsenal";
import {
  arsenalKey,
  arsenalWriteOptions,
  type DrugArsenal,
} from "@/components/arsenal/use-arsenal";
import {
  drugShortlistKey,
  frequentLimitOptions,
  type DrugShortlist,
} from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";
import {
  draftFromShortItem,
  shortItemFromDrug,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";
import type { DrugSearchHit } from "@/app/[locale]/doctor/reception/_hooks/use-drug-search";
import { TopSwitch } from "@/app/[locale]/doctor/reception/_components/top-switch";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A promise resolved from outside: the test decides when a request lands. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ── [0] the queue reloads once, at its end ──────────────────────────────

describe("the arsenal page reloads its list only when the queue is empty", () => {
  const list = (codes: readonly string[]): DrugArsenal => ({
    doctor: { id: "doc_1", nameRu: "Султанов Азиз", nameUz: "Sultanov Aziz" },
    kind: "DRUG",
    max: 30,
    frequentLimit: 20,
    items: codes.map((code) => ({ code, schema: null, entry: null })),
    top: [],
    core: [],
  });
  const order = (qc: QueryClient, key: readonly unknown[]) =>
    qc.getQueryData<DrugArsenal>(key)?.items.map((i) => i.code);

  /**
   * The server: one arsenal whose writes land when the test says so, in
   * the order they arrive.
   */
  function server(initial: string[]) {
    const state = { codes: [...initial] };
    const landings: { body: Record<string, unknown>; land: (status?: number) => void }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const gate = deferred<number>();
        landings.push({ body, land: (status = 200) => gate.resolve(status) });
        const status = await gate.promise;
        if (status !== 200) return Response.json({ reason: null }, { status });
        if (body.op === "reorder") state.codes = body.codes as string[];
        if (init?.method === "POST") state.codes = [...state.codes, body.code as string];
        return Response.json({ ok: true });
      }),
    );
    return { state, landings };
  }

  async function mounted(qc: QueryClient, srv: { state: { codes: string[] } }) {
    const key = arsenalKey("DRUG", "doc_1");
    const loads = vi.fn(async () => list(srv.state.codes));
    const page = new QueryObserver(qc, { queryKey: key, queryFn: loads, staleTime: 30_000 });
    const unsubscribe = page.subscribe(() => undefined);
    await vi.waitFor(() => expect(order(qc, key)).toEqual(srv.state.codes));
    return { key, loads, unsubscribe };
  }

  it("two quick drags: the first landing does not snap the list back, the last one reloads it", async () => {
    const srv = server(["a", "b", "c"]);
    const qc = new QueryClient();
    const { key, loads, unsubscribe } = await mounted(qc, srv);
    const opts = arsenalWriteOptions(qc, "DRUG", "doc_1");

    // Drag b to the top, then a to the bottom: both show at once.
    const m1 = new MutationObserver(qc, opts.reorder).mutate({ codes: ["b", "a", "c"] });
    await vi.waitFor(() => expect(srv.landings).toHaveLength(1));
    const m2 = new MutationObserver(qc, opts.reorder).mutate({ codes: ["b", "c", "a"] });
    await vi.waitFor(() => expect(order(qc, key)).toEqual(["b", "c", "a"]));

    // The first lands: the second is still queued, so no reload.
    srv.landings[0]!.land();
    await m1;
    await vi.waitFor(() => expect(srv.landings).toHaveLength(2));
    expect(loads).toHaveBeenCalledTimes(1);
    expect(order(qc, key)).toEqual(["b", "c", "a"]);

    // The last lands: now the list reloads, and holds both moves.
    srv.landings[1]!.land();
    await m2;
    await vi.waitFor(() => expect(loads).toHaveBeenCalledTimes(2));
    expect(srv.state.codes).toEqual(["b", "c", "a"]);
    expect(order(qc, key)).toEqual(["b", "c", "a"]);
    unsubscribe();
  });

  it("add, then drag it up: the added row stays where he dragged it while the add lands", async () => {
    const srv = server(["a", "b"]);
    const qc = new QueryClient();
    const { key, loads, unsubscribe } = await mounted(qc, srv);
    const opts = arsenalWriteOptions(qc, "DRUG", "doc_1");

    const add = new MutationObserver(qc, opts.add).mutate({ code: "z", item: null });
    await vi.waitFor(() => expect(order(qc, key)).toEqual(["a", "b", "z"]));
    const drag = new MutationObserver(qc, opts.reorder).mutate({ codes: ["z", "a", "b"] });
    await vi.waitFor(() => expect(srv.landings).toHaveLength(1));

    srv.landings[0]!.land();
    await add;
    expect(loads).toHaveBeenCalledTimes(1);
    expect(order(qc, key)).toEqual(["z", "a", "b"]);

    await vi.waitFor(() => expect(srv.landings).toHaveLength(2));
    srv.landings[1]!.land();
    await drag;
    await vi.waitFor(() => expect(loads).toHaveBeenCalledTimes(2));
    expect(order(qc, key)).toEqual(["z", "a", "b"]);
    unsubscribe();
  });

  it("a write failing with others queued leaves their edits; the last one's reload brings the server's list", async () => {
    const srv = server(["a", "b", "c"]);
    const qc = new QueryClient();
    const { key, loads, unsubscribe } = await mounted(qc, srv);
    const failed = vi.fn();
    const opts = arsenalWriteOptions(qc, "DRUG", "doc_1", failed);

    const m1 = new MutationObserver(qc, opts.remove).mutate({ code: "c" });
    await vi.waitFor(() => expect(srv.landings).toHaveLength(1));
    const m2 = new MutationObserver(qc, opts.reorder).mutate({ codes: ["b", "a", "c"] });
    await vi.waitFor(() => expect(order(qc, key)).toEqual(["b", "a"]));

    srv.landings[0]!.land(500);
    await expect(m1).rejects.toBeTruthy();
    expect(failed).toHaveBeenCalledTimes(1);
    // Not put back to the click time list: that would undo the drag too.
    expect(order(qc, key)).toEqual(["b", "a"]);
    expect(loads).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(srv.landings).toHaveLength(2));
    srv.landings[1]!.land();
    await m2;
    await vi.waitFor(() => expect(loads).toHaveBeenCalledTimes(2));
    expect(order(qc, key)).toEqual(["b", "a", "c"]);
    unsubscribe();
  });

  it("a single failed write puts the list back at once", async () => {
    const srv = server(["a", "b"]);
    const qc = new QueryClient();
    const { key, unsubscribe } = await mounted(qc, srv);
    const opts = arsenalWriteOptions(qc, "DRUG", "doc_1", () => undefined);

    const m = new MutationObserver(qc, opts.reorder).mutate({ codes: ["b", "a"] });
    await vi.waitFor(() => expect(order(qc, key)).toEqual(["b", "a"]));
    await vi.waitFor(() => expect(srv.landings).toHaveLength(1));
    srv.landings[0]!.land(409);
    await expect(m).rejects.toBeTruthy();
    expect(order(qc, key)).toEqual(["a", "b"]);
    unsubscribe();
  });
});

// ── [1] the switch keeps the first load ─────────────────────────────────

describe("«10 · 20 · 30» while «Частые» still loads", () => {
  const shortlist = (frequentLimit: 10 | 20 | 30): DrugShortlist => ({
    mine: [],
    clinic: [],
    frequent: [],
    starred: [],
    core: [],
    coreRank: [],
    usual: {},
    frequentLimit,
  });

  function stubSave() {
    const saves: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        saves.push(JSON.parse(String(init?.body ?? "{}")));
        return Response.json({ ok: true });
      }),
    );
    return saves;
  }

  it("does not cancel the load: the column gets its list, with the saved choice", async () => {
    const saves = stubSave();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const answer = deferred<DrugShortlist>();
    let aborted = false;
    const load = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return answer.promise;
    });
    const picker = new QueryObserver(qc, {
      queryKey: drugShortlistKey,
      queryFn: load,
      staleTime: 300_000,
    });
    const unsubscribe = picker.subscribe(() => undefined);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    await new MutationObserver(qc, frequentLimitOptions(qc, "DRUG")).mutate(30);
    expect(saves).toEqual([{ op: "limit", kind: "DRUG", limit: 30 }]);
    expect(aborted).toBe(false);
    expect(qc.getQueryState(drugShortlistKey)?.fetchStatus).toBe("fetching");

    // The load was answered before the choice was saved: 20.
    answer.resolve(shortlist(20));
    await vi.waitFor(() =>
      expect(qc.getQueryData<DrugShortlist>(drugShortlistKey)?.frequentLimit).toBe(30),
    );
    expect(qc.getQueryState(drugShortlistKey)?.status).toBe("success");
    expect(load).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("with the list there: the choice shows at once and nothing reloads", async () => {
    stubSave();
    const qc = new QueryClient();
    const load = vi.fn(async () => shortlist(20));
    qc.setQueryData(drugShortlistKey, shortlist(20));
    const picker = new QueryObserver(qc, {
      queryKey: drugShortlistKey,
      queryFn: load,
      staleTime: 300_000,
    });
    const unsubscribe = picker.subscribe(() => undefined);

    const done = new MutationObserver(qc, frequentLimitOptions(qc, "DRUG")).mutate(10);
    await vi.waitFor(() =>
      expect(qc.getQueryData<DrugShortlist>(drugShortlistKey)?.frequentLimit).toBe(10),
    );
    await done;
    await new Promise((r) => setTimeout(r, 10));
    expect(load).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("the switch is disabled until the list is there", () => {
    const messages = JSON.parse(
      readFileSync(path.join(process.cwd(), "src/messages/ru.json"), "utf8"),
    );
    const html = (disabled: boolean) =>
      renderToStaticMarkup(
        // `children` as a prop: the provider's props type requires it.
        // eslint-disable-next-line react/no-children-prop
        React.createElement(NextIntlClientProvider, {
          locale: "ru",
          messages,
          timeZone: "Asia/Tashkent",
          children: React.createElement(TopSwitch, {
            value: 20,
            onChange: () => undefined,
            disabled,
          }),
        }),
      );
    expect(html(true).match(/disabled=""/g)).toHaveLength(3);
    expect(html(true)).toContain('aria-disabled="true"');
    expect(html(false)).not.toContain("disabled");
  });

  it("both pickers pass it", () => {
    const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
    expect(read("src/app/[locale]/doctor/reception/_components/diagnosis-picker.tsx")).toContain(
      "disabled={!columns.data}",
    );
    expect(read("src/app/[locale]/doctor/reception/_components/prescription-picker.tsx")).toContain(
      "disabled={!shortlist}",
    );
  });
});

// ── [2] a strength copied into the dose is no dose ──────────────────────

describe("a strength copied over as the dose never reaches «Мои»", () => {
  function hit(id: string, over: Partial<DrugSearchHit> = {}): DrugSearchHit {
    return {
      id,
      inn: id,
      nameRu: id,
      nameUz: null,
      atcCode: null,
      category: "OTHER",
      forms: [
        { form: "INJ_IV", strengths: ["500 мг/4 мл", "1000 мг/4 мл"] },
        { form: "TAB", strengths: ["500 мг"] },
      ],
      defaultDosing: null,
      rxOnly: true,
      brands: [],
      ...over,
    };
  }

  const usualOldConstructor = {
    label: "Цитиколин",
    count: 6,
    lastDose: "500 мг/4 мл",
    lastForm: "INJ_IV",
    lastStrength: "500 мг/4 мл",
    lastTimesOfDay: ["MORNING"],
    lastMealRelation: "NO_MATTER",
    lastDurationDays: null,
  };

  it("tells a copied strength from a dose he wrote", () => {
    expect(isStrengthCopiedAsDose("500 мг/4 мл", ["500 мг/4 мл"])).toBe(true);
    // The register's spellings: «500мг/4мл», «500 мг/4.0 мл».
    expect(isStrengthCopiedAsDose("500мг/4мл", ["500 мг/4,0 мл"])).toBe(true);
    expect(isStrengthCopiedAsDose("1 флакон", [null, "1 флакон"])).toBe(true);
    // A volume, a count or an amount is a dose, even equal to a strength.
    expect(isStrengthCopiedAsDose("2 мл", ["2 мл"])).toBe(false);
    expect(isStrengthCopiedAsDose("1 таб.", ["1 таб."])).toBe(false);
    expect(isStrengthCopiedAsDose("1000 мг", ["500 мг/4 мл"])).toBe(false);
    // A concentration that is none of the drug's strengths is his to write.
    expect(isStrengthCopiedAsDose("1 флакон", ["500 мг/4 мл"])).toBe(false);
    expect(isStrengthCopiedAsDose("", ["500 мг/4 мл"])).toBe(false);
    expect(isStrengthCopiedAsDose(null, ["500 мг/4 мл"])).toBe(false);
  });

  it("the schema editor starts without it: form, strength and times kept", () => {
    expect(schemaFromUsual(usualOldConstructor)).toEqual({
      form: "INJ_IV",
      strength: "500 мг/4 мл",
      dose: null,
      timesOfDay: ["MORNING"],
      mealRelation: "NO_MATTER",
      durationDays: null,
      instructionRu: null,
      instructionUz: null,
    });
    // A dose he wrote comes along.
    expect(schemaFromUsual({ ...usualOldConstructor, lastDose: "2 мл" }).dose).toBe("2 мл");
    expect(schemaFromUsual({}).dose).toBeNull();
  });

  it("the API refuses to keep it: a saved schema reads without that dose", () => {
    const saved = parseDrugArsenalSchema({
      form: "INJ_IV",
      strength: "500 мг/4 мл",
      dose: "500 мг/4 мл",
      durationDays: 10,
    });
    expect(saved).toMatchObject({ strength: "500 мг/4 мл", dose: null, durationDays: 10 });
    expect(parseDrugArsenalSchema({ strength: "500 мг/4 мл", dose: "4 мл" })?.dose).toBe("4 мл");
  });

  it("the review's case: «10 дней» saved over his last row, one click from «Мои» asks for the dose", () => {
    const item = shortItemFromDrug(hit("citicoline", { nameRu: "Цитиколин" }), usualOldConstructor);
    // «Частые»: the dose prompt (the existing G4-07 rule).
    expect(draftFromShortItem(item, "mine").draft.dose).toBe("");
    // «Мой арсенал»: he picks only «10 дней» and saves.
    const schema = parseDrugArsenalSchema({ ...schemaFromUsual(item), durationDays: 10 })!;
    const { draft } = draftFromShortItem({ ...item, arsenalSchema: schema }, "mine");
    expect(draft).toMatchObject({
      form: "INJ_IV",
      strength: "500 мг/4 мл",
      dose: "",
      timesOfDay: ["MORNING"],
      durationDays: 10,
    });
  });

  it("a schema stored with it by an earlier build is not applied either", () => {
    const item = shortItemFromDrug(hit("citicoline"), usualOldConstructor);
    const raw: DrugArsenalSchema = {
      form: "INJ_IV",
      strength: "1000 мг/4 мл",
      // The old strength left as the dose after he changed the strength.
      dose: "500 мг/4 мл",
      timesOfDay: [],
      mealRelation: null,
      durationDays: 10,
      instructionRu: null,
      instructionUz: null,
    };
    expect(draftFromShortItem({ ...item, arsenalSchema: raw }, "mine").draft).toMatchObject({
      strength: "1000 мг/4 мл",
      dose: "",
      durationDays: 10,
    });
    // A dose he set is applied as before.
    expect(
      draftFromShortItem({ ...item, arsenalSchema: { ...raw, dose: "4 мл" } }, "mine").draft.dose,
    ).toBe("4 мл");
    // A tablet with no dose of his takes the unit default.
    expect(
      draftFromShortItem(
        { ...item, arsenalSchema: { ...raw, form: "TAB", strength: "500 мг", dose: null } },
        "mine",
      ).draft.dose,
    ).toBe("500 мг");
  });
});

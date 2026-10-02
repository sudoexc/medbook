/**
 * Audit VW-25 — «Я учёл» lived only in the CDS card's state. After a tab
 * switch or a reload the acknowledged warning was red again, and
 * acknowledging it again wrote a duplicate CdsOverride; the comment said
 * the state was kept in localStorage, which it never was.
 *
 * Pinned:
 *   1. The visit's recorded overrides are read back by visit note, and the
 *      warning keys they carry are what the card treats as acknowledged.
 *   2. A warning with a recorded override renders as acknowledged without
 *      any click; one without stays red with its «Я учёл» button.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const q = vi.hoisted(() => ({
  check: {} as Record<string, unknown>,
  recorded: undefined as Set<string> | undefined,
  queryOptions: null as null | {
    queryKey: unknown[];
    enabled: boolean;
    queryFn: (a: { signal: AbortSignal }) => Promise<Set<string>>;
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQuery: (opts: typeof q.queryOptions) => {
    q.queryOptions = opts;
    return { data: q.recorded };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/app/[locale]/doctor/reception/_hooks/use-cds-drug-check", async (orig) => ({
  ...(await orig<typeof import("@/app/[locale]/doctor/reception/_hooks/use-cds-drug-check")>()),
  useCdsDrugCheck: () => q.check,
}));
vi.mock("@/app/[locale]/doctor/reception/_hooks/use-patient-history", () => ({
  useRecordAllergy: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { CdsWarningsCard } from "@/app/[locale]/doctor/reception/_components/cds-warnings-card";
import { useAcknowledgedCdsWarnings } from "@/app/[locale]/doctor/reception/_hooks/use-cds-overrides";
import { cdsWarningKey } from "@/lib/cds-warning-key";

const CBZ = {
  id: "carbamazepine",
  inn: "Carbamazepine",
  nameRu: "Карбамазепин",
  atcCode: "N03AF01",
  pregnancyCat: "D",
  lineIndex: -1,
};
const ALLERGY = {
  kind: "ALLERGY",
  severity: "CONTRAINDICATED",
  title: "Аллергия на «карбамазепин»: Карбамазепин",
  detail: "Записана аллергия.",
  drugA: { id: "carbamazepine", nameRu: "Карбамазепин", inn: "Carbamazepine" },
};

function render() {
  return renderToStaticMarkup(
    React.createElement(CdsWarningsCard, {
      patientId: "p1",
      prescriptions: [],
      drugRows: [{ id: "carbamazepine", displayName: "Карбамазепин" }],
      diagnosisCode: null,
      visitNoteId: "vn_1",
    }),
  );
}

beforeEach(() => {
  q.recorded = undefined;
  q.queryOptions = null;
  q.check = {
    data: {
      warnings: [ALLERGY],
      resolvedDrugs: [CBZ],
      unresolvedLines: [],
      noInteractionData: [],
    },
    isError: false,
    isFetching: false,
  };
});

describe("VW-25: acknowledged CDS warnings survive a remount", () => {
  it("a warning the visit already has an override for renders acknowledged", () => {
    q.recorded = new Set([cdsWarningKey(ALLERGY)]);
    const out = render();
    expect(out).toContain("doctor.reception.cds.overrideRecorded");
    expect(out).not.toContain("doctor.reception.cds.acknowledge<");
  });

  it("without a recorded override it stays red with «Я учёл»", () => {
    const out = render();
    expect(out).not.toContain("doctor.reception.cds.overrideRecorded");
    expect(out).toContain("doctor.reception.cds.acknowledge");
  });

  it("reads the overrides of this visit note and keeps their keys", async () => {
    useAcknowledgedCdsWarnings("vn_1");
    const opts = q.queryOptions!;
    expect(opts.enabled).toBe(true);
    expect(opts.queryKey[0]).toBe("cds-overrides");
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify({
          rows: [{ warningKey: "k1" }, { warningKey: null }, { warningKey: "k2" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const keys = await opts.queryFn({ signal: new AbortController().signal });
    vi.unstubAllGlobals();
    expect(fetchMock.mock.calls[0]![0]).toContain("/api/crm/cds-overrides?visitNoteId=vn_1");
    expect([...keys]).toEqual(["k1", "k2"]);
  });

  it("no visit note, no read", () => {
    useAcknowledgedCdsWarnings(null);
    expect(q.queryOptions!.enabled).toBe(false);
  });
});

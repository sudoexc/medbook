/**
 * Audit VW-13 — when /api/crm/cds/drug-check failed (500, timeout, 403), the
 * hook folded the failure into an empty result and the card showed nothing:
 * the same silence as for a drug outside the catalog, while the allergy and
 * interaction check had not run at all.
 *
 * Pinned:
 *   1. A failed check throws; an answer comes back as it was.
 *   2. The card shows «проверка недоступна» with a retry, never silence and
 *      never an older all-clear.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const q = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("@/app/[locale]/doctor/reception/_hooks/use-cds-drug-check", async (orig) => ({
  ...(await orig<typeof import("@/app/[locale]/doctor/reception/_hooks/use-cds-drug-check")>()),
  useCdsDrugCheck: () => q.value,
}));
vi.mock("@/app/[locale]/doctor/reception/_hooks/use-cds-overrides", () => ({
  useCreateCdsOverride: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/app/[locale]/doctor/reception/_hooks/use-patient-history", () => ({
  useRecordAllergy: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import {
  CdsCheckUnavailableError,
  fetchCheck,
} from "@/app/[locale]/doctor/reception/_hooks/use-cds-drug-check";
import { CdsWarningsCard } from "@/app/[locale]/doctor/reception/_components/cds-warnings-card";

const args = {
  patientId: "p1",
  prescriptions: [],
  drugRows: [{ id: "drug_cbz", displayName: "Карбамазепин" }],
  diagnosisCode: "G40.2",
};

function render() {
  return renderToStaticMarkup(
    React.createElement(CdsWarningsCard, {
      patientId: "p1",
      prescriptions: [],
      drugRows: args.drugRows,
      diagnosisCode: "G40.2",
    }),
  );
}

beforeEach(() => {
  q.value = {};
});

describe("VW-13: a failed drug check is an error, not an empty answer", () => {
  it.each([500, 403, 504])("HTTP %i throws", async (status) => {
    const f = vi.fn(async () => new Response("{}", { status }));
    await expect(fetchCheck(args, f as never)).rejects.toBeInstanceOf(
      CdsCheckUnavailableError,
    );
  });

  it("an answer comes back as it was", async () => {
    const body = {
      warnings: [],
      resolvedDrugs: [],
      unresolvedLines: [],
      noInteractionData: [],
    };
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(fetchCheck(args, f as never)).resolves.toEqual(body);
  });
});

describe("VW-13: the card says the check is unavailable", () => {
  it("shows the warning with a retry", () => {
    q.value = { data: undefined, isError: true, isFetching: false, refetch: vi.fn() };
    const out = render();
    expect(out).toContain("doctor.reception.cds.unavailable");
    expect(out).toContain("doctor.reception.cds.retry");
    expect(out).toContain('role="alert"');
  });

  it("hides an older all-clear when the refetch failed", () => {
    q.value = {
      data: {
        warnings: [],
        resolvedDrugs: [
          {
            id: "drug_cbz",
            inn: "carbamazepine",
            nameRu: "Карбамазепин",
            atcCode: null,
            pregnancyCat: "D",
            lineIndex: 0,
          },
        ],
        unresolvedLines: [],
        noInteractionData: [],
      },
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    };
    const out = render();
    expect(out).toContain("doctor.reception.cds.unavailable");
    expect(out).not.toContain("doctor.reception.cds.noConflicts");
  });

  it("a working check still gives its answer", () => {
    q.value = {
      data: {
        warnings: [],
        resolvedDrugs: [
          {
            id: "drug_cbz",
            inn: "carbamazepine",
            nameRu: "Карбамазепин",
            atcCode: null,
            pregnancyCat: "D",
            lineIndex: 0,
          },
        ],
        unresolvedLines: [],
        noInteractionData: [],
      },
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    const out = render();
    expect(out).toContain("doctor.reception.cds.noConflicts");
    expect(out).not.toContain("doctor.reception.cds.unavailable");
  });
});

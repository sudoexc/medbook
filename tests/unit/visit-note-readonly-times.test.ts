/**
 * Audit UX-05 — the signed visit's read-only page is a server component and
 * formatted with getHours()/getDate(): in production (UTC) a 10:00–10:30
 * visit read «05:00–05:30», a note signed at 01:30 carried the previous
 * day, and the month was Russian in the Uzbek interface.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { locale: "ru" };

vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string) => `${ns}.${key}`,
  getLocale: async () => state.locale,
}));

import { VisitNoteReadOnly } from "@/app/[locale]/doctor/visits/[patientId]/[visitId]/_components/visit-note-readonly";

// Tashkent is UTC+5: 10:00 local is 05:00Z.
const note = {
  id: "vn_1",
  status: "FINALIZED" as const,
  startedAt: "2026-09-30T05:00:00.000Z",
  // 01:30 on 1 October in Tashkent, still 30 September in UTC.
  finalizedAt: "2026-09-30T20:30:00.000Z",
  diagnosisCode: "G43.0",
  diagnosisName: "Мигрень без ауры",
  additionalDiagnoses: [],
  complaints: [],
  anamnesis: [],
  examination: [],
  prescriptions: [],
  advice: [],
  bodyMarkdown: null,
  aiGenerated: false,
  appointment: {
    date: "2026-09-30T05:00:00.000Z",
    endDate: "2026-09-30T05:30:00.000Z",
    time: "10:00",
    serviceName: null,
  },
};

async function html() {
  const el = await VisitNoteReadOnly({ note });
  return renderToStaticMarkup(el as React.ReactElement);
}

beforeEach(() => {
  state.locale = "ru";
});

describe("the read-only visit note, in the clinic's time", () => {
  it("shows the visit at 10:00–10:30, not 05:00", async () => {
    const out = await html();
    expect(out).toContain("10:00");
    expect(out).toContain("10:30");
    expect(out).not.toContain("05:00");
    expect(out).toContain("30 сентября 2026");
  });

  it("dates a signature after midnight on its own day", async () => {
    const out = await html();
    expect(out).toContain("1 октября 2026");
    expect(out).toContain("01:30");
  });

  it("names the month in Uzbek for the Uzbek interface", async () => {
    state.locale = "uz";
    const out = await html();
    expect(out).not.toContain("сентября");
    expect(out.toLowerCase()).toMatch(/sentabr|sentyabr/);
  });
});

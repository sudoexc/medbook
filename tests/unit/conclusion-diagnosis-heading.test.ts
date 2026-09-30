/**
 * The conclusion page's header named only the main diagnosis. Since a visit
 * has up to four (29.09.2026), a conclusion with four read like one with a
 * single diagnosis. Now «+N» follows the main one, the others on hover.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      key === "detail.moreDiagnoses"
        ? `+${String(values?.count)}`
        : `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
}));

import { DiagnosisHeading } from "@/app/[locale]/doctor/conclusions/[id]/_components/diagnosis-heading";

const html = (props: React.ComponentProps<typeof DiagnosisHeading>) =>
  renderToStaticMarkup(React.createElement(DiagnosisHeading, props));

describe("the conclusion header's diagnosis", () => {
  it("adds «+N» for the other diagnoses, naming them on hover", () => {
    const out = html({
      diagnosisCode: "G43.0",
      diagnosisName: "Мигрень без ауры",
      additionalDiagnoses: [
        { code: "G44.2", name: "Головная боль напряжённого типа" },
        { code: null, name: "Последствия ЧМТ" },
      ],
    });
    expect(out).toContain("G43.0 · Мигрень без ауры");
    expect(out).toContain(">+2<");
    expect(out).toContain("G44.2");
    expect(out).toContain("Последствия ЧМТ");
  });

  it("shows no chip for a single diagnosis", () => {
    const out = html({
      diagnosisCode: "G43.0",
      diagnosisName: "Мигрень без ауры",
      additionalDiagnoses: [],
    });
    expect(out).not.toContain(">+");
  });

  it("still says «Без диагноза» when there is none", () => {
    const out = html({ diagnosisCode: null, diagnosisName: null, additionalDiagnoses: [] });
    expect(out).toContain("doctor.conclusions.noDiagnosis");
  });
});

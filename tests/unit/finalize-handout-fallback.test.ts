/**
 * A signed conclusion must always leave the patient something to open.
 *
 * The patient's PDF is rendered from `patientHandoutMarkdown` only — the
 * clinical body is deliberately withheld. So finalizing with an empty handout
 * tab silently delivers nothing: the Mini App shows no document and neither
 * doctor nor patient is told why. Found in production, where every finalized
 * note of one patient had a blank handout.
 *
 * Finalize now composes the handout from the structured fields when the doctor
 * left it empty. These tests pin the two things that must not go wrong: what
 * the doctor wrote is never overwritten, and a genuinely empty visit does not
 * produce a blank sheet.
 */
import { describe, expect, it } from "vitest";

import { composePatientHandout } from "@/lib/catalogs/handout-composer";

/** The finalize rule: compose only when the doctor left the tab empty. */
function handoutToPersist(
  existing: string | null,
  compose: () => string,
): string | null {
  return existing?.trim() ? null : compose() || null;
}

const VISIT = {
  locale: "ru" as const,
  patientName: "Рахимов Сардор Шерзодович",
  doctorName: "Юсупова Дилноза Рустамовна",
  doctorSpecialty: "Невролог",
  clinicName: "NeuroFax",
  visitDate: new Date("2026-08-26T10:00:00.000Z"),
};

describe("finalize — patient handout fallback", () => {
  it("composes a handout when the doctor left it empty", () => {
    const result = handoutToPersist(null, () =>
      composePatientHandout({
        ...VISIT,
        diagnosisName: "Мигрень без ауры",
        prescriptions: ["Ибупрофен 400 мг — при боли, до 3 раз в день"],
        advice: ["Режим сна, избегать триггеров"],
      }),
    );

    expect(result).toBeTruthy();
    expect(result).toContain("Мигрень без ауры");
    expect(result).toContain("Ибупрофен");
  });

  it("never overwrites what the doctor wrote", () => {
    const written = "Пейте больше воды и приходите через неделю.";

    const result = handoutToPersist(written, () =>
      composePatientHandout({ ...VISIT, diagnosisName: "Мигрень без ауры" }),
    );

    // null = "leave the column alone" for the finalize update.
    expect(result).toBeNull();
  });

  it("treats a whitespace-only handout as empty", () => {
    const result = handoutToPersist("   \n  ", () =>
      composePatientHandout({
        ...VISIT,
        diagnosisName: "ОРВИ",
        advice: ["Обильное питьё"],
      }),
    );

    expect(result).toBeTruthy();
    expect(result).toContain("ОРВИ");
  });

  it("issues nothing rather than a blank sheet when the visit is empty", () => {
    // No diagnosis, no prescriptions, no advice — a handout here would be a
    // letterhead with no content, which is worse than no document at all.
    const result = handoutToPersist(null, () =>
      composePatientHandout({ ...VISIT }),
    );

    expect(result).toBeNull();
  });

  it("carries the follow-up instruction through", () => {
    const result = handoutToPersist(null, () =>
      composePatientHandout({
        ...VISIT,
        diagnosisName: "Гастрит хронический",
        followUp: "Контроль через 10 дней",
      }),
    );

    expect(result).toContain("Контроль через 10 дней");
  });
});

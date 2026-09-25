/**
 * A signed conclusion must always leave the patient something to open.
 *
 * The patient's PDF is rendered from `patientHandoutMarkdown` only — the
 * clinical body is deliberately withheld. So finalizing with an empty handout
 * silently delivered nothing: the Mini App showed no document and neither
 * doctor nor patient was told why. Found in production, where every finalized
 * note of one patient had a blank handout.
 *
 * Since the handout tab was removed (21.09.2026) nobody writes the handout by
 * hand, and audit VW-02 found that composing it only when empty froze the
 * first signature's text: a re-signed or corrected conclusion kept listing
 * what the doctor had removed. So finalize and every in-window correction
 * compose it from the structured fields with the shared composer. These
 * tests pin that composer: what it says, and that a genuinely empty visit
 * does not produce a blank sheet.
 */
import { describe, expect, it } from "vitest";

import { composeNoteHandout } from "@/server/visit-notes/handout";

const CONTEXT = {
  patient: { fullName: "Рахимов Сардор Шерзодович" },
  doctor: { nameRu: "Юсупова Дилноза Рустамовна", specializationRu: "Невролог" },
  clinic: { nameRu: "NeuroFax" },
  appointment: { date: new Date("2026-08-26T10:00:00.000Z") },
};

const EMPTY = {
  diagnosisName: null,
  complaints: [],
  prescriptions: [],
  advice: [],
  followUpNote: null,
  visitPrescriptions: [],
};

describe("finalize — patient handout composition", () => {
  it("composes a handout from what is being signed", () => {
    const result = composeNoteHandout(CONTEXT, {
      ...EMPTY,
      diagnosisName: "Мигрень без ауры",
      prescriptions: ["Ибупрофен 400 мг — при боли, до 3 раз в день"],
      advice: ["Режим сна, избегать триггеров"],
    });

    expect(result).toBeTruthy();
    expect(result).toContain("Мигрень без ауры");
    expect(result).toContain("Ибупрофен");
  });

  it("lists structured prescriptions with their schedule", () => {
    const result = composeNoteHandout(CONTEXT, {
      ...EMPTY,
      visitPrescriptions: [
        {
          displayName: "Конкор",
          strength: "5 мг",
          dose: "1 таб",
          timesOfDay: ["MORNING"],
          mealRelation: "NO_MATTER",
          durationDays: 30,
        },
      ],
    });

    expect(result).toContain("Конкор");
  });

  it("reflects the current fields, whatever an earlier signature said", () => {
    const first = composeNoteHandout(CONTEXT, {
      ...EMPTY,
      diagnosisName: "Гипертензия",
      prescriptions: ["Конкор 5 мг утром"],
    });
    const corrected = composeNoteHandout(CONTEXT, {
      ...EMPTY,
      diagnosisName: "Гипертензия",
      prescriptions: ["Конкор 10 мг утром"],
    });

    expect(first).toContain("5 мг");
    expect(corrected).toContain("10 мг");
    expect(corrected).not.toContain("5 мг");
  });

  it("issues nothing rather than a blank sheet when the visit is empty", () => {
    // No diagnosis, no prescriptions, no advice — a handout here would be a
    // letterhead with no content, which is worse than no document at all.
    expect(composeNoteHandout(CONTEXT, EMPTY)).toBeNull();
  });

  it("carries the follow-up instruction through", () => {
    const result = composeNoteHandout(CONTEXT, {
      ...EMPTY,
      diagnosisName: "Гастрит хронический",
      followUpNote: "Контроль через 10 дней",
    });

    expect(result).toContain("Контроль через 10 дней");
  });
});

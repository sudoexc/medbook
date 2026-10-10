/**
 * Doctor's request 10.10.2026 (via the owner):
 *   A. a QUARTER tablet («¼ таблетки») must be possible, not only a half;
 *   B. some drugs are taken with no end, for life (blood pressure,
 *      epilepsy): the duration needs «Постоянно» instead of typing 90.
 *
 * Pinned here, on the pure helpers every surface goes through:
 *   1. the tablet chips offer «¼ таб.» / «¼ tabletka»;
 *   2. the patient's line says «по ¼ таблетки» for every way a quarter is
 *      written, and «постоянно» / «doimiy ravishda» for a lifelong course,
 *      which wins over a day count;
 *   3. the server schema keeps the two exclusive (normalizes, never 400s),
 *      protocols keep the flag;
 *   4. the conclusion parser reads «постоянно», «пожизненно» only as a
 *      clause of its own (not negated, not a condition, never over an
 *      explicit course; «длительно» is not lifelong), a quarter tablet
 *      however it is spelled, and the adopted row doses the count, never
 *      the strength;
 *   5. the treatment diff reads tablet fractions and a toggled «постоянно»,
 *      and a combination strength («5/160 мг») as before;
 *   6. the bridge's change detector, revision snapshots, arsenal schema,
 *      shortlists and diagnosis memory carry the flag, and old shapes stay
 *      byte-identical;
 *   7. the reminder schedule of a lifelong course never ends, and the drug
 *      check counts it as current therapy whatever the drug.
 */
import { describe, expect, it } from "vitest";

import { quickDoseOptions } from "@/lib/catalogs/quick-doses";
import {
  formatDurationDays,
  formatPatientLine,
  formatPatientSchedule,
  formatPrescriptionLine,
  formatPrescriptionSchedule,
} from "@/lib/catalogs/prescription-format";
import { parseConclusionPrescriptions } from "@/lib/catalogs/conclusion-parse";
import { diffTreatments } from "@/lib/catalogs/treatment-diff";
import {
  isEmptyDrugSchema,
  parseDrugArsenalSchema,
  schemaFromUsual,
} from "@/lib/arsenal";
import {
  courseEndsAt,
  daysRemaining,
  dosesDueBetween,
  isCourseFinished,
  isOngoingSchedule,
  nextTickAt,
  parseSchedule,
} from "@/lib/patient-experience/medication-schedule";
import { isCourseCurrent } from "@/server/cds/current-therapy";
import { VisitPrescriptionItemSchema } from "@/server/schemas/visit-note";
import { CreateProtocolSchema } from "@/server/schemas/protocol";
import { PrescriptionScheduleSchema } from "@/server/schemas/prescription";
import { CreateEPrescriptionSchema } from "@/server/schemas/clinical-forms";
import { didPrescriptionsChange } from "@/server/visit-notes/prescription-diff";
import { revisionContentOf } from "@/server/visit-notes/revisions";
import { buildDrugColumns, buildDrugShortlist } from "@/server/catalog/shortlist";
import { buildDiagnosisMemory } from "@/server/catalog/diagnosis-memory";
import { draftFromParsed } from "@/app/[locale]/doctor/reception/_components/parsed-from-text-card";
import { draftFromShortItem } from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";
import { protocolItemToDraft } from "@/app/[locale]/doctor/reception/_hooks/use-clinical-protocols";
import type { DrugShortItem } from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";

const ROW = {
  displayName: "Конкор",
  strength: "5 мг",
  dose: "¼ таб.",
  timesOfDay: ["MORNING"],
  mealRelation: "AFTER_MEAL",
  durationDays: null as number | null,
};

// ── 1. Chips ─────────────────────────────────────────────────────────

describe("quarter tablet chip", () => {
  it("tablets offer ¼ after ½, in both languages, within six chips", () => {
    expect(quickDoseOptions("TAB", [], "ru")).toEqual(["1 таб.", "2 таб.", "½ таб.", "¼ таб."]);
    expect(quickDoseOptions("TAB", [], "uz")).toEqual([
      "1 tabletka",
      "2 tabletka",
      "½ tabletka",
      "¼ tabletka",
    ]);
    expect(quickDoseOptions("TAB", ["5 мг", "10 мг", "20 мг"], "ru")).toEqual([
      "1 таб.",
      "2 таб.",
      "½ таб.",
      "¼ таб.",
      "5 мг",
      "10 мг",
    ]);
  });
});

// ── 2. The patient's line ────────────────────────────────────────────

describe("patient line: a quarter tablet", () => {
  const ru = (dose: string, times = ["MORNING"]) =>
    formatPatientSchedule({ ...ROW, dose, timesOfDay: times }, "ru");

  it("«по ¼ таблетки» however the quarter is written", () => {
    expect(ru("¼ таб.")).toBe("по ¼ таблетки утром после еды");
    expect(ru("1/4 таб.")).toBe("по 1/4 таблетки утром после еды");
    expect(ru("0,25 таб.")).toBe("по 0,25 таблетки утром после еды");
    expect(ru("¾ таб.")).toBe("по ¾ таблетки утром после еды");
    expect(ru("1½ таб.")).toBe("по 1½ таблетки утром после еды");
    expect(ru("¼ таблетки")).toBe("по ¼ таблетки утром после еды");
    // A Uzbek spelling on the Russian print reads Russian.
    expect(ru("¼ tabletka")).toBe("по ¼ таблетки утром после еды");
  });

  it("whole counts are unchanged", () => {
    expect(ru("1 таб.")).toBe("по 1 таблетке утром после еды");
    expect(ru("2 таб.")).toBe("по 2 таблетки утром после еды");
    expect(ru("5 таб.")).toBe("по 5 таблеток утром после еды");
  });

  it("a bare quarter next to «2 раза» gets a comma, a quarter tablet does not", () => {
    expect(ru("¼", ["MORNING", "EVENING"])).toBe(
      "по ¼, 2 раза в день: утром после еды и вечером после еды",
    );
    expect(ru("¼ таб.", ["MORNING", "EVENING"])).toBe(
      "по ¼ таблетки 2 раза в день: утром после еды и вечером после еды",
    );
  });

  it("uz keeps the amount and spells the unit", () => {
    expect(formatPatientSchedule({ ...ROW, dose: "¼ таб." }, "uz")).toBe(
      "¼ tabletka, ertalab ovqatdan keyin",
    );
    expect(formatPatientSchedule({ ...ROW, dose: "1/4 tabletka" }, "uz")).toBe(
      "1/4 tabletka, ertalab ovqatdan keyin",
    );
  });
});

describe("patient line: «постоянно»", () => {
  it("ends «, постоянно» / «, doimiy ravishda»", () => {
    expect(formatPatientLine({ ...ROW, ongoing: true }, "ru")).toBe(
      "Конкор 5 мг — по ¼ таблетки утром после еды, постоянно",
    );
    expect(formatPatientLine({ ...ROW, ongoing: true }, "uz")).toBe(
      "Конкор 5 мг — ¼ tabletka, ertalab ovqatdan keyin, doimiy ravishda",
    );
    expect(
      formatPatientSchedule(
        {
          dose: "½ таб.",
          timesOfDay: ["MORNING", "EVENING"],
          mealRelation: "NO_MATTER",
          ongoing: true,
        },
        "ru",
      ),
    ).toBe("по ½ таблетки 2 раза в день: утром и вечером, постоянно");
  });

  it("wins over a day count if both are somehow set", () => {
    expect(formatPatientSchedule({ ...ROW, durationDays: 30, ongoing: true }, "ru")).toBe(
      "по ¼ таблетки утром после еды, постоянно",
    );
    expect(formatPatientSchedule({ ...ROW, durationDays: 30, ongoing: false }, "ru")).toBe(
      "по ¼ таблетки утром после еды, курс 30 дней",
    );
  });

  it("the compact line says «постоянно» / «doimiy»", () => {
    expect(formatDurationDays(null, "ru", true)).toBe("постоянно");
    expect(formatDurationDays(14, "uz", true)).toBe("doimiy");
    expect(formatDurationDays(14, "ru")).toBe("14 дн.");
    expect(formatPrescriptionSchedule({ ...ROW, ongoing: true }, "ru")).toBe(
      "¼ таб., утром, после еды, постоянно",
    );
    expect(formatPrescriptionSchedule({ ...ROW, ongoing: true }, "uz")).toBe(
      "¼ таб., ertalab, ovqatdan keyin, doimiy",
    );
    expect(formatPrescriptionLine({ ...ROW, ongoing: true }, "ru")).toBe(
      "Конкор 5 мг — ¼ таб., утром, после еды, постоянно",
    );
  });
});

// ── 3. Server schemas ────────────────────────────────────────────────

describe("server schema: «постоянно» and days never together", () => {
  const base = { displayName: "Амлодипин", dose: "1 таб." };

  it("defaults to false and normalizes both set to no days", () => {
    expect(VisitPrescriptionItemSchema.parse(base).ongoing).toBe(false);
    expect(VisitPrescriptionItemSchema.parse({ ...base, durationDays: 30 }).durationDays).toBe(30);
    const both = VisitPrescriptionItemSchema.parse({ ...base, ongoing: true, durationDays: 30 });
    expect(both).toMatchObject({ ongoing: true, durationDays: null });
    // Still rejects what it rejected before.
    expect(VisitPrescriptionItemSchema.safeParse({ ...base, durationDays: 0 }).success).toBe(false);
  });

  it("a protocol keeps the flag on its items", () => {
    const p = CreateProtocolSchema.parse({
      diagnosisCodePrefix: "I10",
      nameRu: "Гипертензия",
      prescriptionItems: [{ ...base, ongoing: true, durationDays: 90 }],
    });
    expect(p.prescriptionItems[0]).toMatchObject({ ongoing: true, durationDays: null });
  });

  it("a CRM schedule edit keeps it, an e-prescription item too", () => {
    expect(
      PrescriptionScheduleSchema.parse({ times: ["08:00"], days: 30, ongoing: true }),
    ).toMatchObject({ ongoing: true, days: null });
    const rx = CreateEPrescriptionSchema.parse({
      patientId: "p1",
      items: [
        { drugName: "Амлодипин", dose: "5 мг", frequency: "1 раз в день", durationDays: 30, ongoing: true },
      ],
    });
    expect(rx.items[0]).toMatchObject({ ongoing: true, durationDays: null });
  });
});

// ── 4. Conclusion text → rows ────────────────────────────────────────

describe("conclusion parser: lifelong courses and quarter tablets", () => {
  const one = (line: string) => parseConclusionPrescriptions(line)[0];

  it("reads «постоянно», «пожизненно», «на постоянной основе», «бессрочно»", () => {
    for (const word of ["постоянно", "пожизненно", "на постоянной основе", "бессрочно", "принимать постоянно"]) {
      const p = one(`Амлодипин 5 мг — по 1 таблетке утром, ${word}.`);
      expect(p, word).toMatchObject({ ongoing: true, durationDays: null });
      expect(p!.instruction, word).toBe("по 1 таблетке утром");
    }
  });

  it("a course in months stays a count, the 365 cap holds", () => {
    expect(one("Депакин 500 мг — утром и вечером, курс 3 месяца")).toMatchObject({
      ongoing: false,
      durationDays: 90,
    });
    expect(one("Омепразол 20 мг — по 1 капсуле утром натощак, курс 18 месяцев")).toMatchObject({
      ongoing: false,
      durationDays: 365,
    });
  });

  it("only a clause of its own: not negated, not a condition, never cut out of a sentence", () => {
    // A PRN NSAID «не постоянно» is not a lifelong course, and keeps its words.
    expect(one("Ибупрофен 400 мг — по 1 таб. при болях, не постоянно")).toMatchObject({
      ongoing: false,
      instruction: "по 1 таб. при болях, не постоянно",
    });
    // Advice that goes on after the word stays whole.
    expect(one("Амлодипин 5 мг — по 1 таб. утром постоянно контролировать АД")).toMatchObject({
      ongoing: false,
      instruction: "по 1 таб. утром постоянно контролировать АД",
    });
    expect(
      one("Лозартан 50 мг — по 1 таблетке вечером при постоянно повышенном давлении"),
    ).toMatchObject({
      ongoing: false,
      instruction: "по 1 таблетке вечером при постоянно повышенном давлении",
    });
    // As a clause it is read, and only it leaves the instruction.
    expect(one("Амлодипин 5 мг — по 1 таб. утром постоянно, контроль АД")).toMatchObject({
      ongoing: true,
      instruction: "по 1 таб. утром, контроль АД",
    });
    expect(one("Амлодипин 5 мг — по 1 таб. утром, принимать постоянно, контроль АД")).toMatchObject({
      ongoing: true,
      instruction: "по 1 таб. утром, контроль АД",
    });
  });

  it("an explicit course wins over «постоянно» and «длительно»", () => {
    // Before: ongoing, and the 60 days were lost.
    expect(
      one("Цераксон 500 мг — по 1 таб. 2 раза в день длительно, курс 2 месяца"),
    ).toMatchObject({
      ongoing: false,
      durationDays: 60,
      instruction: "по 1 таб. 2 раза в день длительно",
    });
    // The 30-day phase stays structured, the rest stays for the doctor.
    expect(one("Амлодипин 5 мг — по 1 таб. утром, курс 30 дней, далее постоянно")).toMatchObject({
      ongoing: false,
      durationDays: 30,
      instruction: "по 1 таб. утром, далее постоянно",
    });
  });

  it("«длительно» means long term, not for life: it stays in the instruction", () => {
    expect(one("Амлодипин 5 мг — по 1 таблетке утром, длительно.")).toMatchObject({
      ongoing: false,
      durationDays: null,
      instruction: "по 1 таблетке утром, длительно",
    });
  });

  it("a condition or «регулярно» is not «постоянно»", () => {
    expect(one("При постоянных головных болях — Нурофен по 1 таблетке")).toMatchObject({
      ongoing: false,
    });
    expect(one("Магне В6 — по 2 таблетки регулярно")).toMatchObject({ ongoing: false });
    expect(one("Депакин 500 мг — утром и вечером, длительность курса 1 месяц")).toMatchObject({
      ongoing: false,
    });
  });

  it("a quarter tablet line is recognized and counted", () => {
    expect(one("Конкор — по ¼ таб. утром.")).toMatchObject({
      displayName: "Конкор",
      count: "¼ таб.",
    });
    expect(one("Конкор 5 мг — по 1/4 таблетки утром")!.count).toBe("¼ таб.");
    expect(one("Варфарин — по четверти таблетки вечером")!.count).toBe("¼ таб.");
    expect(one("Лозартан 50 мг — по половине таблетки утром")!.count).toBe("½ таб.");
    expect(one("Мидокалм 150 мг — по 1-2 таблетки 2 раза в день")!.count).toBe("1-2 таб.");
    expect(one("Омепразол 20 мг — по 1 капсуле утром")!.count).toBe("1 капс.");
    expect(one("Депакин 500 мг — утром и вечером")!.count).toBeNull();
  });

  it("a quarter written without «по» or without a space is counted too", () => {
    expect(one("Конкор 5 мг — 1/4 таб. утром, постоянно")).toMatchObject({
      count: "¼ таб.",
      ongoing: true,
    });
    expect(one("Конкор 5 мг — 0,25 таблетки утром")!.count).toBe("¼ таб.");
    expect(one("Конкор 5 мг — по 1/4таб утром")!.count).toBe("¼ таб.");
    expect(one("Конкор 5 мг — по 1/4 т. утром")!.count).toBe("¼ таб.");
    expect(one("Магне В6 — 2 таблетки 2 раза в день")!.count).toBe("2 таб.");
    // A pack size is not a dose.
    expect(one("Депакин 500 мг — утром и вечером, курс 60 таблеток")!.count).toBeNull();
    for (const line of [
      "Конкор 5 мг — 1/4 таб. утром, постоянно",
      "Конкор 5 мг — 0,25 таблетки утром",
      "Конкор 5 мг — по 1/4таб утром",
      "Конкор 5 мг — по 1/4 т. утром",
    ]) {
      expect(draftFromParsed(one(line)!).dose, line).toBe("¼ таб.");
    }
  });

  it("a part of a tablet the count cannot read is never dosed with the strength", () => {
    // No unit after the quarter: the dose is left for the constructor's
    // prompt, not «5 мг» (four times) or «1».
    expect(draftFromParsed(one("Конкор 5 мг — ¼ утром после еды")!).dose).toBe("");
    expect(draftFromParsed(one("Клоназепам 2 мг — по 0,5 мг на ночь")!).dose).toBe("");
    // Whole amounts keep the old fallback.
    expect(draftFromParsed(one("Депакин 500 мг — утром и вечером")!).dose).toBe("500 мг");
  });

  it("the adopted row doses the quarter, not the strength, and stays lifelong", () => {
    const p = one("Конкор 5 мг — по 1/4 таблетки утром после еды, пожизненно")!;
    const draft = draftFromParsed(p);
    expect(draft).toMatchObject({
      strength: "5 мг",
      dose: "¼ таб.",
      ongoing: true,
      durationDays: null,
      timesOfDay: ["MORNING"],
      mealRelation: "AFTER_MEAL",
    });
    expect(formatPatientSchedule(draft, "ru")).toBe("по ¼ таблетки утром после еды, постоянно");
    // A line with a strength and no count still doses the strength.
    expect(draftFromParsed(one("Депакин 500 мг — утром и вечером")!).dose).toBe("500 мг");
  });
});

// ── 5. Treatment diff ────────────────────────────────────────────────

describe("treatment diff: fractions and «постоянно»", () => {
  const row = (over: Record<string, unknown>) => ({
    drugId: "bisoprolol",
    displayName: "Конкор",
    strength: "5 мг",
    dose: "1 таб.",
    timesOfDay: ["MORNING"],
    mealRelation: "NO_MATTER",
    durationDays: null,
    ...over,
  });
  const diff = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    diffTreatments([row(a)], [row(b)]);

  it("a quarter is lower than a whole and a half, higher the other way", () => {
    expect(diff({ dose: "1 таб." }, { dose: "¼ таб." })).toEqual([
      { kind: "DOSE_CHANGED", name: "Конкор", from: "1 таб.", to: "¼ таб.", direction: "DOWN" },
    ]);
    expect(diff({ dose: "½ таб." }, { dose: "¼ таб." })[0]).toMatchObject({ direction: "DOWN" });
    expect(diff({ dose: "¼ таб." }, { dose: "½ таб." })[0]).toMatchObject({ direction: "UP" });
    expect(diff({ dose: "1/4 таб." }, { dose: "1½ таб." })[0]).toMatchObject({ direction: "UP" });
    expect(diff({ dose: "0,25 таб." }, { dose: "¾ таб." })[0]).toMatchObject({ direction: "UP" });
  });

  it("a combination strength is not a fraction", () => {
    // Эксфорж 5/80 → 5/160 мг is an increase; it used to print «↓ доза».
    expect(diff({ strength: "5/80 мг" }, { strength: "5/160 мг" })[0]).toMatchObject({
      kind: "DOSE_CHANGED",
      direction: "NONE",
    });
    expect(diff({ strength: "5/5 мг" }, { strength: "5/10 мг" })[0]).toMatchObject({
      direction: "NONE",
    });
    expect(diff({ strength: "160/12,5 мг" }, { strength: "160/25 мг" })[0]).toMatchObject({
      direction: "NONE",
    });
    // The first number, as before: 5 → 10 is up.
    expect(diff({ strength: "5/1,25 мг" }, { strength: "10/2,5 мг" })[0]).toMatchObject({
      direction: "UP",
    });
    // A tablet split still reads as one.
    expect(diff({ dose: "2/3 таб." }, { dose: "1 таб." })[0]).toMatchObject({ direction: "UP" });
  });

  it("days to «постоянно» is a schedule change; the same flag is none", () => {
    expect(diff({ durationDays: 10 }, { ongoing: true })).toEqual([
      { kind: "SCHEDULE_CHANGED", name: "Конкор" },
    ]);
    expect(diff({ ongoing: true }, { ongoing: true })).toEqual([]);
    expect(diff({}, { ongoing: false })).toEqual([]);
  });
});

// ── 6. Plumbing ──────────────────────────────────────────────────────

describe("bridge change detector and revisions", () => {
  const rx = (over: Record<string, unknown> = {}) => ({
    displayName: "Амлодипин",
    strength: "5 мг",
    dose: "1 таб.",
    timesOfDay: ["MORNING"],
    mealRelation: "NO_MATTER",
    durationDays: null,
    instructionRu: null,
    instructionUz: null,
    remindPatient: true,
    ...over,
  });

  it("toggling «постоянно» or a ¼ dose re-bridges; undefined and false do not", () => {
    expect(didPrescriptionsChange([rx()], [rx({ ongoing: true })])).toBe(true);
    expect(didPrescriptionsChange([rx({ ongoing: true })], [rx({ durationDays: 30 })])).toBe(true);
    expect(didPrescriptionsChange([rx()], [rx({ ongoing: false })])).toBe(false);
    expect(didPrescriptionsChange([rx({ ongoing: false })], [rx()])).toBe(false);
    expect(didPrescriptionsChange([rx()], [rx({ dose: "¼ таб." })])).toBe(true);
  });

  it("a revision carries `ongoing` only when true, so old snapshots compare equal", () => {
    const off = revisionContentOf({}, [rx({ ongoing: false, sortOrder: 0 })]);
    expect("ongoing" in off.visitPrescriptions[0]!).toBe(false);
    const on = revisionContentOf({}, [rx({ ongoing: true, sortOrder: 0 })]);
    expect(on.visitPrescriptions[0]!.ongoing).toBe(true);
  });
});

describe("arsenal schema", () => {
  it("«постоянно» alone is a schema, and it drops days", () => {
    expect(parseDrugArsenalSchema({ ongoing: true })).toMatchObject({
      ongoing: true,
      durationDays: null,
    });
    expect(parseDrugArsenalSchema({ ongoing: true, durationDays: 14 })).toMatchObject({
      ongoing: true,
      durationDays: null,
    });
    expect(isEmptyDrugSchema(parseDrugArsenalSchema({ ongoing: true }))).toBe(false);
    // Without it the stored shape is exactly as before.
    const plain = parseDrugArsenalSchema({ durationDays: 14, ongoing: false })!;
    expect("ongoing" in plain).toBe(false);
    expect(plain.durationDays).toBe(14);
  });

  it("his last «постоянно» starts the schema he never set", () => {
    expect(schemaFromUsual({ lastDose: "1 таб.", lastOngoing: true })).toMatchObject({
      dose: "1 таб.",
      ongoing: true,
      durationDays: null,
    });
  });
});

describe("shortlists, picks and protocols bring «постоянно» back", () => {
  const at = (iso: string) => new Date(iso);
  const amlo = (over: Record<string, unknown> = {}) => ({
    drugId: "amlodipine",
    displayName: "Амлодипин",
    dose: "1 таб.",
    form: "TAB",
    strength: "5 мг",
    timesOfDay: ["MORNING"],
    mealRelation: "NO_MATTER",
    durationDays: null,
    at: at("2026-10-01"),
    ...over,
  });

  it("his newest use decides; the key is absent when not set", () => {
    const [item] = buildDrugShortlist({
      pinnedIds: [],
      structured: [amlo({ ongoing: true, at: at("2026-10-05") }), amlo({ durationDays: 30 })],
      freeText: [],
      limit: 10,
    });
    expect(item).toMatchObject({ lastOngoing: true, lastDurationDays: null });

    const cols = buildDrugColumns({
      pinnedIds: [],
      structured: [amlo({ ongoing: true }), amlo({ durationDays: 30, at: at("2026-10-05") })],
      freeText: [],
      frequentLimit: 10,
      usualLimit: 10,
    });
    expect(cols.frequent[0]!.lastDurationDays).toBe(30);
    expect("lastOngoing" in cols.frequent[0]!).toBe(false);
  });

  it("diagnosis memory tells «постоянно» from «days not set»", () => {
    const visit = (id: string, iso: string, ongoing: boolean) => ({
      id,
      at: at(iso),
      structured: [amlo({ ongoing })],
      freeText: [],
      advice: [],
    });
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-08-01", true),
        visit("v2", "2026-08-10", true),
        visit("v3", "2026-09-30", false),
      ],
    });
    expect(memory.prescriptions[0]).toMatchObject({ lastOngoing: true, count: 3 });
  });

  it("a pick of it comes back lifelong, a protocol item too", () => {
    const item: DrugShortItem = {
      key: "amlodipine",
      drugId: "amlodipine",
      label: "Амлодипин",
      count: 3,
      lastDose: "1 таб.",
      lastForm: "TAB",
      lastStrength: "5 мг",
      lastTimesOfDay: ["MORNING"],
      lastMealRelation: "NO_MATTER",
      lastDurationDays: 30,
      lastOngoing: true,
      pinned: false,
      strengths: [],
      drug: {
        id: "amlodipine",
        inn: "amlodipine",
        nameRu: "Амлодипин",
        nameUz: null,
        atcCode: "C08CA01",
        category: "CCB",
        forms: [{ form: "TAB", strengths: ["5 мг", "10 мг"] }],
        defaultDosing: null,
        rxOnly: true,
        brands: [],
      },
    };
    expect(draftFromShortItem(item, "mine").draft).toMatchObject({
      dose: "1 таб.",
      ongoing: true,
      durationDays: null,
    });
    expect(
      draftFromShortItem({ ...item, lastOngoing: undefined }, "mine").draft,
    ).toMatchObject({ ongoing: false, durationDays: 30 });

    expect(
      protocolItemToDraft({ displayName: "Амлодипин", dose: "1 таб.", ongoing: true, durationDays: 30 }),
    ).toMatchObject({ ongoing: true, durationDays: null });
    expect(protocolItemToDraft({ displayName: "Амлодипин", dose: "1 таб." }).ongoing).toBe(false);
  });
});

// ── 7. Reminders and the drug check ──────────────────────────────────

describe("a lifelong course reminds for good", () => {
  const start = new Date("2024-10-01T00:00:00.000Z");
  const TZ = "Asia/Tashkent";

  it("parses as ongoing only without days", () => {
    const s = parseSchedule({ times: ["09:00"], startsAt: start.toISOString(), ongoing: true }, start)!;
    expect(s).toMatchObject({ ongoing: true, days: null });
    expect(
      parseSchedule({ times: ["09:00"], days: 30, ongoing: true, startsAt: start.toISOString() }, start)!
        .ongoing,
    ).toBe(false);
    expect(parseSchedule({ times: ["09:00"] }, start)!.ongoing).toBe(false);
  });

  it("two years on: not finished, the 09:00 dose is due, no days left to count", () => {
    const s = parseSchedule({ times: ["09:00"], startsAt: start.toISOString(), ongoing: true }, start)!;
    const now = new Date("2026-10-10T09:03:00+05:00");
    expect(courseEndsAt(s)).toBeNull();
    expect(isCourseFinished(s, now)).toBe(false);
    expect(dosesDueBetween(s, new Date(now.getTime() - 10 * 60_000), now, TZ)).toEqual([
      new Date("2026-10-10T09:00:00+05:00"),
    ]);
    expect(daysRemaining(s, now)).toBeNull();
    expect(nextTickAt(s, now, TZ)).not.toBeNull();
  });

  it("isOngoingSchedule reads a stored blob, times or not", () => {
    expect(isOngoingSchedule({ ongoing: true })).toBe(true);
    expect(isOngoingSchedule({ times: [], days: null, ongoing: true })).toBe(true);
    expect(isOngoingSchedule({ times: ["08:00"], days: 30, ongoing: true })).toBe(false);
    expect(isOngoingSchedule({ times: ["08:00"] })).toBe(false);
    expect(isOngoingSchedule(null)).toBe(false);
  });

  it("the drug check counts it as current therapy, whatever the drug", () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    const course = (schedule: Record<string, unknown>, status = "ACTIVE") => ({
      status,
      schedule: { times: ["08:00"], startsAt: start.toISOString(), ...schedule },
      createdAt: start,
    });
    expect(isCourseCurrent(course({ ongoing: true }), now, false)).toBe(true);
    // Not set is not lifelong: a month for a drug not taken long term.
    expect(isCourseCurrent(course({}), now, false)).toBe(false);
    expect(
      isCourseCurrent(
        { ...course({}), schedule: { times: ["08:00"], startsAt: new Date(now.getTime() - 31 * 86_400_000).toISOString() } },
        now,
        false,
      ),
    ).toBe(false);
    expect(isCourseCurrent(course({ ongoing: true }, "COMPLETED"), now, true)).toBe(false);
  });
});

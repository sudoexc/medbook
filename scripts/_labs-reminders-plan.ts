/**
 * Pure planning for `seed-labs-reminders-dev.ts` (audit G2-02), kept apart so
 * unit tests can pin it without a database.
 *
 * The old seed walked every clinic of the platform and gave the first 50
 * patients of each, real ones, invented lab results (a CRITICAL cholesterol
 * among them) and reminder tasks, with nothing on the rows to tell them from
 * real ones. The plan below only ever names demo-tagged patients, and every
 * row carries LABS_REMINDERS_MARK so `where: { notes / body: MARK }` finds
 * exactly the seeded rows and nothing else.
 */
import { DEMO_SEED_MARK } from "../src/lib/demo-seed";

/** Written to Reminder.body and LabResult.notes of every row the seed creates. */
export const LABS_REMINDERS_MARK = `[${DEMO_SEED_MARK}:labs-reminders-dev]`;

type LabFlag = "NORMAL" | "LOW" | "HIGH" | "CRITICAL";

const REMINDER_TITLES = [
  "Перезвонить пациенту по результатам",
  "Заказать повторный ОАК",
  "Уточнить дозу препарата у фармацевта",
  "Подготовить выписку",
  "Проверить рецепт",
];

const LAB_CATALOG: Array<{
  testName: string;
  unit: string;
  refRange: string;
  values: Array<{ v: string; f: LabFlag }>;
}> = [
  { testName: "Глюкоза крови", unit: "ммоль/л", refRange: "3.3-5.5", values: [{ v: "5.1", f: "NORMAL" }, { v: "6.4", f: "HIGH" }, { v: "3.0", f: "LOW" }] },
  { testName: "Гемоглобин", unit: "г/л", refRange: "120-160", values: [{ v: "135", f: "NORMAL" }, { v: "108", f: "LOW" }] },
  { testName: "Холестерин общий", unit: "ммоль/л", refRange: "3.0-5.2", values: [{ v: "4.5", f: "NORMAL" }, { v: "7.8", f: "HIGH" }, { v: "9.2", f: "CRITICAL" }] },
  { testName: "ТТГ", unit: "мЕд/л", refRange: "0.4-4.0", values: [{ v: "2.1", f: "NORMAL" }, { v: "5.8", f: "HIGH" }] },
  { testName: "СОЭ", unit: "мм/ч", refRange: "2-15", values: [{ v: "8", f: "NORMAL" }, { v: "32", f: "HIGH" }] },
];

export type DemoPatientRef = { id: string; tags: string[] };

export type PlannedReminder = {
  doctorId: string;
  patientId: string;
  title: string;
  body: string;
  remindAt: Date;
};

export type PlannedLab = {
  doctorId: string;
  patientId: string;
  testName: string;
  value: string;
  unit: string;
  refRange: string;
  flag: LabFlag;
  notes: string;
  receivedAt: Date;
};

/**
 * Rows to create. `seededByDoctor` holds how many marked rows each doctor
 * already has: a doctor who has any gets nothing (re-runs add nothing).
 * Patients without the demo tag are dropped even if the caller passes them.
 */
export function planLabsReminders(args: {
  doctorIds: string[];
  patients: DemoPatientRef[];
  seededByDoctor: Map<string, { reminders: number; labs: number }>;
  now: Date;
  random?: () => number;
}): { reminders: PlannedReminder[]; labs: PlannedLab[] } {
  const rnd = args.random ?? Math.random;
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
  const demo = args.patients.filter((p) => p.tags.includes(DEMO_SEED_MARK));
  const reminders: PlannedReminder[] = [];
  const labs: PlannedLab[] = [];
  if (demo.length === 0) return { reminders, labs };

  for (const doctorId of args.doctorIds) {
    const seeded = args.seededByDoctor.get(doctorId) ?? { reminders: 0, labs: 0 };
    if (seeded.reminders === 0) {
      for (let i = 0; i < 3; i++) {
        reminders.push({
          doctorId,
          patientId: pick(demo).id,
          title: pick(REMINDER_TITLES),
          body: LABS_REMINDERS_MARK,
          remindAt: new Date(args.now.getTime() + rnd() * 22 * 3_600_000),
        });
      }
    }
    if (seeded.labs === 0) {
      const total = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < total; i++) {
        const test = pick(LAB_CATALOG);
        const v = pick(test.values);
        labs.push({
          doctorId,
          patientId: pick(demo).id,
          testName: test.testName,
          value: v.v,
          unit: test.unit,
          refRange: test.refRange,
          flag: v.f,
          notes: LABS_REMINDERS_MARK,
          receivedAt: new Date(args.now.getTime() - rnd() * 14 * 24 * 3_600_000),
        });
      }
    }
  }
  return { reminders, labs };
}

import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@formatjs/icu-messageformat-parser";
import IntlMessageFormat from "intl-messageformat";
import { describe, expect, it } from "vitest";

import { conflictMessageValues } from "@/lib/appointments/conflict-message";
import { formatActionBody, type Translator } from "@/lib/actions/format";
import type { ActionPayload } from "@/lib/actions/types";

/**
 * Audit UX-07: nine messages in each locale switched on a value with an
 * empty select case, «{until, select, , {} other{ до {until}}}». That is not
 * ICU: the parser throws, next-intl falls back to the key, and the front
 * desk read «calendar.conflict.doctor_busy» instead of «Врач занят до
 * 14:30»; the Action Center lost the patient's NPS comment and the doctor's
 * follow-up note. The template editor's placeholder «{{patient.firstName}}»
 * failed the same way.
 *
 * The messages now switch on a yes/no flag the code passes, and the
 * placeholder quotes its braces. This suite parses every message of both
 * bundles and renders the repaired ones in both languages, with and without
 * the optional value.
 */

type Tree = { [k: string]: string | Tree };
const LOCALES = ["ru", "uz"] as const;
type Lang = (typeof LOCALES)[number];

const bundles: Record<Lang, Tree> = {
  ru: JSON.parse(readFileSync(path.join(process.cwd(), "src/messages/ru.json"), "utf8")),
  uz: JSON.parse(readFileSync(path.join(process.cwd(), "src/messages/uz.json"), "utf8")),
};

function lookup(lang: Lang, key: string): string {
  const node = key
    .split(".")
    .reduce<string | Tree | undefined>(
      (n, k) => (n && typeof n === "object" ? n[k] : undefined),
      bundles[lang],
    );
  if (typeof node !== "string") throw new Error(`${lang}: no message ${key}`);
  return node;
}

function format(lang: Lang, key: string, values?: Record<string, string | number>): string {
  return new IntlMessageFormat(lookup(lang, key), lang).format(values) as string;
}

function* messages(node: Tree, prefix = ""): Generator<[string, string]> {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") yield [key, v];
    else yield* messages(v, key);
  }
}

describe("every message parses as ICU", () => {
  for (const lang of LOCALES) {
    it(`${lang}.json has no malformed message`, () => {
      const broken: string[] = [];
      for (const [key, msg] of messages(bundles[lang])) {
        try {
          parse(msg);
        } catch (e) {
          broken.push(`${key}: ${(e as Error).message}`);
        }
      }
      expect(broken).toEqual([]);
    });
  }
});

describe("booking conflicts «Врач занят до 14:30»", () => {
  const NAMESPACES = [
    "appointments.drawer.conflict",
    "appointments.newDialog.conflict",
    "calendar.conflict",
  ];
  const EXPECTED: Record<Lang, Record<string, [string, string]>> = {
    ru: {
      doctor_busy: ["Врач занят до 14:30", "Врач занят"],
      cabinet_busy: ["Кабинет занят до 14:30", "Кабинет занят"],
    },
    uz: {
      doctor_busy: ["Shifokor band 14:30 gacha", "Shifokor band"],
      cabinet_busy: ["Kabinet band 14:30 gacha", "Kabinet band"],
    },
  };

  for (const lang of LOCALES) {
    for (const ns of NAMESPACES) {
      for (const reason of ["doctor_busy", "cabinet_busy"]) {
        it(`${lang} ${ns}.${reason} reads right with and without the time`, () => {
          const [withTime, bare] = EXPECTED[lang][reason]!;
          expect(format(lang, `${ns}.${reason}`, conflictMessageValues("14:30"))).toBe(withTime);
          expect(format(lang, `${ns}.${reason}`, conflictMessageValues(undefined))).toBe(bare);
          expect(format(lang, `${ns}.${reason}`, conflictMessageValues(""))).toBe(bare);
        });
      }
    }
  }

  it("the other reasons ignore the extra values", () => {
    for (const lang of LOCALES) {
      expect(
        format(lang, "calendar.conflict.outside_schedule", conflictMessageValues("14:30")),
      ).toBe(lookup(lang, "calendar.conflict.outside_schedule"));
    }
  });
});

describe("Action Center bodies with and without the optional text", () => {
  const renderer =
    (lang: Lang): Translator =>
    (key, values) =>
      format(lang, key, values as Record<string, string | number>);

  const nps = (commentPreview: string): ActionPayload => ({
    type: "LOW_NPS_RECEIVED",
    patientId: "p1",
    patientName: "Виктор Семенов",
    appointmentId: "a1",
    doctorId: "d1",
    doctorName: "Каримов К.К.",
    score: 3,
    commentPreview,
  });
  const followUp = (followUpNote: string): ActionPayload => ({
    type: "VISIT_FOLLOW_UP_DUE",
    visitNoteId: "vn1",
    patientId: "p1",
    patientName: "Шахноза Юсупова",
    doctorId: "d1",
    doctorName: "Алиев А.А.",
    dueDate: "2026-06-20",
    followUpNote,
  });

  for (const lang of LOCALES) {
    it(`${lang}: LOW_NPS_RECEIVED shows the patient's comment, or a call to action`, () => {
      const t = renderer(lang);
      expect(formatActionBody(t, nps("Долго ждал, врач торопился"), lang)).toBe(
        "«Долго ждал, врач торопился»",
      );
      const bare = formatActionBody(t, nps(""), lang);
      expect(bare).not.toContain("«");
      expect(bare).not.toContain("actionCenter.");
      expect(bare.length).toBeGreaterThan(10);
      expect(formatActionBody(t, nps("   "), lang)).toBe(bare);
    });

    it(`${lang}: VISIT_FOLLOW_UP_DUE shows the doctor's note, or a call to action, without dashes`, () => {
      const t = renderer(lang);
      const withNote = formatActionBody(t, followUp("Контроль ОАК"), lang);
      expect(withNote).toContain("«Контроль ОАК»");
      expect(withNote).not.toMatch(/[—–]/);
      const bare = formatActionBody(t, followUp(""), lang);
      expect(bare).not.toContain("«");
      expect(bare).not.toContain("actionCenter.");
      expect(bare).not.toMatch(/[—–]/);
    });
  }
});

describe("template editor placeholder", () => {
  it("prints the {{…}} placeholders literally in both languages", () => {
    for (const lang of LOCALES) {
      const text = format(lang, "notifications.editor.bodyPlaceholder");
      expect(text).toContain("{{patient.firstName}}");
      expect(text).toContain("{{appointment.date}}");
      expect(text).toContain("{{appointment.time}}");
      expect(text).not.toContain("'");
    }
  });
});

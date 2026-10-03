/**
 * «Диагноз» as a big inline block above «Назначения» (owner request
 * 03.10.2026, doctor Азиз works with the mouse: «как назначения сделал
 * сверху, так же диагноз сделай, таким же большим и на три разделённый»).
 *
 *   1. What the block shows under the visit's diagnoses: the three columns
 *      while the visit has none, folded into «+ Диагноз» once it has one,
 *      open again on a click, a note at four (diagnosisAddView).
 *   2. The shared card, rendered: the visit screen gets the columns in
 *      place of the search and «Было раньше» above them; the conclusion
 *      page (no picker) renders as before.
 *   3. The picker, rendered: three columns from the doctor's lists, the
 *      role switch, «Свернуть» only when there is something to fold onto.
 *   4. The conclusion template text: adding, naming and removing follow one
 *      whole-line rule, so a template inside a sentence of the doctor's own
 *      text is never named or cut out of it.
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  DiagnosisCard,
  type DiagnosisPickerSlot,
} from "@/app/[locale]/doctor/_components/diagnosis-follow-up-cards";
import { DiagnosisPicker } from "@/app/[locale]/doctor/reception/_components/diagnosis-picker";
import {
  diagnosisAddView,
  MAX_VISIT_DIAGNOSES,
} from "@/app/[locale]/doctor/reception/_hooks/diagnosis-list";
import { doctorFavoritesKey } from "@/app/[locale]/doctor/reception/_hooks/use-doctor-favorites";
import { patientDiagnosesKey } from "@/app/[locale]/doctor/reception/_hooks/use-patient-diagnoses";
import {
  diagnosisShortlistKey,
  type DiagnosisShortlist,
} from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";
import type { VisitNoteRow } from "@/app/[locale]/doctor/reception/_hooks/use-visit-note";
import {
  appendSnippet,
  hasSnippetParagraph,
  removeSnippet,
  templatesInBody,
} from "@/lib/conclusion-body";

// ── 1. Open, folded, full ────────────────────────────────────────────────

describe("what the block shows under the visit's diagnoses", () => {
  it("the columns while the visit has none, folded once it has one, open again on a click", () => {
    expect(diagnosisAddView({ count: 0, opened: false, disabled: false })).toBe("pick");
    // The first pick folds them: «Назначения» comes up under the diagnosis.
    expect(diagnosisAddView({ count: 1, opened: false, disabled: false })).toBe("bar");
    // «+ Диагноз» opens them, and they stay open for the next picks.
    expect(diagnosisAddView({ count: 1, opened: true, disabled: false })).toBe("pick");
    expect(diagnosisAddView({ count: 3, opened: true, disabled: false })).toBe("pick");
  });

  it("four is the limit, and a note that cannot change offers nothing", () => {
    expect(
      diagnosisAddView({ count: MAX_VISIT_DIAGNOSES, opened: true, disabled: false }),
    ).toBe("full");
    expect(
      diagnosisAddView({ count: MAX_VISIT_DIAGNOSES, opened: false, disabled: false }),
    ).toBe("full");
    expect(diagnosisAddView({ count: 0, opened: false, disabled: true })).toBe("none");
    expect(diagnosisAddView({ count: 2, opened: true, disabled: true })).toBe("none");
  });
});

// ── Rendering helpers ────────────────────────────────────────────────────

const NOW = new Date("2026-10-03T07:00:00.000Z");
const messages = {
  ru: JSON.parse(readFileSync(path.join(process.cwd(), "src/messages/ru.json"), "utf8")),
  uz: JSON.parse(readFileSync(path.join(process.cwd(), "src/messages/uz.json"), "utf8")),
};

const MIGRAINE = { code: "G43.0", name: "Мигрень без ауры" };
const TENSION = { code: "G44.2", name: "Головная боль напряжённого типа" };
const LUMBAGO = { code: "M54.5", name: "Боль внизу спины" };
const CERVICALGIA = { code: "M54.2", name: "Цервикалгия" };

function noteOf(...dx: Array<{ code: string | null; name: string }>): VisitNoteRow {
  const [main, ...rest] = dx;
  return {
    id: "vn_1",
    patientId: "p_1",
    status: "DRAFT",
    finalizedAt: null,
    firstFinalizedAt: null,
    diagnosisCode: main?.code ?? null,
    diagnosisName: main?.name ?? null,
    additionalDiagnoses: rest,
    prescriptions: [],
    visitPrescriptions: [],
    advice: [],
    followUpDays: null,
    followUpDate: null,
    followUpNote: null,
  } as unknown as VisitNoteRow;
}

function client(seed: (qc: QueryClient) => void = () => undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(qc);
  return qc;
}

function render(
  el: React.ReactElement,
  { qc = client(), locale = "ru" as "ru" | "uz" } = {},
): string {
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(
        NextIntlClientProvider,
        { locale, messages: messages[locale], timeZone: "Asia/Tashkent", now: NOW },
        el,
      ),
    ),
  );
}

/** A picker slot that records what the card handed it. */
function slotSpy() {
  const calls: Array<Parameters<DiagnosisPickerSlot>[0]> = [];
  const picker: DiagnosisPickerSlot = (api) => {
    calls.push(api);
    return React.createElement("div", { "data-testid": "dx-columns" });
  };
  return { calls, picker };
}

const ADD_BAR = "Добавить ещё один диагноз";
const SEARCH_TAP = "Частые диагнозы или поиск по МКБ-10";
const PAST = "Было раньше";

function withPast(qc: QueryClient) {
  qc.setQueryData(patientDiagnosesKey("p_1"), [
    {
      visitNoteId: "vn_old",
      appointmentId: "a_old",
      date: "2026-09-12T06:00:00.000Z",
      diagnosisCode: LUMBAGO.code,
      diagnosisName: LUMBAGO.name,
      additionalDiagnoses: [],
      doctorName: "Азиз Каримов",
      doctorSpecialty: null,
      mine: true,
    },
  ]);
}

function card(note: VisitNoteRow, extra: Partial<React.ComponentProps<typeof DiagnosisCard>> = {}) {
  return React.createElement(DiagnosisCard, {
    note,
    disabled: false,
    standalone: true,
    onChange: () => undefined,
    ...extra,
  });
}

// ── 2. The shared card ───────────────────────────────────────────────────

describe("the card on the visit screen: the columns in place of the search", () => {
  it("an empty visit opens the columns, with nothing to fold onto", () => {
    const { calls, picker } = slotSpy();
    const html = render(card(noteOf(), { picker }));
    expect(html).toContain('data-testid="dx-columns"');
    expect(calls).toEqual([{ collapse: null, opened: false }]);
    expect(html).not.toContain(ADD_BAR);
    expect(html).not.toContain(SEARCH_TAP);
  });

  it("a visit with a diagnosis shows it and folds the columns into «+ Диагноз»", () => {
    const { calls, picker } = slotSpy();
    const html = render(card(noteOf(MIGRAINE), { picker }));
    expect(calls).toHaveLength(0);
    expect(html).not.toContain('data-testid="dx-columns"');
    expect(html).toContain(ADD_BAR);
    expect(html).toContain("1 из 4");
    // The row keeps its mark and actions.
    expect(html).toContain("Основной");
    expect(html).toContain("В хронические");
    expect(html).toContain("Мигрень без ауры");
  });

  it("four diagnoses: the note instead of the columns or the bar", () => {
    const { calls, picker } = slotSpy();
    const html = render(card(noteOf(MIGRAINE, TENSION, LUMBAGO, CERVICALGIA), { picker }));
    expect(calls).toHaveLength(0);
    expect(html).not.toContain(ADD_BAR);
    expect(html).toContain("В одном приёме не больше 4 диагнозов");
    expect(html).toContain("Сделать основным");
  });

  it("a signed note offers no way to add", () => {
    const { calls, picker } = slotSpy();
    const html = render(card(noteOf(MIGRAINE), { picker, disabled: true }));
    expect(calls).toHaveLength(0);
    expect(html).not.toContain(ADD_BAR);
    expect(html).not.toContain("В хронические");
  });

  it("«Было раньше» sits above the columns on the visit screen, at the bottom on the conclusion page", () => {
    const { picker } = slotSpy();
    const visit = render(card(noteOf(), { picker }), { qc: client(withPast) });
    expect(visit.indexOf(PAST)).toBeGreaterThan(-1);
    expect(visit.indexOf(PAST)).toBeLessThan(visit.indexOf('data-testid="dx-columns"'));
    expect(visit).toContain("Боль внизу спины");

    const folded = render(card(noteOf(MIGRAINE), { picker }), { qc: client(withPast) });
    expect(folded.indexOf(PAST)).toBeLessThan(folded.indexOf(ADD_BAR));

    // The conclusion page passes no picker: its order is unchanged.
    const conclusion = render(card(noteOf(MIGRAINE), { standalone: false }), {
      qc: client(withPast),
    });
    expect(conclusion.indexOf(ADD_BAR)).toBeGreaterThan(-1);
    expect(conclusion.indexOf(ADD_BAR)).toBeLessThan(conclusion.indexOf(PAST));
  });

  it("the conclusion page keeps its search and its hint", () => {
    const html = render(card(noteOf(), { standalone: false }));
    expect(html).toContain(SEARCH_TAP);
    expect(html).toContain("Нажмите на поле, чтобы увидеть свои частые диагнозы");
    expect(html).not.toContain('data-testid="dx-columns"');
  });
});

// ── 3. The picker ────────────────────────────────────────────────────────

const SHORTLIST: DiagnosisShortlist = {
  rows: [],
  frequent: [
    { code: MIGRAINE.code, name: MIGRAINE.name, count: 12, pinned: false },
    { code: null, name: "Тиннитус", count: 3, pinned: false },
  ],
  starred: [{ code: TENSION.code, name: TENSION.name, count: 0, pinned: true }],
};

function withLists(qc: QueryClient) {
  qc.setQueryData(diagnosisShortlistKey, SHORTLIST);
  qc.setQueryData(doctorFavoritesKey("ICD10"), [
    {
      id: "f1",
      userId: "u1",
      entityType: "ICD10",
      entityCode: TENSION.code,
      sortOrder: 0,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ]);
}

function picker(note: VisitNoteRow, onCollapse: (() => void) | null, locale: "ru" | "uz" = "ru") {
  return render(
    React.createElement(DiagnosisPicker, {
      note,
      liveNote: () => note,
      onChange: () => undefined,
      trail: [],
      onTrail: () => undefined,
      onCollapse,
    }),
    { qc: client(withLists), locale },
  );
}

/** The opening tag of the element that holds `marker`. */
function tagAround(html: string, marker: string, tag = "button"): string {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const start = html.lastIndexOf(`<${tag}`, at);
  return html.slice(start, html.indexOf(">", start) + 1);
}

describe("the three columns, inline", () => {
  it("«Частые», «Мои», «Каталог МКБ» with the doctor's own lists and the ICD chapters", () => {
    const html = picker(noteOf(), null);
    for (const title of ["Частые", "Мои", "Каталог МКБ"]) {
      expect(html).toContain(`>${title}</h3>`);
    }
    expect(html).toContain(">G43.0<");
    expect(html).toContain("Мигрень без ауры");
    expect(html).toContain("Ставили 12 раз за год");
    expect(html).toContain("Тиннитус");
    // «Мои»: his star, named from the server's list.
    expect(html).toContain("Головная боль напряжённого типа");
    // The catalog starts at the chapters.
    expect(html).toContain("G00-G99");
    // Tabs on a narrow card, columns from 440px of it.
    expect(html).toContain("@min-[440px]:hidden");
    expect(html).toContain('role="tablist"');
  });

  it("an empty visit: the next click makes the main diagnosis, and there is nothing to fold", () => {
    const html = picker(noteOf(), null);
    expect(tagAround(html, ">Основной</button>")).toContain('aria-checked="true"');
    expect(tagAround(html, ">Сопутствующий</button>")).toContain('aria-checked="false"');
    expect(html).not.toContain("Свернуть");
  });

  it("with a diagnosis: the next click adds a сопутствующий, the row on the visit is marked, «Свернуть» folds", () => {
    const html = picker(noteOf(MIGRAINE), () => undefined);
    expect(tagAround(html, ">Сопутствующий</button>")).toContain('aria-checked="true"');
    expect(html).toContain("Свернуть");
    const row = tagAround(html, 'title="Уже в приёме"');
    expect(row).toContain("disabled");
    // A diagnosis without a code cannot be starred; the coded ones can.
    expect(html.match(/aria-label="Закрепить в «Мои»"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Убрать из «Мои»"/g)).toHaveLength(1);
  });

  it("speaks Uzbek too", () => {
    const html = picker(noteOf(MIGRAINE), () => undefined, "uz");
    expect(html).toContain("Yig‘ish");
    expect(html).toContain(">Tez-tez</h3>");
    expect(html).toContain(">MKB katalogi</h3>");
  });
});

describe("the words of the block", () => {
  const flat = (o: unknown, prefix = ""): Record<string, string> =>
    typeof o === "string"
      ? { [prefix]: o }
      : Object.assign(
          {},
          ...Object.entries(o as Record<string, unknown>).map(([k, v]) =>
            flat(v, prefix ? `${prefix}.${k}` : k),
          ),
        );
  const picked = (loc: "ru" | "uz") =>
    flat(messages[loc].doctor.reception.diagnosis.picker, "diagnosis.picker");

  it("ru and uz carry the same keys, the new ones included, with no dashes", () => {
    const ru = picked("ru");
    const uz = picked("uz");
    expect(Object.keys(uz).sort()).toEqual(Object.keys(ru).sort());
    for (const key of ["diagnosis.picker.collapse", "diagnosis.picker.noVisit"]) {
      expect(ru[key], key).toBeTruthy();
      expect(uz[key], key).toBeTruthy();
    }
    for (const [key, text] of [...Object.entries(ru), ...Object.entries(uz)]) {
      expect(text, key).not.toMatch(/[—–]/);
    }
  });

  it("the window's words left with the window", () => {
    const ru = picked("ru");
    for (const gone of ["title", "description", "close", "done", "footerHint", "choose", "chooseHint"]) {
      expect(ru[`diagnosis.picker.${gone}`], gone).toBeUndefined();
    }
  });
});

// ── 4. One whole-line rule for the template text ─────────────────────────

describe("adding, naming and removing a template follow one whole-line rule", () => {
  const T = "МРТ головного мозга";

  it("a template inside a sentence and as its own paragraph: only the paragraph is named and removed", () => {
    const body = `Назначено: ${T} и ЭЭГ.\n\n${T}`;
    expect(hasSnippetParagraph(body, T)).toBe(true);
    expect(appendSnippet(body, T)).toBe(body);
    expect(templatesInBody(body, [{ name: "МРТ", text: T }])).toEqual([
      { name: "МРТ", text: T },
    ]);
    expect(removeSnippet(body, T)).toBe(`Назначено: ${T} и ЭЭГ.`);
    // The paragraph first, the sentence after it: the same.
    expect(removeSnippet(`${T}\n\nНазначено: ${T} и ЭЭГ.`, T)).toBe(
      `Назначено: ${T} и ЭЭГ.`,
    );
  });

  it("inside a sentence only: not named, not cut out, and still added as its own paragraph", () => {
    const body = `Назначено: ${T} и ЭЭГ.`;
    expect(templatesInBody(body, [{ name: "МРТ", text: T }])).toEqual([]);
    expect(removeSnippet(body, T)).toBe(body);
    // At the start of a sentence, and after the blank line a template
    // would have: still the doctor's sentence.
    expect(removeSnippet(`${T} назначено.`, T)).toBe(`${T} назначено.`);
    expect(removeSnippet(`Осмотр.\n\n${T} назначено.`, T)).toBe(
      `Осмотр.\n\n${T} назначено.`,
    );
    expect(appendSnippet(body, T)).toBe(`${body}\n\n${T}`);
  });

  it("what appendSnippet writes, removeSnippet takes out without a trace, wherever it stands", () => {
    expect(removeSnippet(appendSnippet("Осмотр.", T), T)).toBe("Осмотр.");
    expect(removeSnippet(`${T}\n\nОсмотр.`, T)).toBe("Осмотр.");
    expect(removeSnippet(`Осмотр.\n\n${T}\n\nДальше.`, T)).toBe("Осмотр.\n\nДальше.");
    expect(removeSnippet(`Осмотр.\n${T}\nДальше.`, T)).toBe("Осмотр.\nДальше.");
    expect(removeSnippet(T, T)).toBe("");
    // A template of two lines, saved with Windows line endings and spaces
    // at the ends of its lines; the endings of the rest are kept.
    const two = "Рекомендовано: МРТ.\nКонтроль через 14 дней.";
    expect(
      removeSnippet("Осмотр.\r\nЖалоб нет.\r\n\r\nРекомендовано: МРТ.  \r\nКонтроль через 14 дней. ", `${two}\n`),
    ).toBe("Осмотр.\r\nЖалоб нет.");
  });

  it("whatever the preview names, the removal takes out, and nothing else", () => {
    const bodies = [
      `Осмотр.\n\n${T}`,
      `${T}\n\nОсмотр.`,
      `Назначено: ${T} и ЭЭГ.`,
      `Назначено: ${T} и ЭЭГ.\n\n${T}`,
      `Осмотр.\n\n${T} назначено.`,
      `  ${T}  \r\nОсмотр.`,
      "Осмотр.",
      "",
    ];
    for (const body of bodies) {
      const named = templatesInBody(body, [{ name: "МРТ", text: T }]).length > 0;
      expect(hasSnippetParagraph(body, T), body).toBe(named);
      expect(removeSnippet(body, T) !== body, body).toBe(named);
      // Appending is a no-op exactly where the text is already a paragraph.
      expect(appendSnippet(body, T) === body, body).toBe(named);
    }
  });
});

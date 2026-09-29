/**
 * Clinic request 29.09.2026: «Контрольный визит» on the visit screen offers
 * the fixed day buttons AND lets the doctor type any number of days or pick
 * the exact day.
 *
 * Pinned on the rendered card (real ru / uz messages, 29 Sep 2026 noon):
 *   1. Presets, a «через [N] дн.» box and a date box sit together; the one
 *      holding the plan is highlighted, the others are not.
 *   2. The header shows the resulting day: «≈» for days, the bare day for
 *      an exact date.
 *   3. The date box offers tomorrow to a year ahead.
 *   4. A signed note is read-only: disabled controls, no ×, and only the
 *      choice that holds.
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FollowUpCard } from "@/app/[locale]/doctor/_components/diagnosis-follow-up-cards";
import type { VisitNoteRow } from "@/app/[locale]/doctor/reception/_hooks/use-visit-note";

const NOW = new Date("2026-09-29T07:00:00.000Z");

const messages = {
  ru: JSON.parse(readFileSync(path.join(process.cwd(), "src/messages/ru.json"), "utf8")),
  uz: JSON.parse(readFileSync(path.join(process.cwd(), "src/messages/uz.json"), "utf8")),
};

function row(over: Partial<VisitNoteRow> = {}): VisitNoteRow {
  return {
    id: "vn_1",
    status: "DRAFT",
    finalizedAt: null,
    followUpDays: null,
    followUpDate: null,
    followUpNote: null,
    ...over,
  } as VisitNoteRow;
}

function render(
  note: VisitNoteRow,
  { disabled = false, locale = "ru" as "ru" | "uz" } = {},
): string {
  return renderToStaticMarkup(
    React.createElement(NextIntlClientProvider, {
      locale,
      messages: messages[locale],
      timeZone: "Asia/Tashkent",
      now: NOW,
      children: React.createElement(FollowUpCard, {
        note,
        disabled,
        standalone: true,
        onChange: () => undefined,
      }),
    }),
  );
}

/** The opening tag of the first element matching `marker`. */
function tag(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

const DAYS_BOX = 'inputMode="numeric"';
const DATE_BOX = 'type="date"';
const ACTIVE = "bg-primary/10";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the card", () => {
  it("offers presets, «через [N] дн.» and a date together", () => {
    const html = render(row());
    for (const d of [3, 7, 10, 14, 30]) expect(html).toContain(`>${d} дн.</button>`);
    expect(html).toContain("через <input");
    expect(html).toContain("дн.</label>");
    expect(html).toContain("или дата");
    // Nothing chosen: nothing highlighted, no due day, no note field.
    expect(tag(html, DAYS_BOX)).not.toContain(ACTIVE);
    expect(tag(html, DATE_BOX)).not.toContain(ACTIVE);
    expect(html).not.toContain("≈");
    expect(html).not.toContain("Комментарий для регистратуры");
  });

  it("the date box runs from tomorrow to a year ahead", () => {
    const box = tag(render(row()), DATE_BOX);
    expect(box).toContain('min="2026-09-30"');
    expect(box).toContain('max="2027-09-29"');
  });

  it("a preset lights its button only", () => {
    const html = render(row({ followUpDays: 7 }));
    expect(tag(html, ">7 дн.<")).toContain('aria-pressed="true"');
    expect(tag(html, DAYS_BOX)).toContain('value=""');
    expect(tag(html, DAYS_BOX)).not.toContain(ACTIVE);
    // 29 Sep + 7 = Tue 6 Oct, an estimate.
    expect(html).toContain("≈ вт, 6 октября");
    expect(html).toContain("Комментарий для регистратуры");
  });

  it("a typed count lights the box and shows the resulting day", () => {
    const html = render(row({ followUpDays: 21 }));
    const box = tag(html, DAYS_BOX);
    expect(box).toContain('value="21"');
    expect(box).toContain(ACTIVE);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain("≈ вт, 20 октября");
  });

  it("an exact day lights the date box and shows the day without «≈»", () => {
    const html = render(
      row({ followUpDays: 16, followUpDate: "2026-10-15T00:00:00.000Z" }),
    );
    const box = tag(html, DATE_BOX);
    expect(box).toContain('value="2026-10-15"');
    expect(box).toContain(ACTIVE);
    // The 16 stored for older readers is not the doctor's choice.
    expect(tag(html, DAYS_BOX)).toContain('value=""');
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain("чт, 15 октября");
    expect(html).not.toContain("≈");
  });

  it("days of a signed note count from its signature", () => {
    const html = render(
      row({ status: "FINALIZED", followUpDays: 7, finalizedAt: "2026-09-20T07:00:00.000Z" }),
    );
    expect(html).toContain("≈ вс, 27 сентября");
  });

  it("uz: «[N] kundan keyin» and «yoki sana»", () => {
    const html = render(row({ followUpDays: 21 }), { locale: "uz" });
    expect(html).toMatch(/<input[^>]*value="21"[^>]*\/?> kundan keyin<\/label>/);
    expect(html).toContain("yoki sana");
  });
});

describe("read-only", () => {
  it("a signed exact day: disabled date box, no days box, no ×", () => {
    const html = render(
      row({ status: "FINALIZED", followUpDays: 16, followUpDate: "2026-10-15T00:00:00.000Z" }),
      { disabled: true },
    );
    expect(tag(html, DATE_BOX)).toContain("disabled");
    expect(html).not.toContain(DAYS_BOX);
    expect(html).not.toContain('aria-label="Сбросить"');
  });

  it("a signed preset: neither box", () => {
    const html = render(row({ status: "FINALIZED", followUpDays: 14 }), {
      disabled: true,
    });
    expect(html).not.toContain(DAYS_BOX);
    expect(html).not.toContain(DATE_BOX);
    expect(tag(html, ">14 дн.<")).toContain('aria-pressed="true"');
  });
});

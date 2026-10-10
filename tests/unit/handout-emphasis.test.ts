/**
 * The diagnosis and the prescription list are set larger and bold on the
 * patient's handout (doctor 10.10.2026), in the HTML print and the bot PDF.
 * Both find them the same way: the composer's own labels, in either
 * language. Hand-written text keeps its normal look.
 */
import { describe, expect, it } from "vitest";

import {
  composePatientHandout,
  handoutParagraphRole,
} from "@/lib/catalogs/handout-composer";
import {
  handoutBlockRoles,
  parseHandoutBlocks,
  renderHandoutHtml,
} from "@/server/visit-notes/render-handout";
import { renderConclusionPdf } from "@/server/visit-notes/conclusion-pdf";

const composed = (locale: "ru" | "uz") =>
  composePatientHandout({
    locale,
    patientName: "Иванов Иван",
    doctorName: "Султанов Азиз",
    doctorSpecialty: null,
    clinicName: "NeuroFax",
    visitDate: new Date("2026-10-10T08:00:00Z"),
    diagnosisName: "Мигрень без ауры",
    additionalDiagnosisNames: ["Артериальная гипертензия"],
    complaints: ["Головная боль"],
    prescriptions: [
      "Карбамазепин 200 мг — по ¼ таблетки 2 раза в день: утром и вечером после еды, постоянно",
      "Магний B6 — по 1 таблетке 1 раз в день",
    ],
    advice: ["Спать не меньше 8 часов"],
    followUp: null,
  });

describe("handoutParagraphRole", () => {
  it("finds the diagnosis, the other diagnoses and the prescriptions header in both languages", () => {
    expect(handoutParagraphRole("**Диагноз:** Мигрень")).toBe("dx");
    expect(handoutParagraphRole("**Tashxis:** Migren")).toBe("dx");
    expect(handoutParagraphRole("**Сопутствующие диагнозы:** ГБ")).toBe("dx-more");
    expect(handoutParagraphRole("**Yondosh tashxislar:** GB")).toBe("dx-more");
    expect(handoutParagraphRole("**Назначения — что и как принимать:**")).toBe("rx-header");
    expect(
      handoutParagraphRole("**Dori-darmonlar — nimani va qanday qabul qilish:**"),
    ).toBe("rx-header");
  });

  it("leaves hand-written text alone", () => {
    expect(handoutParagraphRole("Диагноз: мигрень")).toBeNull();
    expect(handoutParagraphRole("**Диагноз:**")).toBeNull();
    expect(handoutParagraphRole("Пейте больше воды")).toBeNull();
  });
});

describe("handoutBlockRoles", () => {
  it("marks the diagnosis paragraphs and only the list after the prescriptions header", () => {
    for (const locale of ["ru", "uz"] as const) {
      const blocks = parseHandoutBlocks(composed(locale));
      const roles = handoutBlockRoles(blocks);
      const marked = blocks
        .map((b, i) => [roles[i], b] as const)
        .filter(([r]) => r !== null);
      expect(marked.map(([r]) => r)).toEqual(["dx", "dx-more", "rx"]);
      const rx = marked[2][1];
      expect(rx.kind).toBe("bullets");
      if (rx.kind === "bullets") expect(rx.items).toHaveLength(2);
    }
  });

  it("does not mark the complaints or the advice lists", () => {
    const blocks = parseHandoutBlocks(composed("ru"));
    const roles = handoutBlockRoles(blocks);
    const lists = blocks.filter((b) => b.kind === "bullets");
    const rxLists = blocks.filter((b, i) => b.kind === "bullets" && roles[i] === "rx");
    expect(lists.length).toBeGreaterThan(rxLists.length);
  });
});

describe("renderHandoutHtml emphasis", () => {
  it("puts the classes on the diagnosis and the prescription list", () => {
    const html = renderHandoutHtml(composed("ru"));
    expect(html).toContain(`<p class="md-dx"><strong>Диагноз:</strong> Мигрень без ауры</p>`);
    expect(html).toContain(`<p class="md-dx-more">`);
    expect(html).toMatch(/<ul class="md-list md-rx"><li>Карбамазепин 200 мг — по ¼ таблетки/);
    expect(html.match(/md-rx/g)).toHaveLength(1);
  });

  it("renders a hand-written handout exactly as before", () => {
    const html = renderHandoutHtml("Диагноз: мигрень\n\n- Пить воду");
    expect(html).toBe(`<p>Диагноз: мигрень</p>\n<ul class="md-list"><li>Пить воду</li></ul>`);
  });
});

describe("renderConclusionPdf with the bold face", () => {
  it("renders a PDF that embeds the bold font", async () => {
    const pdf = await renderConclusionPdf({
      clinicName: "NeuroFax",
      patientName: "Иванов Иван",
      visitDateLabel: "10.10.2026",
      handoutMarkdown: composed("ru"),
      locale: "ru",
      generatedAt: new Date("2026-10-10T08:00:00Z"),
    });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).toMatch(/DejaVuSans-Bold/);
  });
});

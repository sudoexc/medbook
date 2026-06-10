/**
 * Ф1 (TZ-smart-constructor) — patient handout composer v2.
 *
 * Pins the deterministic composition contract: locale-aware strings (ru/uz),
 * fixed section order with guide blocks woven in, the follow-up precedence
 * (date > free text > generic fallback), and the empty-input short-circuit.
 */
import { describe, expect, it } from "vitest";

import {
  composePatientHandout,
  handoutSectionTitle,
} from "@/lib/catalogs/handout-composer";

const baseInput = {
  patientName: "Алиев Жасур Бахтиёрович",
  doctorName: "Каримова Н. Р.",
  doctorSpecialty: "невролог",
  clinicName: "NeuroFax",
  visitDate: new Date(2026, 5, 10),
  diagnosisName: "Мигрень с аурой",
  complaints: ["головная боль", "тошнота"],
  prescriptions: ["Суматриптан 50 мг — при приступе, не более 2 таб/сут"],
  advice: ["Сон 7–8 часов"],
};

describe("composePatientHandout — ru", () => {
  it("composes the full document in fixed order", () => {
    const out = composePatientHandout({
      ...baseInput,
      locale: "ru",
      guide: {
        whatToDo: "Уйдите в тихое тёмное помещение.",
        care: "Спите не менее 7–8 часов.",
        lifestyle: "Ограничьте кофеин.",
        redFlags: "Боль громоподобного характера.",
      },
    });

    expect(out).toContain("# Памятка для пациента");
    expect(out).toContain("Здравствуйте, Алиев!");
    expect(out).toContain("10 июня 2026");
    expect(out).toContain("у врача Каримова Н. Р.");
    expect(out).toContain("**Диагноз:** Мигрень с аурой");
    expect(out).toContain("- головная боль");
    expect(out).toContain("**Что делать:**\nУйдите в тихое тёмное помещение.");
    expect(out).toContain("- Суматриптан 50 мг");
    expect(out).toContain("**Уход и режим:**\nСпите не менее 7–8 часов.");
    expect(out).toContain("**Образ жизни и диета:**\nОграничьте кофеин.");
    expect(out).toContain("- Сон 7–8 часов");
    expect(out).toContain(
      "**Срочно обратитесь к врачу, если:**\nБоль громоподобного характера.",
    );
    expect(out).toContain("Берегите себя!");
    expect(out).toContain("— Каримова Н. Р., невролог, NeuroFax");

    // Order: what-to-do → prescriptions → care → lifestyle → advice → red flags.
    const idx = (s: string) => out.indexOf(s);
    expect(idx("**Что делать:**")).toBeLessThan(idx("**Назначения"));
    expect(idx("**Назначения")).toBeLessThan(idx("**Уход и режим:**"));
    expect(idx("**Уход и режим:**")).toBeLessThan(idx("**Образ жизни и диета:**"));
    expect(idx("**Образ жизни и диета:**")).toBeLessThan(idx("**Рекомендации"));
    expect(idx("**Рекомендации")).toBeLessThan(idx("**Срочно обратитесь"));
  });

  it("falls back to the generic follow-up line when no date/text given", () => {
    const out = composePatientHandout({ ...baseInput, locale: "ru" });
    expect(out).toContain("**Когда прийти ещё раз:**");
  });

  it("prefers followUpDate over free text and fallback", () => {
    const out = composePatientHandout({
      ...baseInput,
      locale: "ru",
      followUp: "через месяц",
      followUpDate: new Date(2026, 6, 8),
    });
    expect(out).toContain("**Повторный приём:** 8 июля 2026");
    expect(out).not.toContain("через месяц");
    expect(out).not.toContain("**Когда прийти ещё раз:**");
  });

  it("drops empty sections and returns '' when nothing meaningful", () => {
    const out = composePatientHandout({
      locale: "ru",
      complaints: [],
      prescriptions: [],
      advice: [],
    });
    expect(out).toBe("");

    const minimal = composePatientHandout({
      locale: "ru",
      diagnosisName: "Мигрень",
    });
    expect(minimal).toContain("**Диагноз:** Мигрень");
    expect(minimal).not.toContain("**Жалобы");
    expect(minimal).not.toContain("**Назначения");
  });
});

describe("composePatientHandout — uz", () => {
  it("uses uz strings and date format end-to-end", () => {
    const out = composePatientHandout({
      ...baseInput,
      locale: "uz",
      patientName: "Aliyev Jasur",
      guide: { whatToDo: "Tinch xonaga o‘ting.", redFlags: "Juda kuchli og‘riq." },
      followUpDate: new Date(2026, 6, 8),
    });

    expect(out).toContain("# Bemor uchun eslatma");
    expect(out).toContain("Assalomu alaykum, Aliyev!");
    expect(out).toContain("2026-yil 10-iyun kungi qabul yakunlari bo‘yicha");
    expect(out).toContain("**Tashxis:**");
    expect(out).toContain("**Nima qilish kerak:**\nTinch xonaga o‘ting.");
    expect(out).toContain(
      "**Zudlik bilan shifokorga murojaat qiling, agar:**\nJuda kuchli og‘riq.",
    );
    expect(out).toContain("**Qayta qabul:** 2026-yil 8-iyul");
    expect(out).toContain("O‘zingizni asrang!");
  });
});

describe("handoutSectionTitle", () => {
  it("matches the headers the composer writes", () => {
    expect(handoutSectionTitle("ru", "whatToDo")).toBe("**Что делать:**");
    expect(handoutSectionTitle("ru", "redFlags")).toBe(
      "**Срочно обратитесь к врачу, если:**",
    );
    expect(handoutSectionTitle("uz", "care")).toBe("**Parvarish va tartib:**");
    expect(handoutSectionTitle("uz", "lifestyle")).toBe(
      "**Turmush tarzi va parhez:**",
    );
  });
});

/**
 * Audit UX-06: the patient-facing screens speak Uzbek too.
 *
 * An elderly Uzbek-speaking patient chose Uzbek at the kiosk, got a Russian
 * queue page behind the QR and heard only «Талон X, пройдите в кабинет N»
 * from the TV: he did not understand he was the one being called.
 *
 * Acceptance pinned here:
 *   - the TV boards show their static labels in both languages;
 *   - the call is announced in the patient's language when known, with an
 *     uz-UZ voice when the box has one, falling back to ru-RU;
 *   - `queue.called` carries that language through the public stream;
 *   - `/q` follows the patient's language (or the ticket's `?lang=`), and the
 *     status API hands it the Uzbek names;
 *   - the ticket honours the kiosk's language and passes it on to the QR.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import {
  announcementText,
  planAnnouncement,
  type BoardTranslator,
} from "@/lib/tv-announce";
import { parseQueueCalledPayload } from "@/lib/queue-call";
import { projectBoardEvent } from "@/server/realtime/board-stream";

const state = vi.hoisted(() => ({
  appointment: null as Record<string, unknown> | null,
  qrText: "",
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: { findUnique: vi.fn(async () => state.appointment) },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runUnscoped: <T,>(_reason: string, fn: () => T) => fn(),
}));
vi.mock("@/server/appointments/queue-projection", () => ({
  getQueueProjection: vi.fn(
    async () =>
      new Map([
        ["doc_1", { waiting: [{ appointmentId: "apt_1", position: 2, etaMinutes: 15 }] }],
      ]),
  ),
}));
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async (text: string) => {
      state.qrText = text;
      return "data:image/png;base64,AA==";
    }),
  },
}));

function tvT(lang: "ru" | "uz"): BoardTranslator {
  const t = createTranslator({
    locale: lang,
    messages: { tvBoard: (lang === "uz" ? uz : ru).tvBoard },
    namespace: "tvBoard",
  });
  return (key, values) => (t as unknown as BoardTranslator)(key, values);
}

function walkin(over: Record<string, unknown> = {}) {
  return {
    id: "apt_1",
    queueOrder: 7,
    ticketSeq: 7,
    clinicId: "c1",
    date: new Date("2026-09-23T04:15:00.000Z"),
    time: "09:15",
    channel: "WALKIN",
    doctorId: "doc_1",
    queueStatus: "WAITING",
    patient: { fullName: "Турматов Олим Ботирович", preferredLang: "RU" },
    doctor: {
      id: "doc_1",
      nameRu: "Султанов Азиз",
      nameUz: "Sultonov Aziz",
      ticketPrefix: "A",
      cabinet: { number: "3" },
    },
    primaryService: { nameRu: "Консультация невролога", nameUz: "Nevrolog maslahati" },
    clinic: {
      nameRu: "Клиника Тест",
      nameUz: "Test Klinikasi",
      slug: "test",
      phone: null,
      addressRu: null,
      addressUz: null,
    },
    ...over,
  };
}

beforeEach(() => {
  state.appointment = walkin();
  state.qrText = "";
});

describe("the TV call, in the patient's language", () => {
  const call = { patientName: "Каримова Д.", cabinet: "5", ticketNumber: "A-007" };

  it("builds the spoken line in both languages from the bundles", () => {
    expect(announcementText(tvT("ru"), call)).toBe("Каримова Д., пройдите в кабинет 5");
    expect(announcementText(tvT("uz"), call)).toBe("Каримова Д., 5-kabinetga kiring");
    expect(
      announcementText(tvT("uz"), { patientName: "", cabinet: "5", ticketNumber: "A-007" }),
    ).toBe("Talon A-007, 5-kabinetga kiring");
    expect(
      announcementText(tvT("uz"), { patientName: "", cabinet: "", ticketNumber: "" }),
    ).toBe("Navbatdagi bemor, kiring");
    expect(
      announcementText(tvT("ru"), { patientName: "", cabinet: "", ticketNumber: "" }),
    ).toBe("Следующий пациент, проходите");
  });

  it("speaks Uzbek to an Uzbek-speaking patient when the box has an uz-UZ voice", () => {
    const texts = { ru: "RU line", uz: "UZ line" };
    const voices = [
      { lang: "ru-RU", name: "Milena" },
      { lang: "uz_UZ", name: "Madina" },
    ];
    expect(planAnnouncement(texts, "uz", voices)).toEqual({
      text: "UZ line",
      lang: "uz-UZ",
      voice: { lang: "uz_UZ", name: "Madina" },
    });
  });

  it("falls back to the Russian call without an Uzbek voice, and for everyone else", () => {
    const texts = { ru: "RU line", uz: "UZ line" };
    const ruOnly = [{ lang: "ru-RU", name: "Milena" }];
    expect(planAnnouncement(texts, "uz", ruOnly)).toMatchObject({
      text: "RU line",
      lang: "ru-RU",
    });
    expect(planAnnouncement(texts, "ru", ruOnly).lang).toBe("ru-RU");
    expect(planAnnouncement(texts, null, []).text).toBe("RU line");
  });

  it("the patient's language rides the public board stream to the TV", () => {
    const ev = projectBoardEvent({
      type: "queue.called",
      payload: {
        appointmentId: "apt_1",
        doctorId: "doc_1",
        patientId: "p_secret",
        patientName: "Каримова Д.",
        lang: "uz",
      },
    });
    expect(ev?.payload.lang).toBe("uz");
    expect(ev?.payload).not.toHaveProperty("patientId");
    expect(parseQueueCalledPayload(ev?.payload).lang).toBe("uz");
    expect(parseQueueCalledPayload({ lang: "en" }).lang).toBeNull();
  });

  it("both TV pages announce with the call's language", () => {
    for (const file of ["src/app/tv/page.tsx", "src/app/tv/d/[token]/page.tsx"]) {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src, file).toContain("lang: call.lang");
      // No Cyrillic label left hard-coded in the markup.
      const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, file).not.toMatch(/[А-Яа-яЁё]/);
    }
  });
});

describe("the TV boards show their labels in both languages", () => {
  it("the call takeover reads in Russian and Uzbek", async () => {
    const { TvI18nProvider } = await import("@/app/tv/_i18n");
    const { CallTakeover } = await import("@/app/tv/_shared");
    const html = renderToStaticMarkup(
      React.createElement(TvI18nProvider, {
        messages: { ru: ru.tvBoard, uz: uz.tvBoard },
        children: React.createElement(CallTakeover, {
          cabinet: "5",
          patientName: "Каримова Д.",
          ticketNumber: "A-007",
        }),
      }),
    );
    expect(html).toContain("Пройдите в кабинет");
    expect(html).toContain("Kabinetga kiring");
    expect(html).toContain("Талон");
    expect(html).toContain("Talon");
  });

  it("every TV and /q label exists in both languages, without dashes", () => {
    const keys = (o: unknown, p = ""): string[] =>
      typeof o === "string"
        ? [p]
        : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
            keys(v, p ? `${p}.${k}` : k),
          );
    for (const ns of ["tvBoard", "queueStatusPage"] as const) {
      expect(keys(uz[ns]).sort(), ns).toEqual(keys(ru[ns]).sort());
      expect(JSON.stringify(ru[ns]) + JSON.stringify(uz[ns]), ns).not.toMatch(/[—–]/);
    }
  });
});

describe("/q follows the patient's language", () => {
  it("the status API names the language and carries the Uzbek names", async () => {
    state.appointment = walkin({
      patient: { fullName: "Aliyev Vali", preferredLang: "UZ" },
    });
    const { GET } = await import("@/app/api/queue/status/[id]/route");
    const res = await GET(new Request("https://x/api/queue/status/apt_1"), {
      params: Promise.resolve({ id: "apt_1" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      lang: "uz",
      doctorName: "Султанов Азиз",
      doctorNameUz: "Sultonov Aziz",
      serviceUz: "Nevrolog maslahati",
      clinicNameUz: "Test Klinikasi",
    });
  });

  it("a Russian card reads «ru»", async () => {
    const { GET } = await import("@/app/api/queue/status/[id]/route");
    const res = await GET(new Request("https://x/api/queue/status/apt_1"), {
      params: Promise.resolve({ id: "apt_1" }),
    });
    expect(((await res.json()) as Record<string, unknown>).lang).toBe("ru");
  });

  it("the page opens in the ticket's language before the status arrives", async () => {
    const { default: Page } = await import("@/app/q/[id]/page");
    const el = await Page({
      params: Promise.resolve({ id: "apt_1" }),
      searchParams: Promise.resolve({ lang: "uz" }),
    });
    expect(renderToStaticMarkup(el)).toContain("Yuklanmoqda");
    const ruEl = await Page({
      params: Promise.resolve({ id: "apt_1" }),
      searchParams: Promise.resolve({}),
    });
    expect(renderToStaticMarkup(ruEl)).toContain("Загрузка");
  });
});

describe("the ticket keeps the kiosk's language", () => {
  it("?lang=uz prints Uzbek for a Russian card and sends the QR to the Uzbek /q", async () => {
    const { default: TicketPage } = await import("@/app/ticket/[id]/page");
    const el = await TicketPage({
      params: Promise.resolve({ id: "apt_1" }),
      searchParams: Promise.resolve({ lang: "uz" }),
    });
    const html = renderToStaticMarkup(el as React.ReactElement);
    expect(html).toContain("Sizning raqamingiz");
    expect(state.qrText).toMatch(/\/q\/apt_1\?lang=uz$/);
  });

  it("without it the card's language wins and the QR carries it", async () => {
    const { default: TicketPage } = await import("@/app/ticket/[id]/page");
    const el = await TicketPage({ params: Promise.resolve({ id: "apt_1" }) });
    const html = renderToStaticMarkup(el as React.ReactElement);
    expect(html).toContain("Ваш номер");
    expect(state.qrText).toMatch(/\/q\/apt_1\?lang=ru$/);
  });
});

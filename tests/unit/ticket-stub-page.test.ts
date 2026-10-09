/**
 * Audit Q-11: the paper ticket at /ticket/<id> prints the clinic's local time
 * and the clinic's own name, address and phone.
 *
 * It is a server component, the server runs UTC, and the time came from a
 * bare `toLocaleTimeString`: a walk-in who joined the queue at 09:15 got a
 * slip saying 04:15. The header and footer were hard-coded («NEUROFAX-B»,
 * «Неврологический центр», a phone that matched no clinic), so every clinic
 * on the platform printed somebody else's brand.
 *
 * The page is rendered to markup with the process forced to UTC, opened by
 * the front desk (a staff session of the clinic, audit INF-10).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appointment: null as Record<string, unknown> | null,
  position: 3,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async () => state.appointment),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", role: "RECEPTIONIST", clinicId: "c1" } })),
}));

vi.mock("@/lib/tenant-context", () => ({
  runUnscoped: <T,>(_reason: string, fn: () => T) => fn(),
}));

vi.mock("@/server/appointments/queue-projection", () => ({
  getQueueProjection: vi.fn(async () =>
    new Map([
      [
        "doc_1",
        {
          waiting: [
            { appointmentId: "cmapt000000000000000001", position: state.position },
          ],
        },
      ],
    ]),
  ),
}));

const APPT_ID = "cmapt000000000000000001";

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
  // The QR carries a signed ticket token (audit INF-10).
  process.env.APP_SECRET = "test-app-secret";
});
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function walkin(over: Record<string, unknown> = {}) {
  return {
    queueOrder: 7,
    ticketSeq: 7,
    clinicId: "c1",
    // 09:15 in Tashkent is 04:15 UTC.
    date: new Date("2026-09-23T04:15:00.000Z"),
    time: "09:15",
    channel: "WALKIN",
    doctorId: "doc_1",
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
      phone: "+998901112233",
      addressRu: "Ташкент, ул. Примерная 1",
      addressUz: "Toshkent, Namuna ko‘chasi 1",
    },
    ...over,
  };
}

async function render(): Promise<string> {
  const { default: TicketPage } = await import("@/app/ticket/[id]/page");
  const el = await TicketPage({ params: Promise.resolve({ id: APPT_ID }) });
  return renderToStaticMarkup(el as React.ReactElement);
}

beforeEach(() => {
  state.appointment = walkin();
  state.position = 3;
});

describe("/ticket/<id> stub", () => {
  it("a walk-in issued at 09:15 Tashkent time prints 09:15, not the UTC 04:15", async () => {
    const html = await render();
    expect(html).toContain("23.09.2026, 09:15");
    expect(html).not.toContain("04:15");
  });

  it("prints the clinic's own name, address and phone", async () => {
    const html = await render();
    expect(html).toContain("Клиника Тест");
    expect(html).toContain("Ташкент, ул. Примерная 1");
    expect(html).toContain("+998 (90) 111-22-33");
    expect(html).not.toContain("NEUROFAX-B");
    expect(html).not.toContain("Неврологический центр");
    expect(html).not.toContain("200 00 07");
  });

  it("carries the doctor's ticket letter and the queue position", async () => {
    const html = await render();
    expect(html).toContain("A-007");
    expect(html).toContain("Султанов Азиз");
    expect(html).toContain("2 чел.");
    // Initials only on a public page.
    expect(html).toContain("Турматов О. Б.");
    expect(html).not.toContain("Олим");
  });

  it("speaks the patient's language", async () => {
    state.appointment = walkin({
      patient: { fullName: "Aliyev Vali", preferredLang: "UZ" },
    });
    const html = await render();
    expect(html).toContain("Test Klinikasi");
    expect(html).toContain("Sultonov Aziz");
    expect(html).toContain("Sizning raqamingiz");
    expect(html).toContain("2 kishi");
    expect(html).toContain("09:15");
  });

  it("a booking without a ticket leads with its slot time in clinic time", async () => {
    state.appointment = walkin({
      queueOrder: null,
      ticketSeq: null,
      channel: "PHONE",
      time: null,
      date: new Date("2026-09-23T09:40:00.000Z"),
    });
    const html = await render();
    expect(html).toContain("Ваше время");
    expect(html).toContain("14:40");
    expect(html).not.toContain("09:40");
  });

  it("leaves out empty clinic fields instead of printing placeholders", async () => {
    state.appointment = walkin({
      clinic: {
        nameRu: "Клиника Тест",
        nameUz: "Test Klinikasi",
        phone: null,
        addressRu: null,
        addressUz: null,
      },
      doctor: {
        id: "doc_1",
        nameRu: "Султанов Азиз",
        nameUz: "Sultonov Aziz",
        ticketPrefix: "A",
        cabinet: null,
      },
    });
    const html = await render();
    expect(html).toContain("Клиника Тест");
    expect(html).not.toContain("Кабинет:");
    expect(html).not.toContain("—");
  });
});

// Owner report 08.10.2026: on the desk's Xprinter XP-80 the small lines were
// hard to read. The slip fits the printer's 72mm band (no shrink-to-fit) and
// prints in black, nothing under 13px.
describe("the slip on an 80mm thermal printer", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/ticket/[id]/page.tsx"), "utf8");
  const slip = src.slice(src.indexOf('width: "72mm"'));

  it("fits the 72mm printable band with no page margin", () => {
    expect(src).toContain('width: "72mm"');
    expect(src).toContain('boxSizing: "border-box"');
    expect(src).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(src).not.toContain('width: "80mm"');
  });

  it("prints black and nothing smaller than 13px", () => {
    expect(slip).not.toMatch(/#666|#999/);
    const sizes = [...slip.matchAll(/fontSize: "(\d+)px"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(13);
  });
});

// Owner report 08.10.2026: «Распечатать» at the desk opened a new tab that
// stayed open. Both the desk and the iPad print through one hidden frame.
describe("printing the slip from the desk and the iPad", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("the desk prints through the hidden frame, never a new tab", () => {
    const dialog = read("src/app/[locale]/crm/reception/_components/walkin-ticket-dialog.tsx");
    expect(dialog).not.toContain("window.open(`/ticket/");
    expect(dialog).toContain("<TicketPrintFrame");
    // A print pressed for one ticket never fires for the next one.
    expect(dialog).toContain("job={printJob?.id === ticket.appointmentId ? printJob.n : 0}");
  });

  it("the iPad uses the same frame, and the frame matches the slip's page", () => {
    const done = read("src/app/[locale]/crm/reception/tablet/_components/done-screen.tsx");
    expect(done).toContain('import { TicketPrintFrame } from "@/components/ticket/ticket-print-frame";');
    expect(done).not.toContain("function TicketPrintFrame");
    const frame = read("src/components/ticket/ticket-print-frame.tsx");
    expect(frame).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(frame).toContain("key={job}");
    expect(frame).toContain("if (job === 0) return null;");
  });
});

// Owner request 09.10.2026: the slip's QR leads to the clinic's Telegram bot
// («отсканируйте, чтобы получать свои документы»), not the queue page.
describe("the slip's QR leads to the clinic's bot", () => {
  const msg = (lang: string) =>
    JSON.parse(readFileSync(path.join(process.cwd(), `src/messages/${lang}.json`), "utf8")) as {
      ticketStub: { botTitle: string; botScan: string };
    };
  const ru = msg("ru");
  const uz = msg("uz");
  const src = readFileSync(path.join(process.cwd(), "src/app/ticket/[id]/page.tsx"), "utf8");

  it("an unlinked patient gets the invite deep link, a linked one the bot, no bot keeps the queue link", () => {
    expect(src).toContain("mintOrReuseInviteUrl({ patientId: appointment.patientId, createdByUserId: null })");
    expect(src).toContain("const botUrl = botUsername ? (invite?.url ?? `https://t.me/${botUsername}`) : null;");
    expect(src).toContain("QRCode.toDataURL(botUrl ?? statusUrl,");
    expect(src).toContain('{t("botTitle")}');
  });

  it("says so in both languages, without dashes", () => {
    for (const m of [ru, uz]) {
      expect(m.ticketStub.botTitle).toMatch(/Telegram/);
      expect(m.ticketStub.botScan).toMatch(/QR/);
      expect(`${m.ticketStub.botTitle} ${m.ticketStub.botScan}`).not.toMatch(/[—–]/);
    }
  });
});

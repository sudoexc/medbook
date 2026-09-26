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
 * The page is rendered to markup with the process forced to UTC.
 */
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
            { appointmentId: "apt_1", position: state.position },
          ],
        },
      ],
    ]),
  ),
}));

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
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
  const el = await TicketPage({ params: Promise.resolve({ id: "apt_1" }) });
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

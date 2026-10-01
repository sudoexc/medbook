/**
 * Audit Q-09: the kiosk opened every ticket in a new tab that stayed on the
 * screen, so the next visitor saw the previous patient's ticket (initials,
 * doctor, a QR to the status page) instead of the start screen, and by
 * evening the browser held hundreds of tabs.
 *
 * Now the stub prints in a hidden frame on the kiosk's own page, which the
 * 30 second reset takes away with it. The frame cannot send the device
 * header, so it opens the stub with a short-lived kiosk print key, and the
 * slip it prints names the service the patient chose (Q-06), while the
 * QR's token still never shows it (INF-10).
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appointment: null as Record<string, unknown> | null,
  lookups: 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async () => {
        state.lookups += 1;
        return state.appointment;
      }),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  runUnscoped: <T,>(_reason: string, fn: () => T) => fn(),
}));
vi.mock("@/server/appointments/queue-projection", () => ({
  getQueueProjection: vi.fn(async () => new Map()),
}));

import {
  KIOSK_PRINT_TTL_MS,
  kioskPrintToken,
  parseKioskPrintToken,
  parseQueueTicketToken,
  queueTicketToken,
  resolveTicketStubRequest,
  ticketStubVerdict,
} from "@/server/appointments/public-ticket";
import { ticketPrintSrc } from "@/lib/kiosk-flow";

const APPT_ID = "cmapt000000000000000001";

beforeAll(() => {
  process.env.APP_SECRET = "test-app-secret";
});

function walkin(): Record<string, unknown> {
  return {
    queueOrder: 7,
    ticketSeq: 7,
    clinicId: "c1",
    date: new Date(),
    time: null,
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
    primaryService: { nameRu: "ЭЭГ", nameUz: "EEG" },
    clinic: { nameRu: "Клиника", nameUz: "Klinika", phone: null, addressRu: null, addressUz: null },
  };
}

async function stub(ref: string): Promise<string> {
  const { default: TicketPage } = await import("@/app/ticket/[id]/page");
  const el = await TicketPage({ params: Promise.resolve({ id: ref }) });
  return renderToStaticMarkup(el as React.ReactElement);
}

beforeEach(() => {
  state.appointment = walkin();
  state.lookups = 0;
});

describe("the kiosk print key", () => {
  it("round-trips, and is neither the id nor a queue token", () => {
    const now = new Date("2026-10-01T06:00:00.000Z");
    const key = kioskPrintToken(APPT_ID, now);
    expect(key.startsWith("k~")).toBe(true);
    expect(parseKioskPrintToken(key, now)).toEqual({ kind: "print", appointmentId: APPT_ID });
    expect(parseQueueTicketToken(key).kind).toBe("invalid");
    // A queue token is not a print key.
    expect(parseKioskPrintToken(queueTicketToken(APPT_ID), now)).toBeNull();
  });

  it("dies after its time, and a forged one says nothing about expiry", () => {
    const now = new Date("2026-10-01T06:00:00.000Z");
    const key = kioskPrintToken(APPT_ID, now);
    const later = new Date(now.getTime() + KIOSK_PRINT_TTL_MS + 1000);
    expect(parseKioskPrintToken(key, later)).toEqual({ kind: "expired" });
    const [head, exp] = key.split(".");
    expect(parseKioskPrintToken(`${head}.${exp}.AAAAAAAAAAAAAAAAAAAAAA`, now)).toEqual({ kind: "invalid" });
    // Moving the expiry breaks the signature.
    expect(parseKioskPrintToken(`${head}.zzzzzz.${key.split(".")[2]}`, now)).toEqual({ kind: "invalid" });
  });

  it("opens the stub as the kiosk: today only, service line included", async () => {
    const now = new Date();
    const req = await resolveTicketStubRequest(kioskPrintToken(APPT_ID, now), async () => null, now);
    expect(req).toEqual({ kind: "lookup", appointmentId: APPT_ID, viewer: "kiosk" });
    if (req.kind !== "lookup") throw new Error("unreachable");
    expect(ticketStubVerdict(req, { clinicId: "c1", date: now }, now)).toEqual({ ok: true, showService: true });
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(ticketStubVerdict(req, { clinicId: "c1", date: yesterday }, now).ok).toBe(false);
  });

  it("an expired key is refused before any lookup", async () => {
    const issued = new Date(Date.now() - KIOSK_PRINT_TTL_MS - 60_000);
    const req = await resolveTicketStubRequest(kioskPrintToken(APPT_ID, issued), async () => null);
    expect(req).toEqual({ kind: "refuse", reason: "expired" });
  });
});

describe("the printed slip", () => {
  it("printed by the kiosk: «Услуга» names the service the patient chose (Q-06)", async () => {
    const html = await stub(kioskPrintToken(APPT_ID));
    expect(html).toContain("A-007");
    expect(html).toContain("ЭЭГ");
    expect(html).toContain("Турматов О. Б.");
    expect(html).not.toContain("Олим");
  });

  it("opened from the QR's token: still no service (INF-10)", async () => {
    const html = await stub(queueTicketToken(APPT_ID));
    expect(html).toContain("A-007");
    expect(html).not.toContain("ЭЭГ");
  });

  it("an expired print key shows nothing", async () => {
    const html = await stub(kioskPrintToken(APPT_ID, new Date(Date.now() - 2 * KIOSK_PRINT_TTL_MS)));
    expect(state.lookups).toBe(0);
    expect(html).not.toContain("A-007");
    expect(html).not.toContain("Турматов");
  });
});

describe("the kiosk page prints in place", () => {
  const page = readFileSync(path.join(process.cwd(), "src/app/kiosk/page.tsx"), "utf8");

  it("opens no window or tab", () => {
    expect(page).not.toMatch(/window\.open\(/);
    expect(page).not.toMatch(/_blank/);
  });

  it("loads the stub in a hidden frame keyed per print job", () => {
    expect(page).toMatch(/<iframe[\s\S]*?key=\{printJob\.seq\}[\s\S]*?src=\{ticketPrintSrc\(printJob\)\}/);
  });

  it("the frame points at the same-origin stub in the language of the job", () => {
    expect(ticketPrintSrc({ token: "k~abc.def.ghi", lang: "uz" })).toBe("/ticket/k~abc.def.ghi?lang=uz");
  });
});

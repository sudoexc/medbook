/**
 * Audit P1D-02: relatives on a shared number can check in at the kiosk.
 *
 * The lookup found one owner of the number and listed that card's bookings
 * only. A son registered at the desk under his mother's phone, or a child
 * she booked for in the Mini App (a `family:` card without a phone), typed
 * the family number and saw nothing: the kiosk sent him to «choose a
 * doctor» and his real booking later decayed to NO_SHOW.
 *
 * Pinned here:
 *   - findKioskCards: the owner (or the claim), relatives under the number,
 *     relatives linked in the Mini App; a claim's relatives stay flagged;
 *   - GET /api/kiosk/checkin lists everyone with a booking (the owner
 *     always), each with their own bookings, so the kiosk can ask «Кто
 *     пришёл?»;
 *   - the walk-in takes a picked card only when the number stands for it,
 *     keeps the visit on that card, and turns a confirmed claim verified;
 *   - the kiosk's flow: several cards → «who», one → «Это вы?».
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Card = { id: string; fullName: string; birthDate: Date | null };

const h = vi.hoisted(() => ({
  owners: [] as Card[],
  claim: null as Card | null,
  sharers: [] as Card[],
  family: [] as Array<{ linkedPatient: { id: string; fullName: string; deletedAt: Date | null } }>,
  familyArgs: [] as Array<Record<string, unknown>>,
  bookingsByPatient: new Map<string, Array<Record<string, unknown>>>(),
  walkinCalls: [] as Array<Record<string, unknown>>,
  walkinResult: null as unknown,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
vi.mock("@/server/kiosk/device", () => ({
  requireKioskFor: vi.fn(async () => ({ ok: true })),
  authenticateKiosk: vi.fn(async () => ({ clinicId: "c1", clinicSlug: "neurofax" })),
  kioskUnauthorized: () => new Response(null, { status: 401 }),
  realClientIp: () => "10.0.0.1",
  maskPatientName: (n: string) => `${n.split(" ")[0]} ${n.split(" ")[1]?.[0] ?? ""}.`,
}));
vi.mock("@/server/clinic-public/resolve", () => ({
  resolvePublicClinic: vi.fn(async () => ({
    ok: true,
    ctx: { clinicId: "c1", clinicSlug: "neurofax" },
  })),
}));
vi.mock("@/server/patient/phone-identity", () => ({
  findVerifiedPhoneOwners: vi.fn(async () => h.owners),
  findPhoneClaim: vi.fn(async () => h.claim),
  findContactSharers: vi.fn(async () => h.sharers),
}));
vi.mock("@/server/appointments/walkin", () => ({
  registerWalkin: vi.fn(async (input: Record<string, unknown>) => {
    h.walkinCalls.push(input);
    return h.walkinResult;
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    patientFamily: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        h.familyArgs.push(args);
        return h.family;
      }),
    },
    appointment: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async ({ where }: { where: { patientId: string | { in: string[] } } }) => {
        const ids = typeof where.patientId === "string" ? [where.patientId] : where.patientId.in;
        return ids.flatMap((id) => h.bookingsByPatient.get(id) ?? []);
      }),
    },
  },
}));

import { tashkentDayBounds } from "@/lib/booking-validation";
import { prisma } from "@/lib/prisma";
import { findKioskCards, MAX_KIOSK_CARDS } from "@/server/kiosk/phone-cards";
import {
  lookupPeople,
  personBookingHint,
  stepAfterLookup,
  stepForPerson,
  walkinRequestBody,
  type KioskPerson,
} from "@/lib/kiosk-flow";

const MOTHER: Card = { id: "p_mother", fullName: "Каримова Дилноза", birthDate: null };
const SON: Card = { id: "p_son", fullName: "Каримов Тимур", birthDate: null };
const CHILD = { id: "p_child", fullName: "Каримова Мадина", deletedAt: null };

function todayBooking(patientId: string, id: string) {
  const { dayStart } = tashkentDayBounds();
  return {
    id,
    patientId,
    // 23:00 Tashkent today, whatever time the suite runs.
    date: new Date(dayStart.getTime() + 23 * 60 * 60_000),
    primaryService: null,
    queueOrder: null,
    ticketSeq: null,
    queueStatus: "CONFIRMED",
    doctor: { id: "doc_1", nameRu: "Невролог", ticketPrefix: "A", cabinet: { number: "3" } },
  };
}

beforeAll(() => {
  process.env.APP_SECRET = "test-app-secret";
});

beforeEach(() => {
  h.owners = [];
  h.claim = null;
  h.sharers = [];
  h.family = [];
  h.familyArgs = [];
  h.bookingsByPatient = new Map();
  h.walkinCalls = [];
  h.walkinResult = null;
});

describe("findKioskCards", () => {
  it("the owner, a relative under the number, a relative linked in the Mini App", async () => {
    h.owners = [MOTHER];
    h.sharers = [SON];
    h.family = [{ linkedPatient: CHILD }];
    const cards = await findKioskCards(prisma, "c1", "+998901234567");
    expect(cards.map((c) => [c.id, c.relation, c.unverified])).toEqual([
      ["p_mother", "owner", false],
      ["p_son", "contact", false],
      ["p_child", "family", false],
    ]);
    // Family of the number's own cards only, in this clinic.
    expect(h.familyArgs[0]!.where).toEqual({ clinicId: "c1", ownerPatientId: { in: ["p_mother"] } });
  });

  it("a claim's relatives are as unproven as the claim; deleted or repeated cards drop out", async () => {
    h.claim = MOTHER;
    h.family = [
      { linkedPatient: CHILD },
      { linkedPatient: { id: "p_gone", fullName: "Удалён", deletedAt: new Date() } },
      { linkedPatient: { id: "p_mother", fullName: MOTHER.fullName, deletedAt: null } },
    ];
    const cards = await findKioskCards(prisma, "c1", "+998901234567");
    expect(cards.map((c) => [c.id, c.relation, c.unverified])).toEqual([
      ["p_mother", "claim", true],
      ["p_child", "family", true],
    ]);
  });

  it("a whole office on one number is cut to a family's worth", async () => {
    h.owners = [MOTHER];
    h.sharers = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, fullName: `Сотрудник ${i}`, birthDate: null }));
    const cards = await findKioskCards(prisma, "c1", "+998901234567");
    expect(cards).toHaveLength(MAX_KIOSK_CARDS);
    expect(cards[0]!.id).toBe("p_mother");
  });
});

describe("GET /api/kiosk/checkin with a family on one number", () => {
  it("the child the mother booked for in the Mini App is offered with her own booking", async () => {
    h.owners = [MOTHER];
    h.family = [{ linkedPatient: CHILD }];
    h.bookingsByPatient.set("p_child", [todayBooking("p_child", "appt_child")]);
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const body = await (await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"))).json();

    expect(body.patient.id).toBe("p_mother");
    expect(body.appointments).toEqual([]);
    expect(body.people.map((p: KioskPerson) => p.id)).toEqual(["p_mother", "p_child"]);
    const child = body.people[1] as KioskPerson;
    // Masked, like every name on the kiosk.
    expect(child.fullName).toBe("Каримова М.");
    expect(child.appointments.map((a) => a.id)).toEqual(["appt_child"]);
  });

  it("a relative with nothing booked is not listed: he registers by name", async () => {
    h.owners = [MOTHER];
    h.sharers = [SON];
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const body = await (await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"))).json();
    expect(body.people.map((p: KioskPerson) => p.id)).toEqual(["p_mother"]);
  });

  it("a relative under the number alone (no owner card) is still found", async () => {
    h.sharers = [SON];
    h.bookingsByPatient.set("p_son", [todayBooking("p_son", "appt_son")]);
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const body = await (await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"))).json();
    expect(body.patient.id).toBe("p_son");
    expect(body.appointments.map((a: { id: string }) => a.id)).toEqual(["appt_son"]);
  });

  it("…but with nothing booked he is a first visit: no name is revealed", async () => {
    h.sharers = [SON];
    const { GET } = await import("@/app/api/kiosk/checkin/route");
    const body = await (await GET(new Request("https://x/api/kiosk/checkin?phone=%2B998901234567"))).json();
    expect(body).toEqual({ patient: null, appointments: [], upcoming: [], people: [] });
  });
});

describe("POST /api/c/[slug]/queue/walkin with a card picked on the kiosk", () => {
  const OK = {
    ok: true,
    appointmentId: "cmapt000000000000000009",
    duplicate: false,
    ticketCode: "TK",
    ticketNumber: "A-005",
    queueOrder: 5,
    patient: { id: "p_son", fullName: "Каримов Тимур" },
    doctor: { id: "doc_1", nameRu: "Невролог", nameUz: "Nevrolog", color: null },
    cabinet: "3",
  };

  function walkin(body: Record<string, unknown>) {
    return new Request("https://x/api/c/neurofax/queue/walkin", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kiosk-token": "t".repeat(32) },
      body: JSON.stringify({ fullName: "Каримов Т.", phone: "+998901234567", doctorId: "doc_1", ...body }),
    });
  }

  it("a relative's ticket goes on his own card, with the chosen service", async () => {
    h.owners = [MOTHER];
    h.sharers = [SON];
    h.walkinResult = OK;
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    const res = await POST(walkin({ patientId: "p_son", phoneOwner: "same", serviceId: "svc_eeg" }));
    expect(res.status).toBe(201);
    expect(h.walkinCalls[0]).toMatchObject({
      patient: { id: "p_son", confirmPhoneClaim: false },
      serviceId: "svc_eeg",
    });
    const body = await res.json();
    // The kiosk prints with its own short-lived key (Q-09).
    expect(body.printToken).toMatch(/^k~cmapt000000000000000009\./);
  });

  it("«that is me» on a Mini App claim makes the number hers", async () => {
    h.claim = MOTHER;
    h.walkinResult = { ...OK, patient: { id: "p_mother", fullName: MOTHER.fullName } };
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    await POST(walkin({ patientId: "p_mother", phoneOwner: "same" }));
    expect(h.walkinCalls[0]).toMatchObject({ patient: { id: "p_mother", confirmPhoneClaim: true } });
  });

  it("a card the number does not stand for is refused, nothing queued", async () => {
    h.owners = [MOTHER];
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    const res = await POST(walkin({ patientId: "p_stranger" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("patient_not_on_phone");
    expect(h.walkinCalls).toHaveLength(0);
  });

  it("a service the doctor does not offer comes back as 409 service_not_offered (Q-06)", async () => {
    h.walkinResult = { ok: false, reason: "service_not_offered" };
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    const res = await POST(walkin({ serviceId: "svc_gone" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("service_not_offered");
  });
});

describe("the kiosk's flow on a shared number", () => {
  const person = (id: string, over: Partial<KioskPerson> = {}): KioskPerson => ({
    id,
    fullName: id,
    unverified: false,
    appointments: [],
    upcoming: [],
    ...over,
  });
  const today = { id: "a1", doctorName: "Невролог", cabinet: "3", service: null, time: "14:30", ticketNumber: null };
  const later = { id: "a2", doctorName: "Невролог", cabinet: "3", service: null, date: "2026-10-05", time: "10:00" };

  it("several cards: «Кто пришёл?»; one: «Это вы?»; none: a first visit", () => {
    expect(stepAfterLookup([person("a"), person("b")])).toBe("who");
    expect(stepAfterLookup([person("a")])).toBe("is-this-you");
    expect(stepAfterLookup([])).toBe("enter-name");
  });

  it("the picked person's own bookings decide the next screen", () => {
    expect(stepForPerson(person("a", { appointments: [today] }))).toBe("checkin");
    expect(stepForPerson(person("a", { upcoming: [later] }))).toBe("upcoming");
    expect(stepForPerson(person("a"))).toBe("select-doctor");
  });

  it("the row says when the person is booked", () => {
    expect(personBookingHint(person("a", { appointments: [today] }))).toEqual({ kind: "today", time: "14:30" });
    expect(personBookingHint(person("a", { upcoming: [later] }))).toEqual({
      kind: "later",
      date: "05.10.2026",
      time: "10:00",
    });
    expect(personBookingHint(person("a"))).toBeNull();
  });

  it("an answer from an older server (no `people`) still reads as one card", () => {
    expect(
      lookupPeople({ patient: { id: "p1", fullName: "Каримова Д." }, appointments: [today], upcoming: [] }),
    ).toEqual([person("p1", { fullName: "Каримова Д.", appointments: [today] })]);
    expect(lookupPeople({ patient: null })).toEqual([]);
  });

  it("the picked card goes as patientId; «это не я» as phoneOwner other", () => {
    const base = { fullName: "Каримов Т.", phone: "+998901234567", doctorId: "doc_1", lang: "uz" as const, service: null };
    expect(walkinRequestBody({ ...base, pickedPatientId: "p_son", notOwner: false })).toMatchObject({
      patientId: "p_son",
      phoneOwner: "same",
      lang: "UZ",
    });
    const other = walkinRequestBody({ ...base, pickedPatientId: null, notOwner: true });
    expect(other.phoneOwner).toBe("other");
    expect(other).not.toHaveProperty("patientId");
  });
});

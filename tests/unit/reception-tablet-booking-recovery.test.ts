/**
 * «Записать на время» after a lost answer (src/lib/reception-tablet/
 * booking-recovery.ts, book-visit.ts). The booking POST can commit while the
 * iPad never hears back; pressing «Записать» again used to meet the
 * patient's own new visit (409 doctor_busy), offer another slot and book him
 * twice. Now the try that got no answer is remembered and looked up first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  findLandedBooking,
  isUnsureStatus,
  landedBookingQuery,
  type ListedAppointment,
} from "@/lib/reception-tablet/booking-recovery";
import { bookVisit, type BookInput } from "@/lib/reception-tablet/book-visit";
import {
  BookingUnsureError,
  isNetworkError,
  TabletWriteError,
} from "@/lib/reception-tablet/errors";
import type { UnsureBooking } from "@/lib/reception-tablet/flow";

const UNSURE: UnsureBooking = { patientId: "p1", doctorId: "d1", day: "2026-10-05", time: "10:20" };

function row(patch: Partial<ListedAppointment> = {}): ListedAppointment {
  return {
    id: "a1",
    patientId: "p1",
    doctorId: "d1",
    // 10:20 in Tashkent (UTC+5).
    date: "2026-10-05T05:20:00.000Z",
    time: "10:20",
    status: "BOOKED",
    medicalCaseId: null,
    ...patch,
  };
}

describe("looking the visit up", () => {
  it("asks for that patient with that doctor over the whole Tashkent day", () => {
    const q = new URLSearchParams(landedBookingQuery(UNSURE));
    expect(q.get("patientId")).toBe("p1");
    expect(q.get("doctorId")).toBe("d1");
    expect(q.get("from")).toBe("2026-10-04T19:00:00.000Z");
    expect(q.get("to")).toBe("2026-10-05T18:59:59.999Z");
  });

  it("finds the visit at that day and time", () => {
    expect(findLandedBooking([row()], UNSURE)?.id).toBe("a1");
    // An older row without the wall-clock time is read from its start.
    expect(findLandedBooking([row({ time: null })], UNSURE)?.id).toBe("a1");
    // Already moved on in its day (arrived, seen): still the same visit.
    expect(findLandedBooking([row({ status: "WAITING" })], UNSURE)?.id).toBe("a1");
  });

  it("does not take another slot, another doctor, another day or a cancelled visit", () => {
    expect(findLandedBooking([row({ time: "10:40" })], UNSURE)).toBeNull();
    expect(findLandedBooking([row({ doctorId: "d2" })], UNSURE)).toBeNull();
    expect(findLandedBooking([row({ patientId: "p2" })], UNSURE)).toBeNull();
    expect(
      findLandedBooking([row({ date: "2026-10-06T05:20:00.000Z", time: "10:20" })], UNSURE),
    ).toBeNull();
    expect(findLandedBooking([row({ status: "CANCELLED" })], UNSURE)).toBeNull();
    expect(findLandedBooking([], UNSURE)).toBeNull();
  });

  it("only a gateway timeout leaves the booking unsure; the route's own answers are answers", () => {
    expect(isUnsureStatus(502)).toBe(true);
    expect(isUnsureStatus(504)).toBe(true);
    for (const s of [400, 401, 403, 409, 422, 500]) expect(isUnsureStatus(s)).toBe(false);
  });

  it("an unsure booking is not worded as a plain «нет связи»", () => {
    expect(isNetworkError(new BookingUnsureError(UNSURE))).toBe(false);
  });
});

describe("bookVisit", () => {
  type Call = { url: string; method: string; body: unknown; signal: unknown };
  let calls: Call[] = [];

  function stubFetch(handler: (url: string, method: string) => Response | Error) {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({
          url,
          method,
          body: init?.body ? JSON.parse(String(init.body)) : null,
          signal: init?.signal,
        });
        const out = handler(url, method);
        if (out instanceof Error) throw out;
        return out;
      }),
    );
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const input = (patch: Partial<BookInput> = {}): BookInput => ({
    patient: { kind: "existing", id: "p1", fullName: "Юсупова Лола", phone: null, birthYear: 1985 },
    unsure: null,
    createdPatientId: null,
    doctorId: "d1",
    serviceId: null,
    serviceMin: null,
    day: "2026-10-05",
    time: "10:20",
    ...patch,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("books, files the case, and every request carries a timeout", async () => {
    stubFetch(() => json({ id: "a1" }, 201));
    const fileIntoCase = vi.fn(async () => undefined);
    await expect(bookVisit(input(), { fileIntoCase })).resolves.toEqual({
      ...UNSURE,
      id: "a1",
      recovered: false,
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/crm/appointments"]);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(fileIntoCase).toHaveBeenCalledWith("a1", "p1", "d1");
  });

  it("no answer to the booking POST: unsure, with what to look for", async () => {
    stubFetch(() => new TypeError("Load failed"));
    const err = await bookVisit(input(), { fileIntoCase: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(BookingUnsureError);
    expect((err as BookingUnsureError).unsure).toEqual(UNSURE);
  });

  it("a gateway timeout or a lost body is unsure too; a refusal is a refusal", async () => {
    stubFetch(() => new Response("Gateway Time-out", { status: 504 }));
    await expect(bookVisit(input(), { fileIntoCase: vi.fn() })).rejects.toBeInstanceOf(
      BookingUnsureError,
    );
    stubFetch(() => new Response("{", { status: 201 }));
    await expect(bookVisit(input(), { fileIntoCase: vi.fn() })).rejects.toBeInstanceOf(
      BookingUnsureError,
    );
    stubFetch(() => json({ error: "conflict", reason: "doctor_busy" }, 409));
    const err = await bookVisit(input(), { fileIntoCase: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(TabletWriteError);
    expect((err as TabletWriteError).failure).toEqual({ kind: "slot", reason: "doctor_busy" });
  });

  it("the retry finds the saved visit and books nothing", async () => {
    stubFetch((url) => (url.startsWith("/api/crm/appointments?") ? json({ rows: [row()] }) : json({}, 500)));
    const fileIntoCase = vi.fn(async () => undefined);
    // She picked another slot meanwhile; the visit saved is the one shown.
    await expect(
      bookVisit(input({ unsure: UNSURE, time: "11:00" }), { fileIntoCase }),
    ).resolves.toEqual({ ...UNSURE, id: "a1", recovered: true });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    // Not filed yet: filed now, as the lost answer would have.
    expect(fileIntoCase).toHaveBeenCalledWith("a1", "p1", "d1");
  });

  it("a found visit already in a case is not filed again", async () => {
    stubFetch(() => json({ rows: [row({ medicalCaseId: "c1" })] }));
    const fileIntoCase = vi.fn(async () => undefined);
    await bookVisit(input({ unsure: UNSURE }), { fileIntoCase });
    expect(fileIntoCase).not.toHaveBeenCalled();
  });

  it("the retry books when the lost POST never landed", async () => {
    stubFetch((url, method) =>
      method === "GET" ? json({ rows: [row({ status: "CANCELLED" })] }) : json({ id: "a2" }, 201),
    );
    await expect(
      bookVisit(input({ unsure: UNSURE }), { fileIntoCase: vi.fn(async () => undefined) }),
    ).resolves.toMatchObject({ id: "a2", recovered: false });
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });

  it("while the lookup cannot be made, nothing is booked and the booking stays unsure", async () => {
    stubFetch((url, method) => (method === "GET" ? new TypeError("Load failed") : json({ id: "a2" }, 201)));
    await expect(bookVisit(input({ unsure: UNSURE }), { fileIntoCase: vi.fn() })).rejects.toBeInstanceOf(
      BookingUnsureError,
    );
    stubFetch((url, method) => (method === "GET" ? json({ error: "x" }, 500) : json({ id: "a2" }, 201)));
    await expect(bookVisit(input({ unsure: UNSURE }), { fileIntoCase: vi.fn() })).rejects.toBeInstanceOf(
      BookingUnsureError,
    );
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("a lookup refused outright (4xx) does not lock the booking forever", async () => {
    stubFetch((url, method) => (method === "GET" ? json({ error: "Forbidden" }, 403) : json({ id: "a2" }, 201)));
    await expect(
      bookVisit(input({ unsure: UNSURE }), { fileIntoCase: vi.fn(async () => undefined) }),
    ).resolves.toMatchObject({ id: "a2", recovered: false });
  });

  it("a new patient's card is reported before the booking, so a retry books into it", async () => {
    stubFetch((url) => (url === "/api/crm/patients" ? json({ id: "p_new" }, 201) : new TypeError("Load failed")));
    const onPatientCreated = vi.fn();
    const err = await bookVisit(
      input({
        patient: {
          kind: "new",
          fullName: "Каримов Тимур 2012",
          phone: "+998901234567",
          birthYear: 2012,
          gender: null,
        },
        onPatientCreated,
      }),
      { fileIntoCase: vi.fn() },
    ).catch((e) => e);
    expect(onPatientCreated).toHaveBeenCalledWith("p_new");
    expect((err as BookingUnsureError).unsure).toEqual({ ...UNSURE, patientId: "p_new" });
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });
});

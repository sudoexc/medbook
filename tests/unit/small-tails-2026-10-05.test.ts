/**
 * Small tails of 05.10.2026:
 *   1. the conclusion preview closes on Esc with the focus inside its frame;
 *   2. the arsenal: an unstar that would lose a schema asks first, a drag
 *      saves for a doctor with more pins than the page reads;
 *   3. the reception iPad: a foreign number for a new patient, its own
 *      toasts, every doctor of the next 15 days for «Записать на время»;
 *   4. the task board: HEIC from an iPhone, failed uploads kept.
 * (The arsenal API side is in doctor-arsenal-api.test.ts.)
 */
import { describe, expect, it } from "vitest";

import { listenForEscape } from "@/lib/frame-escape";
import { reorderedPositions, reorderedWindow } from "@/lib/arsenal";
import {
  unstarDropsSchema,
  type DoctorFavoriteRow,
} from "@/app/[locale]/doctor/reception/_hooks/use-doctor-favorites";
import {
  formatIntl,
  intlDigitsFrom,
  intlToE164,
  pressIntlKey,
} from "@/lib/reception-tablet/phone";
import {
  EMPTY_NEW_PATIENT,
  newPatientPhone,
  validateNewPatient,
} from "@/lib/reception-tablet/new-patient";
import { isReceptionTabletPath } from "@/lib/reception-tablet/access";
import {
  openingBookingDay,
  orderTabletDoctors,
  summarizeDoctorDay,
  type DoctorDaySummary,
  type TabletDoctorLike,
} from "@/lib/reception-tablet/doctor-day";
import { flowReducer, type ActiveFlow, type FlowState } from "@/lib/reception-tablet/flow";
import { computeDoctorsToday, firstWorkDay } from "@/server/doctors/today";
import { isHeicFile, jpegFileName, uploadInTurn } from "@/lib/dev-tasks";
import { isValidCardPhone, normalizePhone } from "@/lib/phone";

// ── 1. Esc inside the preview frame ─────────────────────────────────────

function keydown(key: string): Event {
  const e = new Event("keydown", { cancelable: true });
  Object.defineProperty(e, "key", { value: key });
  return e;
}

describe("Esc inside a same-origin frame", () => {
  it("closes on Escape only, and stops once detached", () => {
    const frame = new EventTarget();
    let closed = 0;
    const stop = listenForEscape(frame, () => {
      closed += 1;
    });
    frame.dispatchEvent(keydown("Enter"));
    expect(closed).toBe(0);
    const esc = keydown("Escape");
    frame.dispatchEvent(esc);
    expect(closed).toBe(1);
    // The frame's own Esc handling (if any) sees it handled.
    expect(esc.defaultPrevented).toBe(true);
    stop();
    frame.dispatchEvent(keydown("Escape"));
    expect(closed).toBe(1);
  });

  it("an Esc the page inside already handled is left alone", () => {
    const frame = new EventTarget();
    let closed = 0;
    frame.addEventListener("keydown", (e) => e.preventDefault());
    listenForEscape(frame, () => {
      closed += 1;
    });
    frame.dispatchEvent(keydown("Escape"));
    expect(closed).toBe(0);
  });

  it("no window, or one the browser will not let us touch, is a no-op", () => {
    expect(() => listenForEscape(null, () => {})()).not.toThrow();
    const hostile = {
      addEventListener: () => {
        throw new Error("SecurityError");
      },
      removeEventListener: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => listenForEscape(hostile, () => {})()).not.toThrow();
  });
});

// ── 2. The arsenal ──────────────────────────────────────────────────────

function fav(entityCode: string, schema: unknown): DoctorFavoriteRow {
  return {
    id: `f-${entityCode}`,
    userId: "u1",
    entityType: "DRUG",
    entityCode,
    sortOrder: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    schema,
  };
}

describe("an unstar that would lose an arsenal schema", () => {
  const list = [
    fav("mexidol", { dose: "1 таб.", timesOfDay: ["MORNING"], mealRelation: "AFTER_MEAL", durationDays: 10 }),
    fav("pregabalin", null),
    // «Не важно» alone is the row default, not a schema he set.
    fav("betahistine", { mealRelation: "NO_MATTER" }),
  ];

  it("asks only when the pin carries a real schema", () => {
    expect(unstarDropsSchema(list, "mexidol")).toBe(true);
    expect(unstarDropsSchema(list, "pregabalin")).toBe(false);
    expect(unstarDropsSchema(list, "betahistine")).toBe(false);
  });

  it("a pin (the drug is not starred yet) never asks", () => {
    expect(unstarDropsSchema(list, "nimesulide")).toBe(false);
    expect(unstarDropsSchema([], "mexidol")).toBe(false);
  });
});

describe("a drag over the first pins only", () => {
  it("renumbers the window in his order and keeps the rest after it", () => {
    const current = ["a", "b", "c", "d", "e"];
    expect(reorderedWindow(current, ["c", "a", "b"], 3)).toEqual({
      ok: true,
      positions: [
        { entityCode: "c", sortOrder: 0 },
        { entityCode: "a", sortOrder: 1 },
        { entityCode: "b", sortOrder: 2 },
        { entityCode: "d", sortOrder: 3 },
        { entityCode: "e", sortOrder: 4 },
      ],
    });
  });

  it("the window must match exactly: a pin from past it, a missing one, a twin", () => {
    const current = ["a", "b", "c", "d"];
    expect(reorderedWindow(current, ["a", "d"], 2).ok).toBe(false);
    expect(reorderedWindow(current, ["a"], 2).ok).toBe(false);
    expect(reorderedWindow(current, ["a", "a"], 2).ok).toBe(false);
  });

  it("a list shorter than the window is the whole permutation, as before", () => {
    expect(reorderedWindow(["a", "b"], ["b", "a"], 50)).toEqual(
      reorderedPositions(["a", "b"], ["b", "a"]),
    );
  });
});

// ── 3. The reception iPad ───────────────────────────────────────────────

describe("«Другая страна»: a foreign number on the tablet", () => {
  it("takes digits only, up to fifteen, on the keypad and from a paste", () => {
    expect(intlDigitsFrom("+7 (916) 123-45-67")).toBe("79161234567");
    expect(intlDigitsFrom("1234567890123456789")).toHaveLength(15);
    let v = "";
    for (const k of ["7", "9", "1"] as const) v = pressIntlKey(v, k);
    expect(v).toBe("791");
    expect(pressIntlKey(v, "back")).toBe("79");
    expect(pressIntlKey(v, "clear")).toBe("");
    expect(pressIntlKey("123456789012345", "6")).toBe("123456789012345");
    expect(formatIntl("")).toBe("+");
    expect(formatIntl("79161234567")).toBe("+79161234567");
  });

  it("a whole number by the card rule of the desktop, stored as the server normalizes it", () => {
    for (const digits of ["79161234567", "905321234567", "14155550123", "4915112345678"]) {
      const e164 = intlToE164(digits);
      expect(e164).toBe(`+${digits}`);
      expect(isValidCardPhone(e164)).toBe(true);
      expect(normalizePhone(e164)).toBe(e164);
    }
    // A whole Uzbek number typed here is that Uzbek number.
    expect(intlToE164("998901234567")).toBe("+998901234567");
  });

  it("refuses a number cut short, a +998 stub, and nine digits the server would read as Uzbek", () => {
    expect(intlToE164("")).toBeNull();
    expect(intlToE164("7916123")).toBeNull();
    expect(intlToE164("99890123456")).toBeNull();
    expect(intlToE164("9989012345678")).toBeNull();
    expect(intlToE164("901234567")).toBeNull();
  });

  it("the form validates the number the toggle shows, and keeps the other as typed", () => {
    const NOW = new Date("2026-10-05T09:00:00+05:00");
    const foreign = {
      ...EMPTY_NEW_PATIENT,
      fullName: "Иванов Пётр",
      phoneLocal: "90123",
      phoneCountry: "intl" as const,
      phoneIntl: "79161234567",
    };
    const ok = validateNewPatient(foreign, NOW);
    expect(ok).toMatchObject({ ok: true, value: { phone: "+79161234567" } });
    expect(newPatientPhone(foreign)).toBe("+79161234567");

    const short = validateNewPatient({ ...foreign, phoneIntl: "7916" }, NOW);
    expect(short).toMatchObject({ ok: false, errors: { phone: "intlInvalid" } });
    const empty = validateNewPatient({ ...foreign, phoneIntl: "" }, NOW);
    expect(empty).toMatchObject({ ok: false, errors: { phone: "required" } });

    // Back to +998: the Uzbek digits are judged again, as before.
    const uz = validateNewPatient({ ...foreign, phoneCountry: "uz" }, NOW);
    expect(uz).toMatchObject({ ok: false, errors: { phone: "incomplete" } });
    const uzOk = validateNewPatient({ ...foreign, phoneCountry: "uz", phoneLocal: "901234567" }, NOW);
    expect(uzOk).toMatchObject({ ok: true, value: { phone: "+998901234567" } });
    // A draft from before the toggle existed is an Uzbek one.
    const legacy = { fullName: "Цой Вадим", phoneLocal: "331234567", birthYear: "", gender: null };
    expect(validateNewPatient(legacy, NOW)).toMatchObject({ ok: true, value: { phone: "+998331234567" } });
  });
});

describe("the tablet page, for the shell's toasts", () => {
  it("is matched with or without the locale, a slash or a query", () => {
    expect(isReceptionTabletPath("/crm/reception/tablet")).toBe(true);
    expect(isReceptionTabletPath("/uz/crm/reception/tablet")).toBe(true);
    expect(isReceptionTabletPath("/ru/crm/reception/tablet/")).toBe(true);
    expect(isReceptionTabletPath("/crm/reception/tablet?x=1")).toBe(true);
  });

  it("and nothing else", () => {
    expect(isReceptionTabletPath("/crm/reception")).toBe(false);
    expect(isReceptionTabletPath("/crm/reception/tablets")).toBe(false);
    expect(isReceptionTabletPath("/en/crm/reception/tablet")).toBe(false);
    expect(isReceptionTabletPath(null)).toBe(false);
  });
});

const TODAY = "2026-10-05";
const NOW = new Date("2026-10-05T11:00:00+05:00");

function doctor(id: string, cabinet: string | null): TabletDoctorLike {
  return { id, nameRu: `Врач ${id}`, nameUz: `Shifokor ${id}`, ticketPrefix: null, cabinet: cabinet ? { number: cabinet } : null };
}

function summary(
  id: string,
  today: { workingMinutes?: number; nextFree?: string | null; nextWorkDay?: string | null } | undefined,
): DoctorDaySummary {
  return summarizeDoctorDay({
    doctorId: id,
    rows: [],
    today: today
      ? {
          doctorId: id,
          workingMinutes: today.workingMinutes ?? 0,
          status: "off",
          nextFree: today.nextFree ?? null,
          nextWorkDay: today.nextWorkDay,
        }
      : undefined,
    now: NOW,
  });
}

describe("«Записать на время»: every doctor of the next 15 days", () => {
  const doctors = [doctor("today", "101"), doctor("thursday", "102"), doctor("never", "103"), doctor("old", "100")];
  const summaries = new Map([
    ["today", summary("today", { workingMinutes: 480, nextFree: "14:20", nextWorkDay: TODAY })],
    ["thursday", summary("thursday", { nextWorkDay: "2026-10-08" })],
    ["never", summary("never", { nextWorkDay: null })],
    // An older server without the field: booking stays as it was.
    ["old", summary("old", {})],
  ]);

  it("a doctor off today but in later is bookable; nobody else is", () => {
    expect(summaries.get("thursday")).toMatchObject({ onDuty: false, bookable: true, nextWorkDay: "2026-10-08" });
    expect(summaries.get("never")).toMatchObject({ onDuty: false, bookable: false });
    expect(summaries.get("old")).toMatchObject({ onDuty: false, bookable: false, nextWorkDay: null });
  });

  it("booking lists today's doctors, then those in later; the queue keeps today's only", () => {
    expect(orderTabletDoctors(doctors, summaries, { showAll: false, forBooking: true }).map((d) => d.id)).toEqual([
      "today",
      "thursday",
    ]);
    expect(orderTabletDoctors(doctors, summaries, { showAll: false }).map((d) => d.id)).toEqual(["today"]);
    // «Показать всех»: the rest after, by cabinet, nobody twice.
    expect(orderTabletDoctors(doctors, summaries, { showAll: true, forBooking: true }).map((d) => d.id)).toEqual([
      "today",
      "thursday",
      "old",
      "never",
    ]);
  });

  it("the time step opens on his first working day when the picked one is earlier", () => {
    expect(openingBookingDay(TODAY, "2026-10-08")).toBe("2026-10-08");
    expect(openingBookingDay("2026-10-10", "2026-10-08")).toBe("2026-10-10");
    expect(openingBookingDay(TODAY, null)).toBe(TODAY);
    expect(openingBookingDay(null, "2026-10-08")).toBe("2026-10-08");
  });

  it("the flow takes that day on start and on a doctor pick, booking only", () => {
    const active = (s: FlowState) => s as ActiveFlow;
    let s = flowReducer({ screen: "home" }, { type: "start", mode: "book", today: TODAY, doctorId: "thursday", day: "2026-10-08" });
    expect(active(s).day).toBe("2026-10-08");
    s = flowReducer({ screen: "home" }, { type: "start", mode: "book", today: TODAY });
    s = flowReducer(s, { type: "pickPatient", patient: { kind: "existing", id: "p1", fullName: "Пациент", phone: null, birthYear: null } });
    s = flowReducer(s, { type: "pickDoctor", doctorId: "thursday", day: "2026-10-08" });
    expect(active(s)).toMatchObject({ doctorId: "thursday", day: "2026-10-08", step: "time" });
    // The queue has no day.
    let q = flowReducer({ screen: "home" }, { type: "start", mode: "queue", today: TODAY, day: "2026-10-08" });
    q = flowReducer(q, { type: "pickDoctor", doctorId: "thursday", day: "2026-10-08" });
    expect(active(q).day).toBeNull();
  });
});

describe("the first working day of the booking window, on the server", () => {
  // Monday 05.10.2026; Thursday only, 09:00 to 13:00.
  const THURSDAY = [{ weekday: 4, startTime: "09:00", endTime: "13:00" }];
  const days = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 5 + i));
    return d.toISOString().slice(0, 10);
  });

  it("the schedule decides, time off is cut out, no schedule means the open day", () => {
    expect(firstWorkDay(THURSDAY, days)).toBe("2026-10-08");
    const leave = [{ startAt: "2026-10-08T00:00:00+05:00", endAt: "2026-10-09T00:00:00+05:00" }];
    expect(firstWorkDay(THURSDAY, days, leave)).toBe("2026-10-15");
    expect(firstWorkDay([], days)).toBe("2026-10-05");
    const away = [{ startAt: "2026-10-01T00:00:00+05:00", endAt: "2026-11-01T00:00:00+05:00" }];
    expect(firstWorkDay(THURSDAY, days, away)).toBeNull();
  });

  it("a shift already over today does not count: the next day he works does", () => {
    const thursdays = days.slice(3);
    // Thursday 08.10 at 15:00, the 09:00 to 13:00 shift is over.
    expect(firstWorkDay(THURSDAY, thursdays, [], new Date("2026-10-08T15:00:00+05:00"))).toBe("2026-10-15");
    expect(firstWorkDay(THURSDAY, thursdays, [], new Date("2026-10-08T12:00:00+05:00"))).toBe("2026-10-08");
    // No schedule: the open day ends at 19:00.
    expect(firstWorkDay([], days, [], new Date("2026-10-05T20:00:00+05:00"))).toBe("2026-10-06");
  });

  it("travels on the doctors' «today» rows", () => {
    const out = computeDoctorsToday({
      now: NOW,
      doctorIds: ["d1", "d2"],
      schedules: THURSDAY.map((r) => ({ ...r, doctorId: "d1" })),
      timeOffs: [],
      visits: [],
      nextFree: new Map(),
    });
    expect(out.doctors.map((d) => [d.doctorId, d.nextWorkDay, d.workingMinutes])).toEqual([
      ["d1", "2026-10-08", 0],
      ["d2", "2026-10-05", 0],
    ]);
  });
});

// ── 4. The task board ───────────────────────────────────────────────────

describe("HEIC from an iPhone", () => {
  it("is told by its type, or by its name when the picker gave none", () => {
    expect(isHeicFile({ type: "image/heic", name: "a.bin" })).toBe(true);
    expect(isHeicFile({ type: "image/HEIF" })).toBe(true);
    expect(isHeicFile({ type: "", name: "IMG_0042.HEIC" })).toBe(true);
    expect(isHeicFile({ type: "image/jpeg", name: "IMG_0042.HEIC" })).toBe(false);
    expect(isHeicFile({ type: "image/png", name: "shot.png" })).toBe(false);
  });

  it("goes up named as the JPEG it became", () => {
    expect(jpegFileName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(jpegFileName("photo.from.phone.heif")).toBe("photo.from.phone.jpg");
    expect(jpegFileName("")).toBe("screenshot.jpg");
    expect(jpegFileName(null)).toBe("screenshot.jpg");
  });
});

describe("uploads that fail are kept, not lost", () => {
  it("one after another, the failed ones returned in order, progress counted", async () => {
    const order: string[] = [];
    const progress: number[] = [];
    const result = await uploadInTurn(
      ["a", "b", "c", "d"],
      async (x) => {
        order.push(x);
        if (x === "b" || x === "d") throw new Error("network");
      },
      (done) => progress.push(done),
    );
    expect(order).toEqual(["a", "b", "c", "d"]);
    expect(result).toEqual({ uploaded: ["a", "c"], failed: ["b", "d"] });
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  it("a retry of the failed ones only sends those", async () => {
    const sent: string[] = [];
    let attempt = 0;
    const first = await uploadInTurn(["a", "b"], async (x) => {
      sent.push(x);
      if (x === "b" && attempt++ === 0) throw new Error("network");
    });
    const retry = await uploadInTurn(first.failed, async (x) => {
      sent.push(x);
    });
    expect(retry).toEqual({ uploaded: ["b"], failed: [] });
    expect(sent).toEqual(["a", "b", "b"]);
  });
});

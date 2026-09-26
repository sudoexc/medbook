/**
 * The doctor's daily surfaces against the clinic's real data shape.
 *
 * DC-05 — phone and kiosk bookings are created CONFIRMED (85 of them in the
 * first two weeks), but every doctor endpoint spelled its own status list
 * and each one dropped CONFIRMED: the patient booked by phone for 15:00 was
 * missing from «Сегодняшние», read «Следующий приём: —» and «Давно не был»,
 * had «Ближайшая запись: нет записей» on the card, and the «Мой день» badge
 * counted fewer patients than the day had. One shared list now
 * (`lib/appointments/active-statuses`).
 *
 * DC-08 — `Patient.notes` is encrypted at rest. «Мой день» put the raw
 * `v1:…` ciphertext under «Заметка о пациенте» for a walk-in without a
 * visit comment, where the doctor expected «аллергия на анальгин».
 * `Prescription.notes` (same encryption) came back raw from the doctor's
 * prescriptions list too.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_VISIT_STATUSES,
  TODAY_VISIT_STATUSES,
  UPCOMING_VISIT_STATUSES,
  isActiveVisitStatus,
  isUpcomingVisitStatus,
} from "@/lib/appointments/active-statuses";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; select?: Row };

const db = vi.hoisted(() => ({
  appointmentFindMany: vi.fn(async (_args: FindArgs): Promise<Row[]> => []),
  appointmentFindFirst: vi.fn(async (_args: FindArgs): Promise<Row | null> => null),
  patientFindMany: vi.fn(async (_args: FindArgs): Promise<Row[]> => []),
  patientFindFirst: vi.fn(async (_args: FindArgs): Promise<Row | null> => null),
  prescriptionFindMany: vi.fn(async (_args: FindArgs): Promise<Row[]> => []),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/server/appointments/queue-projection", () => ({
  getQueueProjection: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1", userId: "u_doc_1" })),
    },
    appointment: {
      findMany: db.appointmentFindMany,
      findFirst: db.appointmentFindFirst,
      groupBy: vi.fn(async () => []),
    },
    patient: {
      findMany: db.patientFindMany,
      findFirst: db.patientFindFirst,
      count: vi.fn(async () => 1),
    },
    patientAllergy: { findMany: vi.fn(async () => []) },
    patientChronicCondition: { findMany: vi.fn(async () => []) },
    document: { findFirst: vi.fn(async () => null) },
    conversation: {
      aggregate: vi.fn(async () => ({ _sum: { unreadCount: 0 } })),
    },
    doctorSchedule: { findMany: vi.fn(async () => []) },
    prescription: { findMany: db.prescriptionFindMany },
  },
}));

function get(url: string): Request {
  return new Request(`https://x${url}`, { method: "GET" });
}

/** Every `status: { in: [...] }` list the route passed to appointment.findMany. */
function statusListsQueried(): string[][] {
  return db.appointmentFindMany.mock.calls
    .map(([args]) => (args.where?.status as { in?: string[] } | undefined)?.in)
    .filter((v): v is string[] => Array.isArray(v));
}

beforeEach(() => {
  vi.resetModules();
  db.appointmentFindMany.mockReset().mockResolvedValue([]);
  db.appointmentFindFirst.mockReset().mockResolvedValue(null);
  db.patientFindMany.mockReset().mockResolvedValue([]);
  db.patientFindFirst.mockReset().mockResolvedValue(null);
  db.prescriptionFindMany.mockReset().mockResolvedValue([]);
});

describe("DC-05: one status list for «still ahead / under way»", () => {
  it("CONFIRMED is an upcoming status, next to BOOKED and WAITING", () => {
    expect(UPCOMING_VISIT_STATUSES).toEqual(["BOOKED", "CONFIRMED", "WAITING"]);
    expect(ACTIVE_VISIT_STATUSES).toEqual([
      "BOOKED",
      "CONFIRMED",
      "WAITING",
      "IN_PROGRESS",
    ]);
    expect(TODAY_VISIT_STATUSES).toContain("CONFIRMED");
    expect(TODAY_VISIT_STATUSES).toContain("COMPLETED");
    expect(isUpcomingVisitStatus("CONFIRMED")).toBe(true);
    expect(isActiveVisitStatus("CONFIRMED")).toBe(true);
  });

  it("finished and dropped visits are not active", () => {
    for (const s of ["COMPLETED", "CANCELLED", "NO_SHOW", "SKIPPED"]) {
      expect(isActiveVisitStatus(s)).toBe(false);
    }
    expect(TODAY_VISIT_STATUSES).not.toContain("CANCELLED");
    expect(TODAY_VISIT_STATUSES).not.toContain("NO_SHOW");
  });

  it("«Мой день» badge counts a CONFIRMED phone booking", async () => {
    db.appointmentFindMany.mockResolvedValue([
      { status: "CONFIRMED" },
      { status: "BOOKED" },
      { status: "WAITING" },
      { status: "IN_PROGRESS" },
      { status: "COMPLETED" },
      { status: "NO_SHOW" },
    ]);
    const { GET } = await import(
      "@/app/api/crm/doctors/me/sidebar-stats/route"
    );
    const res = await GET(get("/api/crm/doctors/me/sidebar-stats"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { todayBadge: number; todayCount: number };
    expect(body.todayBadge).toBe(4);
    expect(body.todayCount).toBe(6);
  });

  it("«Сегодняшние» includes a patient whose only visit today is CONFIRMED", async () => {
    db.appointmentFindMany.mockImplementation(async (args: FindArgs) => {
      const inList = (args.where?.status as { in?: string[] } | undefined)?.in;
      // The "today" id pass: a CONFIRMED booking must be selected.
      if (args.select && "patientId" in args.select && !("date" in args.select)) {
        return inList?.includes("CONFIRMED") ? [{ patientId: "p_phone" }] : [];
      }
      return [];
    });
    db.patientFindMany.mockResolvedValue([
      {
        id: "p_phone",
        fullName: "Турматов О",
        photoUrl: null,
        birthDate: null,
        phone: "+998901112233",
        segment: "ACTIVE",
        lastVisitAt: null,
      },
    ]);
    const { GET } = await import("@/app/api/crm/doctors/me/patients/route");
    const res = await GET(get("/api/crm/doctors/me/patients?tab=today"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ id: string }> };
    expect(body.rows.map((r) => r.id)).toEqual(["p_phone"]);
  });

  it("«Следующий приём» shows the CONFIRMED booking", async () => {
    const at = new Date(Date.now() + 3 * 60 * 60_000);
    db.patientFindMany.mockResolvedValue([
      {
        id: "p_phone",
        fullName: "Турматов О",
        photoUrl: null,
        birthDate: null,
        phone: "+998901112233",
        segment: "ACTIVE",
        lastVisitAt: null,
      },
    ]);
    db.appointmentFindMany.mockImplementation(async (args: FindArgs) => {
      const inList = (args.where?.status as { in?: string[] } | undefined)?.in;
      if (inList && args.where?.date) {
        return inList.includes("CONFIRMED")
          ? [{ patientId: "p_phone", date: at }]
          : [];
      }
      return [];
    });
    const { GET } = await import("@/app/api/crm/doctors/me/patients/route");
    const res = await GET(get("/api/crm/doctors/me/patients"));
    const body = (await res.json()) as {
      rows: Array<{ nextAppointmentWithMeAt: string | null }>;
    };
    expect(body.rows[0].nextAppointmentWithMeAt).toBe(at.toISOString());
    expect(statusListsQueried()).toContainEqual([...UPCOMING_VISIT_STATUSES]);
  });

  it("the patient card's upcomingAppointment finds a CONFIRMED booking", async () => {
    const at = new Date(Date.now() + 60 * 60_000);
    db.patientFindFirst.mockResolvedValue({
      id: "p_phone",
      fullName: "Турматов О",
      phone: "+998901112233",
      phoneNormalized: "998901112233",
      birthDate: null,
      segment: "ACTIVE",
    });
    db.appointmentFindFirst.mockImplementation(async (args: FindArgs) => {
      const inList = (args.where?.status as { in?: string[] } | undefined)?.in;
      if (!inList) return { id: "apt_any" }; // the anti-leak relation check
      return inList.includes("CONFIRMED")
        ? { id: "apt_phone", date: at, status: "CONFIRMED", doctor: null }
        : null;
    });
    const { GET } = await import(
      "@/app/api/crm/doctors/me/patients/[patientId]/summary/route"
    );
    const res = await GET(
      get("/api/crm/doctors/me/patients/p_phone/summary"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      upcomingAppointment: { id: string; status: string } | null;
    };
    expect(body.upcomingAppointment).toMatchObject({
      id: "apt_phone",
      status: "CONFIRMED",
    });
  });
});

describe("DC-08: encrypted notes reach the doctor as text", () => {
  // The routes are imported after `vi.resetModules()`, so the cipher module
  // is taken from the same fresh registry: a key set on a stale instance
  // would not be the one the route decrypts with.
  let cipher: typeof import("@/server/crypto/field-cipher");
  const encryptField = (v: string) => cipher.encryptField(v);
  beforeEach(async () => {
    cipher = await import("@/server/crypto/field-cipher");
    cipher.__setKeyForTests({ active: "v1", keys: { v1: randomBytes(32) } });
  });
  afterEach(() => {
    cipher.__resetKeyCacheForTests();
  });

  function walkIn(notes: string | null, comments: string | null = null): Row {
    return {
      id: "apt_1",
      date: new Date(),
      durationMin: 20,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      calledAt: new Date(),
      completedAt: null,
      comments,
      ticketSeq: 3,
      queueOrder: 3,
      channel: "WALKIN",
      queuedAt: new Date(),
      patient: {
        id: "p1",
        fullName: "Рахимов Сардор",
        phone: "+998901112233",
        birthDate: null,
        photoUrl: null,
        visitsCount: 3,
        tags: [],
        segment: "ACTIVE",
        lastVisitAt: null,
        notes,
      },
    };
  }

  async function today(): Promise<{
    current: { complaints: string; complaintsSource: string | null } | null;
  }> {
    const { GET } = await import("@/app/api/crm/doctors/me/today/route");
    const res = await GET(get("/api/crm/doctors/me/today"));
    expect(res.status).toBe(200);
    return res.json();
  }

  it("an encrypted card note with no visit comment shows decrypted", async () => {
    const cipher = encryptField("аллергия на анальгин");
    expect(cipher?.startsWith("v1:")).toBe(true);
    db.appointmentFindMany.mockResolvedValue([walkIn(cipher)]);

    const body = await today();

    expect(body.current?.complaints).toBe("аллергия на анальгин");
    expect(body.current?.complaintsSource).toBe("card");
  });

  it("the visit's own comment still wins over the card note", async () => {
    db.appointmentFindMany.mockResolvedValue([
      walkIn(encryptField("аллергия на анальгин"), "Головная боль третий день"),
    ]);
    const body = await today();
    expect(body.current?.complaints).toBe("Головная боль третий день");
    expect(body.current?.complaintsSource).toBe("visit");
  });

  it("a legacy plaintext note passes through", async () => {
    db.appointmentFindMany.mockResolvedValue([walkIn("Носит кардиостимулятор")]);
    const body = await today();
    expect(body.current?.complaints).toBe("Носит кардиостимулятор");
  });

  it("an undecryptable note is dropped, never shown as ciphertext, and the screen still loads", async () => {
    const foreign = encryptField("чужой ключ");
    // Rotate to a key that cannot open it.
    cipher.__setKeyForTests({ active: "v1", keys: { v1: randomBytes(32) } });
    db.appointmentFindMany.mockResolvedValue([walkIn(foreign)]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const body = await today();

    expect(body.current?.complaints).toBe("");
    expect(body.current?.complaintsSource).toBeNull();
    warn.mockRestore();
  });

  it("the doctor's prescriptions list decrypts Prescription.notes", async () => {
    db.patientFindFirst.mockResolvedValue({ id: "p1" });
    db.appointmentFindFirst.mockResolvedValue({ id: "apt_1" });
    db.prescriptionFindMany.mockResolvedValue([
      {
        id: "rx_1",
        drugName: "Конкор",
        dosage: "5 мг",
        schedule: null,
        notes: encryptField("утром натощак"),
        status: "ACTIVE",
        remindersEnabled: true,
        caseId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const { GET } = await import(
      "@/app/api/crm/doctors/me/patients/[patientId]/prescriptions/route"
    );
    const res = await GET(
      get("/api/crm/doctors/me/patients/p1/prescriptions"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ notes: string | null }> };
    expect(body.rows[0].notes).toBe("утром натощак");
  });
});

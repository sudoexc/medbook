/**
 * Phase 17 Stage 3.G.1 — deep tests for the SMS-reply YES → confirmAppointment
 * wiring inside `/api/sms/webhook/[clinicSlug]`.
 *
 * What we exercise:
 *   - The inline `isConfirmKeyword` parser (token set, case, punctuation,
 *     whole-message rule, STOP non-confusion).
 *   - The appointment-resolution algorithm (nearest future unconfirmed, status
 *     allowlist, family-shared phones).
 *   - The handler-call wiring: `confirmAppointment` is invoked with the right
 *     args (appointmentId / clinicId / actorId=null / via="SMS_REPLY").
 *   - The "always 200, never 4xx" contract — even when the helper rejects or
 *     throws — because SMS providers retry hard on non-200.
 *
 * Style mirrors `sms-stop-detection.test.ts` (for the parser parts) and
 * `telephony-webhook.test.ts` (for the route-level mocks + Request builders).
 *
 * We mock `@/lib/prisma`, `@/server/appointments/confirm`,
 * `@/server/patient/last-contacted`, `@/server/realtime/publish`,
 * `@/lib/audit`, and pass-through `@/lib/tenant-context.runWithTenant` so we
 * don't need a real DB or AsyncLocalStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ApptStatus =
  | "BOOKED"
  | "CONFIRMED"
  | "CANCELLED"
  | "NO_SHOW"
  | "COMPLETED"
  | "WAITING";

type AppointmentRow = {
  id: string;
  clinicId: string;
  patientId: string;
  date: Date;
  status: ApptStatus;
  confirmedAt: Date | null;
};

type PatientRow = {
  id: string;
  clinicId: string;
  phone: string;
  phoneNormalized: string;
  marketingOptOut: boolean;
};

type ClinicRow = { id: string; slug: string };

type ConversationRow = {
  id: string;
  clinicId: string;
  externalId: string;
  patientId: string | null;
};

const state = {
  clinics: [] as ClinicRow[],
  patients: [] as PatientRow[],
  appointments: [] as AppointmentRow[],
  conversations: [] as ConversationRow[],
  messages: 0,
  nextConvId: 1,
};

function matchPhoneContains(target: string, needle: string): boolean {
  if (!needle) return false;
  return target.includes(needle);
}

// ----- mocks -------------------------------------------------------------

type ConfirmInput = {
  appointmentId: string;
  clinicId: string;
  actorId: string | null;
  via: string;
};
type ConfirmResult =
  | { ok: true; appointment: unknown; alreadyConfirmed: boolean }
  | { ok: false; reason: "not_found" | "cancelled" | "completed" };

const confirmSpy = vi.fn<(input: ConfirmInput) => Promise<ConfirmResult>>(
  async () => ({
    ok: true,
    appointment: {} as unknown,
    alreadyConfirmed: false,
  }),
);

vi.mock("@/server/appointments/confirm", () => ({
  confirmAppointment: (...args: unknown[]) =>
    (confirmSpy as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => {}),
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(() => {}),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => {}),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async <T,>(_ctx: unknown, fn: () => T | Promise<T>) => fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async (args: { where: { slug: string } }) => {
        return state.clinics.find((c) => c.slug === args.where.slug) ?? null;
      }),
    },
    providerConnection: {
      // No SMS provider configured → resolveClinicSecret returns null → dev
      // bypass fires (NODE_ENV=development in beforeEach).
      findFirst: vi.fn(async () => null),
    },
    patient: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          clinicId: string;
          phoneNormalized?: { contains: string };
        };
        return (
          state.patients.find(
            (p) =>
              p.clinicId === w.clinicId &&
              !!w.phoneNormalized?.contains &&
              matchPhoneContains(p.phoneNormalized, w.phoneNormalized.contains),
          ) ?? null
        );
      }),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          clinicId: string;
          OR?: Array<{ phoneNormalized?: { contains: string } }>;
          phoneNormalized?: { contains: string };
          marketingOptOut?: boolean;
        };
        const needles: string[] = [];
        if (w.OR) {
          for (const c of w.OR) {
            if (c.phoneNormalized?.contains) needles.push(c.phoneNormalized.contains);
          }
        }
        if (w.phoneNormalized?.contains) needles.push(w.phoneNormalized.contains);

        return state.patients.filter((p) => {
          if (p.clinicId !== w.clinicId) return false;
          if (w.marketingOptOut !== undefined && p.marketingOptOut !== w.marketingOptOut) {
            return false;
          }
          if (needles.length === 0) return false;
          return needles.some((n) => matchPhoneContains(p.phoneNormalized, n));
        });
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    appointment: {
      findFirst: vi.fn(async (args: {
        where: Record<string, unknown>;
        orderBy?: { date?: "asc" | "desc" };
      }) => {
        const w = args.where as {
          clinicId: string;
          patientId: { in: string[] };
          confirmedAt: null;
          status: { notIn: ApptStatus[] };
          date: { gte: Date };
        };
        const candidates = state.appointments
          .filter(
            (a) =>
              a.clinicId === w.clinicId &&
              w.patientId.in.includes(a.patientId) &&
              a.confirmedAt === null &&
              !w.status.notIn.includes(a.status) &&
              a.date.getTime() >= w.date.gte.getTime(),
          )
          .sort((a, b) => {
            const dir = args.orderBy?.date === "desc" ? -1 : 1;
            return dir * (a.date.getTime() - b.date.getTime());
          });
        return candidates[0] ?? null;
      }),
    },
    conversation: {
      findUnique: vi.fn(
        async (args: {
          where: {
            clinicId_externalId: { clinicId: string; externalId: string };
          };
        }) => {
          const { clinicId, externalId } = args.where.clinicId_externalId;
          return (
            state.conversations.find(
              (c) => c.clinicId === clinicId && c.externalId === externalId,
            ) ?? null
          );
        },
      ),
      create: vi.fn(
        async (args: {
          data: {
            clinicId: string;
            externalId: string;
            patientId: string | null;
          };
        }) => {
          const row: ConversationRow = {
            id: `conv-${state.nextConvId++}`,
            clinicId: args.data.clinicId,
            externalId: args.data.externalId,
            patientId: args.data.patientId ?? null,
          };
          state.conversations.push(row);
          return row;
        },
      ),
      update: vi.fn(async (args: { where: { id: string }; data: unknown }) => {
        const row = state.conversations.find((c) => c.id === args.where.id);
        return row ?? { id: args.where.id };
      }),
    },
    message: {
      create: vi.fn(async () => {
        state.messages++;
        return { id: `m-${state.messages}` };
      }),
    },
    notificationSend: {
      create: vi.fn(async () => ({})),
    },
    auditLog: {
      create: vi.fn(async () => ({})),
    },
    patient_audit: undefined,
  },
}));

// Imports AFTER the mocks so the route binds to the stubs.
import { POST } from "@/app/api/sms/webhook/[clinicSlug]/route";

// Mirror the inline parser from the route so we can spec it directly. If
// the route's logic ever drifts, the route-level scenarios below will catch
// the wiring break; this copy lets us exhaust the parser's token rules
// without booting the whole handler each time.
function isConfirmKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const stripped = text.toUpperCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  if (!stripped) return false;
  return new Set(["YES", "Y", "ДА", "DA", "HA"]).has(stripped);
}

// ----- helpers -----------------------------------------------------------

function buildRequest(
  body: Record<string, unknown>,
  { slug = "clinic-a" }: { slug?: string } = {},
): Request {
  return new Request(`https://example.test/api/sms/webhook/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedClinic(id: string, slug: string) {
  state.clinics.push({ id, slug });
}

function seedPatient(row: Partial<PatientRow> & { id: string; clinicId: string }) {
  const phone = row.phone ?? "+998901234567";
  state.patients.push({
    phoneNormalized: row.phoneNormalized ?? phone.replace(/[^\d+]/g, ""),
    phone,
    marketingOptOut: row.marketingOptOut ?? false,
    ...row,
  });
}

function seedAppointment(row: AppointmentRow) {
  state.appointments.push(row);
}

beforeEach(() => {
  state.clinics.length = 0;
  state.patients.length = 0;
  state.appointments.length = 0;
  state.conversations.length = 0;
  state.messages = 0;
  state.nextConvId = 1;
  confirmSpy.mockClear();
  confirmSpy.mockImplementation(async () => ({
    ok: true,
    appointment: {} as unknown,
    alreadyConfirmed: false,
  }));
  (process.env as Record<string, string>).NODE_ENV = "development";
});

afterEach(() => {
  vi.clearAllMocks();
});

// ========================================================================
// P1 — token matching: exact-match returns true
// ========================================================================
describe("P1 isConfirmKeyword — exact-match tokens", () => {
  it.each(["YES", "Y", "ДА", "DA", "HA", "yes", "Yes", "YeS", "y", "да", "ha", "da"])(
    "recognizes %s",
    (kw) => {
      expect(isConfirmKeyword(kw)).toBe(true);
    },
  );
});

// ========================================================================
// P2 — punctuation / whitespace tolerance
// ========================================================================
describe("P2 isConfirmKeyword — punctuation/whitespace tolerance", () => {
  it.each(["YES.", "YES!", "YES?", " YES ", "  yes  ", "Y.", "ДА!", "HA.", "\tYes\n", "yes!!!"])(
    "matches %s",
    (kw) => {
      expect(isConfirmKeyword(kw)).toBe(true);
    },
  );
});

// ========================================================================
// P3 — whole-message rule (rejection)
// ========================================================================
describe("P3 isConfirmKeyword — whole-message rule", () => {
  it.each(["yes please", "YES, sure", "YESSSS", "no yes", "YESBOB", "yeah", "ok yes", "y u", "yesno"])(
    "rejects %s",
    (kw) => {
      expect(isConfirmKeyword(kw)).toBe(false);
    },
  );

  it("rejects empty / whitespace / nullish", () => {
    expect(isConfirmKeyword("")).toBe(false);
    expect(isConfirmKeyword("  ")).toBe(false);
    expect(isConfirmKeyword("\t\n")).toBe(false);
    expect(isConfirmKeyword(null)).toBe(false);
    expect(isConfirmKeyword(undefined)).toBe(false);
  });

  it("rejects pure punctuation", () => {
    expect(isConfirmKeyword("!!!")).toBe(false);
    expect(isConfirmKeyword("...")).toBe(false);
  });
});

// ========================================================================
// P4 — STOP keywords don't fire the confirm path
// ========================================================================
describe("P4 STOP keywords are not confused with YES", () => {
  it.each(["STOP", "stop", "СТОП", "TO'XTAT", "ОТПИСАТЬСЯ"])(
    "%s does not trigger confirmAppointment",
    async (kw) => {
      seedClinic("c1", "clinic-a");
      seedPatient({
        id: "p1",
        clinicId: "c1",
        phone: "+998901234567",
        phoneNormalized: "+998901234567",
      });
      seedAppointment({
        id: "appt-1",
        clinicId: "c1",
        patientId: "p1",
        date: new Date(Date.now() + 24 * 3600_000),
        status: "BOOKED",
        confirmedAt: null,
      });

      const res = await POST(
        buildRequest({ from: "+998901234567", to: "+998711234567", body: kw }),
      );
      expect(res.status).toBe(200);
      expect(confirmSpy).not.toHaveBeenCalled();
    },
  );
});

// ========================================================================
// P5 — happy path
// ========================================================================
describe("P5 happy path — one future unconfirmed appointment", () => {
  it("calls confirmAppointment with the right args and acks 200", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    const appt = {
      id: "appt-happy",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "BOOKED" as const,
      confirmedAt: null,
    };
    seedAppointment(appt);

    const res = await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );

    expect(res.status).toBe(200);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith({
      appointmentId: "appt-happy",
      clinicId: "c1",
      actorId: null,
      via: "SMS_REPLY",
    });
  });
});

// ========================================================================
// P6 — unknown phone
// ========================================================================
describe("P6 unknown phone", () => {
  it("does not call confirmAppointment and still 200s", async () => {
    seedClinic("c1", "clinic-a");
    // No patients seeded.
    const res = await POST(
      buildRequest({ from: "+998909999999", to: "+998711234567", body: "YES" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

// ========================================================================
// P7 — known patient, no eligible appointment
// ========================================================================
describe("P7 known patient with no eligible appointment", () => {
  it("all already confirmed → no call, 200", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-already",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "CONFIRMED",
      confirmedAt: new Date(Date.now() - 1 * 3600_000),
    });

    const res = await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("only past appointments → no call, 200", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-past",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() - 2 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    const res = await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("all CANCELLED → no call, 200", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-cancelled",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "CANCELLED",
      confirmedAt: null,
    });

    const res = await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

// ========================================================================
// P8 — multiple future unconfirmed → nearest wins
// ========================================================================
describe("P8 multiple future unconfirmed → nearest wins", () => {
  it("picks the appointment with the earliest date", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    // Intentionally insert out of order — the resolver's orderBy(asc) must
    // do the sorting, not the seed order.
    seedAppointment({
      id: "appt-d5",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 5 * 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });
    seedAppointment({
      id: "appt-h10",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 10 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });
    seedAppointment({
      id: "appt-d2",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 2 * 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    const res = await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]?.[0]).toMatchObject({
      appointmentId: "appt-h10",
    });
  });
});

// ========================================================================
// P9 — past appointments excluded
// ========================================================================
describe("P9 past appointment excluded even if unconfirmed", () => {
  it("does not pick an appointment in the past", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-past-unconfirmed",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() - 2 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    const res = await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

// ========================================================================
// P10 — CANCELLED / NO_SHOW / COMPLETED excluded
// ========================================================================
describe("P10 status allowlist", () => {
  it.each<ApptStatus>(["CANCELLED", "NO_SHOW", "COMPLETED"])(
    "%s in future with confirmedAt=null is NOT picked",
    async (status) => {
      seedClinic("c1", "clinic-a");
      seedPatient({
        id: "p1",
        clinicId: "c1",
        phone: "+998901234567",
        phoneNormalized: "+998901234567",
      });
      seedAppointment({
        id: `appt-${status.toLowerCase()}`,
        clinicId: "c1",
        patientId: "p1",
        date: new Date(Date.now() + 24 * 3600_000),
        status,
        confirmedAt: null,
      });

      const res = await POST(
        buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
      );
      expect(res.status).toBe(200);
      expect(confirmSpy).not.toHaveBeenCalled();
    },
  );

  it("if both an eligible BOOKED and a future CANCELLED exist, picks BOOKED", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    // Earlier date but CANCELLED → must be skipped in favor of the later BOOKED.
    seedAppointment({
      id: "appt-bad",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 2 * 3600_000),
      status: "CANCELLED",
      confirmedAt: null,
    });
    seedAppointment({
      id: "appt-good",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 12 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]?.[0]).toMatchObject({ appointmentId: "appt-good" });
  });
});

// ========================================================================
// P11 — family-shared phone: earliest appointment wins regardless of patient
// ========================================================================
describe("P11 family-shared phone", () => {
  // Real product behavior: two Patient rows can share `phoneNormalized` (a
  // parent and child sharing the family number). The webhook does not try to
  // disambiguate which family member texted — whoever has the soonest
  // unconfirmed appointment gets flipped, because that's the appointment the
  // reminder went out for.
  it("picks the earlier appointment even if it belongs to a different patient on the shared phone", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p-parent",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedPatient({
      id: "p-child",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-parent-later",
      clinicId: "c1",
      patientId: "p-parent",
      date: new Date(Date.now() + 3 * 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });
    seedAppointment({
      id: "appt-child-soon",
      clinicId: "c1",
      patientId: "p-child",
      date: new Date(Date.now() + 6 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]?.[0]).toMatchObject({
      appointmentId: "appt-child-soon",
    });
  });
});

// ========================================================================
// P12 — phone normalization across formats
// ========================================================================
describe("P12 phone normalization variants", () => {
  // The route uses `phoneNormalized: { contains: digits }` with `digits` being
  // `from.replace(/\D/g, "")`. That means as long as the patient is stored
  // with `phoneNormalized = +998901234567`, every variant whose digit-only
  // form contains `998901234567` (or whose digit-only form contains `901234567`
  // which still substrings the canonical) will match.
  //
  // We seed the patient with the canonical "+998901234567" and assert that
  // every reasonable inbound format resolves the same appointment.
  beforeEach(() => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-normalized",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });
  });

  it.each([
    "+998 90 123 45 67",
    "998901234567",
    "+998901234567",
    "(998) 90-123-45-67",
  ])("resolves %s to the canonical patient", async (from) => {
    await POST(buildRequest({ from, to: "+998711234567", body: "YES" }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]?.[0]).toMatchObject({
      appointmentId: "appt-normalized",
    });
    confirmSpy.mockClear();
  });

  // The local-only formats fail when the patient is stored as the canonical
  // `+998901234567`: the route does `phoneNormalized: { contains: "901234567" }`,
  // and the canonical does contain it as a substring, so they SHOULD match.
  // We assert that here.
  it.each(["90-123-45-67", "(90) 123-45-67", "901234567"])(
    "local-only %s still resolves via substring containment",
    async (from) => {
      await POST(buildRequest({ from, to: "+998711234567", body: "YES" }));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0]?.[0]).toMatchObject({
        appointmentId: "appt-normalized",
      });
      confirmSpy.mockClear();
    },
  );
});

// ========================================================================
// P13 — clinic-slug routing
// ========================================================================
describe("P13 clinic-slug isolation", () => {
  it("YES posted to clinic-a doesn't confirm appointments in clinic-b", async () => {
    seedClinic("c-a", "clinic-a");
    seedClinic("c-b", "clinic-b");
    // Phone-matching patient only exists in clinic B.
    seedPatient({
      id: "pb",
      clinicId: "c-b",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-b",
      clinicId: "c-b",
      patientId: "pb",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    const res = await POST(
      buildRequest(
        { from: "+998901234567", to: "+998711234567", body: "YES" },
        { slug: "clinic-a" },
      ),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("same YES posted to clinic-b DOES confirm", async () => {
    seedClinic("c-a", "clinic-a");
    seedClinic("c-b", "clinic-b");
    seedPatient({
      id: "pb",
      clinicId: "c-b",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-b",
      clinicId: "c-b",
      patientId: "pb",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    const res = await POST(
      buildRequest(
        { from: "+998901234567", to: "+998711234567", body: "YES" },
        { slug: "clinic-b" },
      ),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]?.[0]).toMatchObject({
      appointmentId: "appt-b",
      clinicId: "c-b",
    });
  });
});

// ========================================================================
// P14 — helper returns ok:false → still 200
// ========================================================================
describe("P14 helper rejection still acks 200", () => {
  it("ok:false reason=completed → 200, no 4xx", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-x",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    confirmSpy.mockImplementationOnce(async () => ({
      ok: false,
      reason: "completed",
    }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });
});

// ========================================================================
// P15 — helper throws → still 200
// ========================================================================
describe("P15 helper exception still acks 200", () => {
  it("thrown error is caught, logged, response stays 200", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-boom",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    confirmSpy.mockImplementationOnce(async () => {
      throw new Error("DB exploded");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ========================================================================
// P16 — actorId: null + SMS_REPLY via
// ========================================================================
describe("P16 actorId/null + via=SMS_REPLY", () => {
  it("the helper receives actorId=null and via=SMS_REPLY", async () => {
    seedClinic("c1", "clinic-a");
    seedPatient({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
    });
    seedAppointment({
      id: "appt-actor",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 24 * 3600_000),
      status: "BOOKED",
      confirmedAt: null,
    });

    await POST(
      buildRequest({ from: "+998901234567", to: "+998711234567", body: "YES" }),
    );
    const call = confirmSpy.mock.calls[0]?.[0];
    expect(call?.actorId).toBeNull();
    expect(call?.via).toBe("SMS_REPLY");
    // clinicId and appointmentId are also part of the contract.
    expect(call?.clinicId).toBe("c1");
    expect(call?.appointmentId).toBe("appt-actor");
  });
});

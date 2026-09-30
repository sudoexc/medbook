/**
 * Audit AP-08: a phone booking is stored with its service price.
 *
 * The CRM booking route passed `priceFinal: body.priceFinal ?? null`, the
 * booking dialog never sends a price, and the kernel took the null for an
 * explicit price (`!== undefined`). Every phone booking was stored with
 * `priceFinal = null` although its base price was known; only a later
 * attach to a medical case repriced it. When reception closed the case
 * picker, the visit card read «Итого 0 сум».
 *
 * Acceptance: POST with services and without priceFinal stores
 * priceFinal = priceBase − discounts, whatever happens with the case.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("bookingPriceFinal", () => {
  it("null and undefined both mean «not set»: priced from the services", async () => {
    const { bookingPriceFinal } = await import("@/server/appointments/book");
    const base = { priceBase: 150_000_00, discountPct: 0, discountAmount: 0 };
    expect(bookingPriceFinal({ ...base, explicit: null })).toBe(150_000_00);
    expect(bookingPriceFinal({ ...base, explicit: undefined })).toBe(150_000_00);
  });

  it("discounts apply to the base: percent first, then the amount, never below 0", async () => {
    const { bookingPriceFinal } = await import("@/server/appointments/book");
    expect(
      bookingPriceFinal({
        explicit: undefined,
        priceBase: 200_000_00,
        discountPct: 10,
        discountAmount: 5_000_00,
      }),
    ).toBe(175_000_00);
    expect(
      bookingPriceFinal({
        explicit: null,
        priceBase: 10_000_00,
        discountPct: 0,
        discountAmount: 50_000_00,
      }),
    ).toBe(0);
  });

  it("a typed price wins, including an explicit 0 (a free visit)", async () => {
    const { bookingPriceFinal } = await import("@/server/appointments/book");
    const base = { priceBase: 150_000_00, discountPct: 0, discountAmount: 0 };
    expect(bookingPriceFinal({ ...base, explicit: 120_000_00 })).toBe(120_000_00);
    expect(bookingPriceFinal({ ...base, explicit: 0 })).toBe(0);
  });

  it("no service: nothing to price by, null", async () => {
    const { bookingPriceFinal } = await import("@/server/appointments/book");
    expect(
      bookingPriceFinal({
        explicit: null,
        priceBase: null,
        discountPct: 0,
        discountAmount: 0,
      }),
    ).toBeNull();
  });
});

const h = vi.hoisted(() => ({
  book: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true as const,
    appointment: { id: "a1", ...input },
  })),
}));

describe("POST /api/crm/appointments hands a missing price over as missing", () => {
  beforeEach(() => {
    vi.resetModules();
    h.book.mockClear();
    vi.doMock("@/lib/auth", () => ({
      auth: vi.fn(async () => ({
        user: { id: "u_recept", role: "RECEPTIONIST", clinicId: "c1", email: "x@example.test" },
      })),
    }));
    vi.doMock("@/lib/pin", () => ({ hasValidPin: () => false }));
    vi.doMock("@/lib/tenant-context", () => ({
      runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
      getTenant: () => ({
        kind: "TENANT" as const,
        clinicId: "c1",
        userId: "u_recept",
        role: "RECEPTIONIST",
      }),
    }));
    vi.doMock("@/server/platform/branch-cookie", () => ({
      readActiveBranchFromCookieHeader: () => null,
    }));
    vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
    vi.doMock("@/server/appointments/book", () => ({ bookAppointment: h.book }));
  });

  async function post(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/crm/appointments/route");
    return POST(
      new Request("https://x/api/crm/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: "p1",
          doctorId: "doc_1",
          date: "2026-10-01T05:00:00.000Z",
          channel: "PHONE",
          services: [{ serviceId: "svc_consult", quantity: 1 }],
          ...body,
        }),
      }),
    );
  }

  it("no priceFinal in the body: the kernel gets undefined, not null", async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    expect(h.book).toHaveBeenCalledTimes(1);
    const input = h.book.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.priceFinal).toBeUndefined();
  });

  it("a typed price still reaches the kernel", async () => {
    await post({ priceFinal: 90_000_00 });
    const input = h.book.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.priceFinal).toBe(90_000_00);
  });
});

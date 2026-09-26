/**
 * Audit LD-10: the site booking form refused every Uzbek number whose
 * operator code does not start with 9.
 *
 * The form checked `9 digits starting with 9, or 12 starting with 9989`, so
 * a patient on Humans 33, Mobiuz 88, Uzmobile 77, Ucell 50 or OQ 20 pressed
 * «Отправить заявку» and got the generic «Произошла ошибка», which reads as
 * a broken site, and left. The API was the opposite: anything of 9 to 20
 * characters passed, and normalizePhone turned «33 123 45 67» into
 * «+331234567». Pinned here:
 *   - one rule (isValidUzPhone) for the form and the API: any operator or
 *     area code, with or without +998;
 *   - normalizePhone adds +998 to any 9-digit number (and formatPhone shows
 *     it the same way);
 *   - POST /api/leads stores +99833…/+99888…/+99877… and refuses «12345» and
 *     «+7 999…» naming the phone field;
 *   - the form maps that refusal to the field message and does not let the
 *     browser's own `pattern` bubble pre-empt it.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isValidUzPhone, normalizePhone, uzNationalNumber } from "@/lib/phone";
import { formatPhone } from "@/lib/format";

const state = vi.hoisted(() => ({
  leadCreates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/public-clinic", () => ({
  resolvePublicClinic: vi.fn(async () => ({ id: "c1", slug: "neurofax" })),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
vi.mock("@/lib/email", () => ({ sendNewLeadEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    doctor: { findFirst: vi.fn(async () => null) },
    lead: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.leadCreates.push(data);
        return { id: "lead_1", name: data.name, phone: data.phone, service: null };
      }),
    },
    eventOutbox: { create: vi.fn(async () => ({ id: "ob" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => {
      const { prisma: p } = await import("@/lib/prisma");
      return fn(p);
    }),
  };
  return { prisma };
});

// The form, rendered with its dialog always open.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ru",
}));
vi.mock("@/components/providers/doctors-provider", () => ({
  useDoctors: () => [],
}));
vi.mock("@/components/ui/dialog", async () => {
  const R = await import("react");
  const pass = ({ children }: { children?: React.ReactNode }) =>
    R.createElement(R.Fragment, null, children);
  return {
    Dialog: pass,
    DialogContent: pass,
    DialogHeader: pass,
    DialogTitle: pass,
    DialogTrigger: ({ render }: { render: React.ReactElement }) => render,
  };
});

beforeEach(() => {
  state.leadCreates = [];
});

describe("isValidUzPhone: any Uzbek operator, with or without +998", () => {
  it.each([
    "33 412 55 67",
    "+998 88 123 45 67",
    "77 123 45 67",
    "+998 (50) 123-45-67",
    "20 123 45 67",
    "55 123 45 67",
    "90 123 45 67",
    "+998901234567",
    "998991234567",
    "+998 71 275 28 18",
  ])("accepts %s", (phone) => {
    expect(isValidUzPhone(phone)).toBe(true);
  });

  it.each([
    "12345",
    "+7 999 123 45 67",
    "",
    "   ",
    "8 90 123 45 67",
    "+998 12 345 67 89",
    "01 234 56 78",
    "33 412 55 67 доб. 2",
    "+1 555 123 4567",
  ])("refuses %s", (phone) => {
    expect(isValidUzPhone(phone)).toBe(false);
  });

  it("returns the 9 national digits", () => {
    expect(uzNationalNumber("+998 (33) 412-55-67")).toBe("334125567");
    expect(uzNationalNumber("88 123 45 67")).toBe("881234567");
    expect(uzNationalNumber("12345")).toBeNull();
  });
});

describe("normalizePhone: +998 for every 9-digit local number", () => {
  it("adds the country code whatever the operator code", () => {
    expect(normalizePhone("33 412 55 67")).toBe("+998334125567");
    expect(normalizePhone("+998 88 123 45 67")).toBe("+998881234567");
    expect(normalizePhone("77 123 45 67")).toBe("+998771234567");
    expect(normalizePhone("90 123 45 67")).toBe("+998901234567");
  });

  it("leaves other shapes as before", () => {
    expect(normalizePhone("+7 999 123 45 67")).toBe("+79991234567");
    expect(normalizePhone("")).toBe("");
  });

  it("formatPhone shows a local number the same way", () => {
    expect(formatPhone("334125567")).toBe("+998 (33) 412-55-67");
    expect(formatPhone("+998881234567")).toBe("+998 (88) 123-45-67");
  });
});

async function postLead(phone: string) {
  const { POST } = await import("@/app/api/leads/route");
  return POST(
    new Request("https://neurofax.uz/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Азиз", phone }),
    }),
  );
}

describe("POST /api/leads: the same rule as the form", () => {
  it.each([
    ["33 412 55 67", "+998334125567"],
    ["+998 88 123 45 67", "+998881234567"],
    ["77 123 45 67", "+998771234567"],
  ])("takes %s and stores %s", async (phone, stored) => {
    const res = await postLead(phone);
    expect(res.status).toBe(201);
    expect(state.leadCreates).toHaveLength(1);
    expect(state.leadCreates[0].phone).toBe(stored);
  });

  it.each(["12345", "+7 999 123 45 67"])(
    "refuses %s naming the phone field, and stores nothing",
    async (phone) => {
      const res = await postLead(phone);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.phone).toBeTruthy();
      expect(state.leadCreates).toHaveLength(0);
    },
  );
});

describe("the lead form", () => {
  it("reads a phone refusal from the API as a field error, anything else as generic", async () => {
    const { isPhoneRejection } = await import("@/components/sections/lead-form");
    expect(isPhoneRejection(400, { error: { phone: ["Invalid phone"] } })).toBe(true);
    expect(isPhoneRejection(400, { error: { name: ["Too short"] } })).toBe(false);
    expect(isPhoneRejection(400, { error: "Invalid JSON" })).toBe(false);
    expect(isPhoneRejection(429, { error: "Too many requests" })).toBe(false);
    expect(isPhoneRejection(500, null)).toBe(false);
  });

  it("has no `pattern` on the phone field, so «12345» reaches the form's own message", async () => {
    const { LeadFormTrigger } = await import("@/components/sections/lead-form");
    const html = renderToStaticMarkup(
      React.createElement(LeadFormTrigger, null, React.createElement("button", null, "open")),
    );
    const phoneInput = html.match(/<input[^>]*id="lead-phone"[^>]*>/)?.[0] ?? "";
    expect(phoneInput).toContain('type="tel"');
    expect(phoneInput).not.toContain("pattern=");
    // No error before anything was sent.
    expect(html).not.toContain("phoneInvalid");
  });

  it("has the field message in both languages, without dashes", async () => {
    const ru = (await import("@/messages/ru.json")).default as { leadForm: Record<string, string> };
    const uz = (await import("@/messages/uz.json")).default as { leadForm: Record<string, string> };
    for (const msgs of [ru, uz]) {
      expect(msgs.leadForm.phoneInvalid).toBeTruthy();
      expect(msgs.leadForm.phoneInvalid).not.toMatch(/[—–]/);
    }
  });
});

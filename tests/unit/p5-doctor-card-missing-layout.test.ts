/**
 * Audit ST-04: a DOCTOR login without a schedule card used to be redirected
 * to /crm, and the CRM layout sends every DOCTOR back to /doctor; the
 * browser gave up with «too many redirects». The cabinet layout now renders
 * an explanation page instead, and a doctor with a card still gets the
 * cabinet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  doctor: null as null | Record<string, unknown>,
  redirects: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    h.redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "doc1", role: "DOCTOR", clinicId: "c1", email: "d@x.uz" },
  })),
}));
vi.mock("@/lib/doctor-cabinet", () => ({ isDoctorCabinetEnabled: () => true }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { doctor: { findFirst: vi.fn(async () => h.doctor) } },
}));
vi.mock("@/components/providers/query-provider", () => ({
  QueryProvider: function QueryProvider() {
    return null;
  },
}));
vi.mock("@/components/layout/global-tg-alerts", () => ({ GlobalTgAlerts: () => null }));
vi.mock("@/components/auth/session-expiry-watch", () => ({ SessionExpiryWatch: () => null }));
vi.mock("@/app/[locale]/doctor/_components/doctor-sidebar", () => ({ DoctorSidebar: () => null }));
vi.mock("@/app/[locale]/doctor/_components/doctor-topbar", () => ({ DoctorTopbar: () => null }));
vi.mock("@/app/[locale]/doctor/_components/doctor-card-missing", () => ({
  DoctorCardMissing: function DoctorCardMissing() {
    return null;
  },
}));

import DoctorLayout from "@/app/[locale]/doctor/layout";
import { DoctorCardMissing } from "@/app/[locale]/doctor/_components/doctor-card-missing";

beforeEach(() => {
  h.redirects = [];
});

describe("doctor cabinet layout", () => {
  it("a doctor without a card sees the explanation, no redirect", async () => {
    h.doctor = null;
    const el = (await DoctorLayout({
      children: null,
      params: Promise.resolve({ locale: "ru" }),
    })) as { type: unknown };
    expect(h.redirects).toEqual([]);
    expect(el.type).toBe(DoctorCardMissing);
  });

  it("a doctor with a card gets the cabinet as before", async () => {
    h.doctor = { id: "card1", nameRu: "Султанов Азиз", specializationRu: null, photoUrl: null };
    const el = (await DoctorLayout({
      children: null,
      params: Promise.resolve({ locale: "ru" }),
    })) as { type: unknown };
    expect(h.redirects).toEqual([]);
    expect(el.type).not.toBe(DoctorCardMissing);
  });
});

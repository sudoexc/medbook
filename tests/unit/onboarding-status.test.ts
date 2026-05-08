/**
 * Tests for GET /api/crm/onboarding-status — the Phase 11 Onboarding v2
 * progressive setup checklist API.
 *
 * Mocks `@/lib/auth` (TENANT ADMIN session) and `@/lib/prisma` (in-memory
 * counters + clinic record). No DB / Next runtime spinning up.
 *
 * Covered scenarios:
 *   - empty clinic       → all step booleans false, complete=false
 *   - fully populated    → all true, complete=true
 *   - partial state      → exact matching booleans
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type ClinicRow = {
  phone: string | null;
  addressRu: string | null;
  addressUz: string | null;
  tgBotToken: string | null;
};

interface State {
  clinic: ClinicRow | null;
  cabinets: number;
  services: number;
  doctors: number;
  doctorSchedules: number;
  templates: number;
  patients: number;
  appointments: number;
}

const state: State = {
  clinic: null,
  cabinets: 0,
  services: 0,
  doctors: 0,
  doctorSchedules: 0,
  templates: 0,
  patients: 0,
  appointments: 0,
};

const sessionRef: { current: { user: { id: string; role: string; clinicId: string | null } } | null } = {
  current: { user: { id: "u_admin", role: "ADMIN", clinicId: "c1" } },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sessionRef.current),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async () => state.clinic),
    },
    cabinet: { count: vi.fn(async () => state.cabinets) },
    service: { count: vi.fn(async () => state.services) },
    doctor: { count: vi.fn(async () => state.doctors) },
    doctorSchedule: { count: vi.fn(async () => state.doctorSchedules) },
    notificationTemplate: { count: vi.fn(async () => state.templates) },
    patient: { count: vi.fn(async () => state.patients) },
    appointment: { count: vi.fn(async () => state.appointments) },
  },
}));

function reset() {
  state.clinic = {
    phone: null,
    addressRu: null,
    addressUz: null,
    tgBotToken: null,
  };
  state.cabinets = 0;
  state.services = 0;
  state.doctors = 0;
  state.doctorSchedules = 0;
  state.templates = 0;
  state.patients = 0;
  state.appointments = 0;
  sessionRef.current = {
    user: { id: "u_admin", role: "ADMIN", clinicId: "c1" },
  };
}

beforeEach(reset);

async function loadGet() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/onboarding-status/route");
  return mod.GET;
}

function req(): Request {
  return new Request("https://x/api/crm/onboarding-status");
}

type Body = {
  steps: Record<string, boolean>;
  counts: Record<string, number>;
  complete: boolean;
};

describe("GET /api/crm/onboarding-status", () => {
  it("empty clinic → all steps false, complete=false", async () => {
    const GET = await loadGet();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.steps).toEqual({
      clinic: false,
      cabinets: false,
      services: false,
      doctors: false,
      doctorSchedule: false,
      templates: false,
      firstPatient: false,
      firstAppointment: false,
      tgBotConnected: false,
    });
    expect(body.complete).toBe(false);
  });

  it("fully populated → all steps true, complete=true", async () => {
    state.clinic = {
      phone: "+998901234567",
      addressRu: "Ташкент, ул. Юнусобод 1",
      addressUz: "Toshkent, Yunusobod 1",
      tgBotToken: "token-xyz",
    };
    state.cabinets = 3;
    state.services = 12;
    state.doctors = 4;
    state.doctorSchedules = 9;
    state.templates = 7;
    state.patients = 100;
    state.appointments = 250;

    const GET = await loadGet();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.steps).toEqual({
      clinic: true,
      cabinets: true,
      services: true,
      doctors: true,
      doctorSchedule: true,
      templates: true,
      firstPatient: true,
      firstAppointment: true,
      tgBotConnected: true,
    });
    expect(body.counts).toEqual({
      cabinets: 3,
      services: 12,
      doctors: 4,
      doctorSchedules: 9,
      templates: 7,
      patients: 100,
      appointments: 250,
    });
    expect(body.complete).toBe(true);
  });

  it("partial state → exact step booleans match (no TG, no appointments)", async () => {
    state.clinic = {
      phone: "+998901234567",
      addressRu: null,
      addressUz: "Toshkent, Yunusobod 1",
      tgBotToken: null,
    };
    state.cabinets = 1;
    state.services = 2;
    state.doctors = 1;
    state.doctorSchedules = 0;
    state.templates = 1;
    state.patients = 5;
    state.appointments = 0;

    const GET = await loadGet();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.steps).toEqual({
      clinic: true,
      cabinets: true,
      services: true,
      doctors: true,
      doctorSchedule: false,
      templates: true,
      firstPatient: true,
      firstAppointment: false,
      tgBotConnected: false,
    });
    expect(body.complete).toBe(false);
  });

  it("clinic with phone only (no address) → clinic step false", async () => {
    state.clinic = {
      phone: "+998901234567",
      addressRu: null,
      addressUz: null,
      tgBotToken: null,
    };
    const GET = await loadGet();
    const res = await GET(req());
    const body = (await res.json()) as Body;
    expect(body.steps.clinic).toBe(false);
  });

  it("rejects unauthenticated requests", async () => {
    sessionRef.current = null;
    const GET = await loadGet();
    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});

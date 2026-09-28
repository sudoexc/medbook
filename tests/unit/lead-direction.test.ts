/**
 * Audit LD-09: the site booking form forced a doctor and asked nothing else.
 *
 * The only choice was a REQUIRED doctor among the bookable ones (today one
 * or two neurologists). A parent who wanted an EEG or the pediatric
 * neurologist pinned the request on the wrong doctor or gave up, and when
 * getDoctors() returned [] (a short DB hiccup) the browser refused to send
 * the form at all («Выберите элемент в списке», nothing to choose). Pinned:
 *   - a «Направление» choice built from the price sheet the landing shows,
 *     sent as Lead.service (a stable key reception reads translated);
 *   - the doctor is optional («Любой врач»), offered only for consultations
 *     and only when there is a bookable doctor, never `required`;
 *   - a diagnostic never carries a doctor in the request body;
 *   - POST /api/leads stores doctorId null + the direction, drops an unknown
 *     direction without losing the request, and names the direction (not
 *     the key) in the doctor's email.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LEAD_DIRECTIONS,
  directionTakesDoctor,
  leadDirectionKey,
} from "@/lib/lead-directions";
import type { DoctorView } from "@/lib/doctors";

const state = vi.hoisted(() => ({
  leadCreates: [] as Array<Record<string, unknown>>,
  emails: [] as Array<Record<string, unknown>>,
  activeDoctor: null as null | { nameRu: string; user: { email: string } },
  doctors: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/public-clinic", () => ({
  resolvePublicClinic: vi.fn(async () => ({ id: "c1", slug: "neurofax" })),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
vi.mock("@/lib/email", () => ({
  sendNewLeadEmail: vi.fn(async (data: Record<string, unknown>) => {
    state.emails.push(data);
  }),
}));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    doctor: { findFirst: vi.fn(async () => state.activeDoctor) },
    lead: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.leadCreates.push(data);
        return { id: "lead_1", name: data.name, phone: data.phone, service: data.service };
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

// The form, rendered with its dialog always open. Translations render as
// their keys, so the markup says which string sits where.
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key),
  useLocale: () => "ru",
}));
vi.mock("@/components/providers/doctors-provider", () => ({
  useDoctors: () => state.doctors,
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

function doctor(id: string, bookable: boolean): DoctorView {
  return {
    id,
    slug: id,
    name: { ru: `Врач ${id}`, uz: `Shifokor ${id}` },
    specialty: { ru: "Невролог", uz: "Nevrolog" },
    photo: null,
    bookable,
    schedule: [],
  };
}

beforeEach(() => {
  state.leadCreates = [];
  state.emails = [];
  state.activeDoctor = null;
  state.doctors = [];
});

async function postLead(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/leads/route");
  return POST(
    new Request("https://neurofax.uz/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Мама Азизы", phone: "90 123 45 67", ...body }),
    }),
  );
}

async function renderForm(doctorId?: string) {
  const { LeadFormTrigger } = await import("@/components/sections/lead-form");
  return renderToStaticMarkup(
    React.createElement(
      LeadFormTrigger,
      { doctorId },
      React.createElement("button", null, "open"),
    ),
  );
}

describe("POST /api/leads: a request without a doctor, with a direction", () => {
  it("stores doctorId null and the direction in Lead.service", async () => {
    const res = await postLead({ service: "eeg" });
    expect(res.status).toBe(201);
    expect(state.leadCreates).toHaveLength(1);
    expect(state.leadCreates[0]).toMatchObject({ doctorId: null, service: "eeg" });
  });

  it("keeps a chosen doctor together with the direction", async () => {
    state.activeDoctor = { nameRu: "Султанов Азиз", user: { email: "aziz@x.t" } };
    const res = await postLead({ doctorId: "doc_1", service: "neurologist" });
    expect(res.status).toBe(201);
    expect(state.leadCreates[0]).toMatchObject({
      doctorId: "doc_1",
      service: "neurologist",
    });
    await new Promise((r) => setTimeout(r, 0));
    // The Russian email names the direction, not its key.
    expect(state.emails[0].service).toBe("Консультация невролога");
  });

  it("drops an unknown direction but never the request", async () => {
    const res = await postLead({ service: "<b>anything</b>" });
    expect(res.status).toBe(201);
    expect(state.leadCreates[0].service).toBeNull();
  });

  it("still takes a request with neither doctor nor direction", async () => {
    const res = await postLead({});
    expect(res.status).toBe(201);
    expect(state.leadCreates[0]).toMatchObject({ doctorId: null, service: null });
  });
});

describe("the directions", () => {
  it("cover the consultations and the diagnostics of the price sheet", () => {
    const keys = LEAD_DIRECTIONS.map((d) => d.key);
    expect(keys).toEqual(
      expect.arrayContaining(["neurologist", "childNeurologist", "cardiologist", "eeg", "ecg", "ultrasound"]),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ask for a doctor only on a consultation or when nothing is chosen", () => {
    expect(directionTakesDoctor("")).toBe(true);
    expect(directionTakesDoctor("neurologist")).toBe(true);
    expect(directionTakesDoctor("cardiologist")).toBe(true);
    expect(directionTakesDoctor("eeg")).toBe(false);
    expect(directionTakesDoctor("ultrasound")).toBe(false);
  });

  it("read back only known keys", () => {
    expect(leadDirectionKey("eegSleep")).toBe("eegSleep");
    expect(leadDirectionKey(" eeg ")).toBe("eeg");
    expect(leadDirectionKey("ЭЭГ")).toBeNull();
    expect(leadDirectionKey(null)).toBeNull();
  });

  it("have a label in both languages, without dashes", async () => {
    const ru = (await import("@/messages/ru.json")).default as unknown as {
      leadForm: Record<string, unknown> & { directions: Record<string, string> };
    };
    const uz = (await import("@/messages/uz.json")).default as unknown as typeof ru;
    for (const msgs of [ru, uz]) {
      for (const { key } of LEAD_DIRECTIONS) {
        expect(msgs.leadForm.directions[key]).toBeTruthy();
        expect(msgs.leadForm.directions[key]).not.toMatch(/[—–]/);
      }
      expect(Object.keys(msgs.leadForm.directions).sort()).toEqual(
        LEAD_DIRECTIONS.map((d) => d.key).sort(),
      );
      for (const k of ["direction", "anyDirection", "anyDoctor"]) {
        expect(msgs.leadForm[k]).toBeTruthy();
        expect(msgs.leadForm[k]).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("the lead form", () => {
  it("sends with an empty doctor list: no doctor select, nothing to force", async () => {
    state.doctors = [];
    const html = await renderForm();
    expect(html).toContain('id="lead-direction"');
    expect(html).not.toContain('id="lead-doctor"');
    // Only name and phone are required; no select is.
    for (const select of html.match(/<select[^>]*>/g) ?? []) {
      expect(select).not.toContain("required");
    }
    for (const { key } of LEAD_DIRECTIONS) {
      expect(html).toContain(`value="${key}"`);
      expect(html).toContain(`leadForm.directions.${key}`);
    }
    expect(html).toContain("leadForm.anyDirection");
  });

  it("offers the bookable doctors as an optional choice, «Любой врач» first", async () => {
    state.doctors = [doctor("d1", true), doctor("d2", false)];
    const html = await renderForm();
    const select = html.match(/<select[^>]*id="lead-doctor"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).not.toBe("");
    expect(select).not.toContain("required");
    expect(select).toMatch(/^<select[^>]*><option value=""[^>]*>leadForm\.anyDoctor<\/option>/);
    expect(select).toContain('value="d1"');
    // A deactivated doctor is still not offered.
    expect(select).not.toContain('value="d2"');
  });

  it("offers no doctor when none is bookable", async () => {
    state.doctors = [doctor("d2", false)];
    const html = await renderForm("d2");
    expect(html).not.toContain('id="lead-doctor"');
  });

  it("never sends a doctor with a diagnostic, always sends the direction", async () => {
    const { buildLeadRequest } = await import("@/components/sections/lead-form");
    const base = {
      name: "Мама Азизы",
      phone: "90 123 45 67",
      date: "",
      locale: "ru" as const,
    };
    expect(
      buildLeadRequest({ ...base, direction: "eeg", doctorId: "d1", bookableDoctorCount: 1 }),
    ).toMatchObject({ service: "eeg", doctorId: undefined });
    expect(
      buildLeadRequest({ ...base, direction: "neurologist", doctorId: "d1", bookableDoctorCount: 1 }),
    ).toMatchObject({ service: "neurologist", doctorId: "d1" });
    expect(
      buildLeadRequest({ ...base, direction: "", doctorId: "", bookableDoctorCount: 1 }),
    ).toMatchObject({ service: undefined, doctorId: undefined });
    // No bookable doctor: whatever state lingers, no doctor goes out.
    expect(
      buildLeadRequest({ ...base, direction: "neurologist", doctorId: "d1", bookableDoctorCount: 0 }),
    ).toMatchObject({ service: "neurologist", doctorId: undefined });
  });
});

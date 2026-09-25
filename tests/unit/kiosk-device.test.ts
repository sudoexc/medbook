import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit SEC-01: the kiosk APIs trusted «the slug is the bearer», but the
 * slug is public — anyone could look a patient up by phone and fill the
 * live queue. They now answer only to the clinic's paired tablet.
 */

const state = vi.hoisted(() => ({
  clinics: [] as {
    id: string;
    slug: string;
    active: boolean;
    kioskTokenHash: string | null;
    nameRu: string;
    nameUz: string;
    phone: null;
    addressRu: null;
    addressUz: null;
  }[],
  walkinCalls: 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, string> }) => {
        if (where.kioskTokenHash) {
          return state.clinics.find((c) => c.kioskTokenHash === where.kioskTokenHash) ?? null;
        }
        if (where.slug) return state.clinics.find((c) => c.slug === where.slug) ?? null;
        return null;
      }),
    },
  },
}));

vi.mock("@/server/appointments/walkin", () => ({
  registerWalkin: vi.fn(async () => {
    state.walkinCalls += 1;
    return {
      ok: true,
      appointmentId: "a1",
      duplicate: false,
      ticketCode: "T-1",
      ticketNumber: "C-001",
      queueOrder: 1,
      patient: { id: "p1", fullName: "Юсупова Лола Анваровна" },
      doctor: { id: "d1", nameRu: "Врач", nameUz: "Shifokor", color: null },
      cabinet: "5",
    };
  }),
}));

import {
  authenticateKiosk,
  hashKioskToken,
  issueKioskToken,
  maskPatientName,
  realClientIp,
} from "@/server/kiosk/device";

const TOKEN = "kiosk-token-of-neurofax-000000";

function walkinRequest(slug: string, headers: Record<string, string> = {}) {
  return new Request(`https://neurofax.uz/api/c/${slug}/queue/walkin`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ fullName: "Иван Иванов", phone: "+998901234567", doctorId: "d1" }),
  });
}

beforeEach(() => {
  state.walkinCalls = 0;
  state.clinics = [
    {
      id: "c1",
      slug: "neurofax",
      active: true,
      kioskTokenHash: hashKioskToken(TOKEN),
      nameRu: "NeuroFax",
      nameUz: "NeuroFax",
      phone: null,
      addressRu: null,
      addressUz: null,
    },
    {
      id: "c2",
      slug: "other",
      active: true,
      kioskTokenHash: hashKioskToken("token-of-another-clinic-0000"),
      nameRu: "Other",
      nameUz: "Other",
      phone: null,
      addressRu: null,
      addressUz: null,
    },
  ];
});

describe("kiosk device token", () => {
  it("issues random tokens and stores only their hash", () => {
    const a = issueKioskToken();
    const b = issueKioskToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashKioskToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });

  it("authenticates only the clinic whose token it is", async () => {
    const req = (token?: string) =>
      new Request("https://neurofax.uz/api/kiosk/checkin", {
        headers: token ? { "x-kiosk-token": token } : {},
      });
    expect(await authenticateKiosk(req())).toBeNull();
    expect(await authenticateKiosk(req("wrong-token-000000000000"))).toBeNull();
    expect(await authenticateKiosk(req(TOKEN))).toEqual({ clinicId: "c1", clinicSlug: "neurofax" });
    // Another clinic's slug with this clinic's token: refused.
    expect(await authenticateKiosk(req(TOKEN), "other")).toBeNull();
  });
});

describe("POST /api/c/[slug]/queue/walkin", () => {
  it("refuses a request without the kiosk token (401) and queues nobody", async () => {
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    const res = await POST(walkinRequest("neurofax"));
    expect(res.status).toBe(401);
    expect(state.walkinCalls).toBe(0);
  });

  it("refuses a token issued to another clinic (403, the tablet stays paired)", async () => {
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    const res = await POST(
      walkinRequest("neurofax", { "x-kiosk-token": "token-of-another-clinic-0000" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("kiosk_wrong_clinic");
    expect(state.walkinCalls).toBe(0);
  });

  it("serves the paired kiosk and never returns the full stored name", async () => {
    const { POST } = await import("@/app/api/c/[slug]/queue/walkin/route");
    const res = await POST(
      walkinRequest("neurofax", { "x-kiosk-token": TOKEN, "x-real-ip": "10.0.0.7" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.patient.fullName).toBe("Юсупова Л.А.");
    expect(JSON.stringify(body)).not.toContain("Лола");
  });
});

describe("helpers", () => {
  it("masks a name to surname + initials", () => {
    expect(maskPatientName("Юсупова Лола Анваровна")).toBe("Юсупова Л.А.");
    expect(maskPatientName("Каримов Бахтиёр")).toBe("Каримов Б.");
    expect(maskPatientName("Мадина")).toBe("Мадина");
    expect(maskPatientName("")).toBe("");
  });

  it("keys the rate limit on the address nginx saw, not a client-written header", () => {
    const spoofed = new Request("https://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9", "x-real-ip": "203.0.113.9" },
    });
    expect(realClientIp(spoofed)).toBe("203.0.113.9");
    const noReal = new Request("https://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" },
    });
    expect(realClientIp(noReal)).toBe("203.0.113.9");
  });
});

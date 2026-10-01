/**
 * Drug catalog admin (audit CT-10, CT-12, CT-13).
 *
 *   CT-10  The clinic override replaced the global `defaultDosing` object
 *          shallowly, and the settings form only knew adult / pediatric /
 *          renal: saving ANY edit erased the «Пожилым» dosing line for every
 *          doctor, and an empty form erased all dosing.
 *   CT-12  `z.coerce.boolean()` reads "false" as true: the «Без рецепта» chip
 *          (rxOnly=false) listed prescription drugs only.
 *   CT-13  The first packaging photo of a global drug created its overlay
 *          without the required author (500 after the file was stored), and
 *          `hideGlobal` defaults to true, so simply adding the author would
 *          have hidden the drug.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  overlay: null as null | { id: string; hideGlobal: boolean; overridesJson: unknown },
  globalDrug: null as null | Record<string, unknown>,
  upserts: [] as Array<{ create: Record<string, unknown>; update: Record<string, unknown> }>,
  creates: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  upsertError: null as unknown,
  deleted: [] as string[],
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u_doc", role: "ADMIN" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema
            ? opts.bodySchema.parse(await request.json())
            : undefined,
          ctx,
        }),
    createApiListHandler: () => async () => new Response(null),
  };
});
vi.mock("@/server/storage/minio", () => ({
  isStubMode: () => false,
  uploadObject: vi.fn(async () => ({ url: "x" })),
  deleteObject: vi.fn(async (_b: unknown, key: string) => {
    h.deleted.push(key);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinicCatalogOverlay: {
      findUnique: vi.fn(async () => h.overlay),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.creates.push(data);
        return { id: "ov_new", ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.updates.push(data);
        return { id: h.overlay?.id, ...data };
      }),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        if (h.upsertError) throw h.upsertError;
        h.upserts.push(args);
        return {};
      }),
    },
    drug: {
      findFirst: vi.fn(async ({ select }: { select: Record<string, unknown> }) => {
        // The photo route asks for { id, clinicId }; the overlay route for text.
        if (select && "clinicId" in select) return { id: "bisoprolol", clinicId: null };
        return h.globalDrug;
      }),
      update: vi.fn(async () => ({})),
    },
  },
}));

import {
  applyClinicOverlay,
  minimizeOverrides,
  sanitizeOverrides,
} from "@/server/catalog/clinic-overlay";
import { QueryDrugSchema } from "@/server/schemas/drug";
import { QueryLabCatalogSchema } from "@/server/schemas/lab";
import { QueryServiceSchema } from "@/server/schemas/service";
import { QueryConversationSchema } from "@/server/schemas/conversation";
import { queryBool } from "@/server/schemas/query-bool";
import { z } from "zod";

const BISOPROLOL_DOSING = {
  adult: "Начинать с 2,5 мг 1 раз в сутки",
  elderly: "Стартовая доза 1,25 мг, медленная титрация",
};

beforeEach(() => {
  h.overlay = null;
  h.globalDrug = {
    nameRu: "Бисопролол",
    nameUz: null,
    defaultDosing: BISOPROLOL_DOSING,
    contraindications: ["AV-блокада II–III степени"],
    sideEffects: ["Брадикардия"],
    rxOnly: true,
  };
  h.upserts = [];
  h.creates = [];
  h.updates = [];
  h.upsertError = null;
  h.deleted = [];
});

// ─── CT-10 ──────────────────────────────────────────────────────────────────

describe("CT-10: an override never erases dosing copy", () => {
  it("a name-only override keeps the global adult and elderly lines", () => {
    const overlays = { overrides: new Map([["bisoprolol", { nameRu: "Бисопролол (Конкор)" }]]) };
    const out = applyClinicOverlay(
      { id: "bisoprolol", nameRu: "Бисопролол", defaultDosing: BISOPROLOL_DOSING },
      "bisoprolol",
      overlays,
      "DRUG",
    );
    expect(out.nameRu).toBe("Бисопролол (Конкор)");
    expect(out.defaultDosing).toEqual(BISOPROLOL_DOSING);
  });

  it("a dosing override merges line by line: the adult line changes, elderly stays", () => {
    const overlays = {
      overrides: new Map([["bisoprolol", { defaultDosing: { adult: "5 мг утром" } }]]),
    };
    const out = applyClinicOverlay(
      { id: "bisoprolol", defaultDosing: BISOPROLOL_DOSING },
      "bisoprolol",
      overlays,
      "DRUG",
    );
    expect(out.defaultDosing).toEqual({ ...BISOPROLOL_DOSING, adult: "5 мг утром" });
    expect(out.clinicOverridden).toBe(true);
  });

  it("a stored null / empty dosing or list (the old bug's rows) is ignored on read", () => {
    expect(
      sanitizeOverrides("DRUG", {
        defaultDosing: null,
        contraindications: [],
        sideEffects: null,
        nameRu: "X",
      }),
    ).toEqual({ nameRu: "X" });
    expect(sanitizeOverrides("DRUG", { defaultDosing: { adult: "  ", renal: "" } })).toBeNull();
  });

  it("minimizeOverrides keeps only what differs from the global row", () => {
    const sent = sanitizeOverrides("DRUG", {
      nameRu: "Бисопролол",
      nameUz: null,
      defaultDosing: { ...BISOPROLOL_DOSING, renal: "Не превышать 10 мг" },
      contraindications: ["AV-блокада II–III степени"],
      sideEffects: ["Брадикардия", "Усталость"],
      rxOnly: true,
    })!;
    expect(minimizeOverrides("DRUG", sent, h.globalDrug!)).toEqual({
      defaultDosing: { renal: "Не превышать 10 мг" },
      sideEffects: ["Брадикардия", "Усталость"],
    });
  });

  it("a photo-only overlay is not «изменено клиникой»", () => {
    const overlays = { overrides: new Map([["bisoprolol", { photoUrl: "/api/x" }]]) };
    const out = applyClinicOverlay({ id: "bisoprolol" }, "bisoprolol", overlays, "DRUG");
    expect(out.clinicOverridden).toBe(false);
    expect((out as Record<string, unknown>).photoUrl).toBe("/api/x");
  });
});

function overlayPost(body: unknown) {
  return new Request("https://x/api/crm/clinic-catalog-overlays", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("CT-10: POST /clinic-catalog-overlays stores a real diff", () => {
  it("saving the override form unchanged stores nothing and hides nothing", async () => {
    const { POST } = await import("@/app/api/crm/clinic-catalog-overlays/route");
    const res = await POST(
      overlayPost({
        entityType: "DRUG",
        entityCode: "bisoprolol",
        overrides: {
          nameRu: "Бисопролол",
          nameUz: null,
          // the form only had adult (and elderly now): unchanged
          defaultDosing: BISOPROLOL_DOSING,
          contraindications: ["AV-блокада II–III степени"],
          sideEffects: ["Брадикардия"],
          rxOnly: true,
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(h.creates).toEqual([]);
  });

  it("a name change creates a visible overlay carrying only the name", async () => {
    const { POST } = await import("@/app/api/crm/clinic-catalog-overlays/route");
    await POST(
      overlayPost({
        entityType: "DRUG",
        entityCode: "bisoprolol",
        overrides: {
          nameRu: "Бисопролол (Конкор)",
          defaultDosing: { adult: BISOPROLOL_DOSING.adult }, // elderly missing from an old form
          rxOnly: true,
        },
      }),
    );
    expect(h.creates).toHaveLength(1);
    expect(h.creates[0]).toMatchObject({
      hideGlobal: false,
      overridesJson: { nameRu: "Бисопролол (Конкор)" },
    });
  });

  it("editing the text keeps the clinic's packaging photo", async () => {
    const { POST } = await import("@/app/api/crm/clinic-catalog-overlays/route");
    h.overlay = { id: "ov1", hideGlobal: false, overridesJson: { photoUrl: "/api/photo-1" } };
    await POST(
      overlayPost({ entityType: "DRUG", entityCode: "bisoprolol", overrides: { nameRu: "Конкор" } }),
    );
    expect(h.updates[0]).toMatchObject({
      overridesJson: { nameRu: "Конкор", photoUrl: "/api/photo-1" },
    });
  });

  it("a bare hide call still hides (G6 behaviour unchanged)", async () => {
    const { POST } = await import("@/app/api/crm/clinic-catalog-overlays/route");
    await POST(overlayPost({ entityType: "DRUG", entityCode: "bisoprolol", hideGlobal: true }));
    expect(h.creates[0]).toMatchObject({ hideGlobal: true });
  });
});

// ─── CT-12 ──────────────────────────────────────────────────────────────────

describe("CT-12: boolean query flags read «false» as false", () => {
  it("rxOnly=false is the OTC filter", () => {
    expect(QueryDrugSchema.parse({ rxOnly: "false" }).rxOnly).toBe(false);
    expect(QueryDrugSchema.parse({ rxOnly: "true" }).rxOnly).toBe(true);
    expect(QueryDrugSchema.parse({}).rxOnly).toBeUndefined();
  });

  it("active / withDosing / noPhoto and the other list schemas follow the same rule", () => {
    const d = QueryDrugSchema.parse({ active: "false", withDosing: "false", noPhoto: "0" });
    expect(d).toMatchObject({ active: false, withDosing: false, noPhoto: false });
    expect(QueryLabCatalogSchema.parse({ active: "false" }).active).toBe(false);
    expect(QueryServiceSchema.parse({ isActive: "false" }).isActive).toBe(false);
    expect(QueryConversationSchema.parse({ unread: "false" }).unread).toBe(false);
  });

  it("an empty value is absent and junk is refused instead of read as true", () => {
    const S = z.object({ flag: queryBool() });
    expect(S.parse({ flag: "" }).flag).toBeUndefined();
    expect(S.parse({ flag: true }).flag).toBe(true);
    expect(S.safeParse({ flag: "maybe" }).success).toBe(false);
  });
});

// ─── CT-13 ──────────────────────────────────────────────────────────────────

function photoPost() {
  const form = new FormData();
  // A real PNG signature: the route types the upload by its bytes.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  form.set("photo", new File([png], "box.png", { type: "image/png" }));
  return new Request("https://x/api/crm/catalogs/drugs/bisoprolol/photo", {
    method: "POST",
    body: form,
  });
}

describe("CT-13: the first photo of a global drug saves and hides nothing", () => {
  it("upserts the overlay with its author and hideGlobal false", async () => {
    const { POST } = await import("@/app/api/crm/catalogs/drugs/[id]/photo/route");
    const res = await POST(photoPost());
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]!.create).toMatchObject({
      clinicId: "c1",
      entityType: "DRUG",
      entityCode: "bisoprolol",
      hideGlobal: false,
      createdById: "u_doc",
    });
    expect((h.upserts[0]!.create.overridesJson as { photoUrl: string }).photoUrl).toMatch(
      /drugs%2Fc1%2Fbisoprolol%2F/,
    );
  });

  it("a failed database write removes the stored file", async () => {
    const { POST } = await import("@/app/api/crm/catalogs/drugs/[id]/photo/route");
    h.upsertError = new Error("db down");
    await expect(POST(photoPost())).rejects.toThrow("db down");
    expect(h.deleted).toHaveLength(1);
    expect(h.deleted[0]).toMatch(/^drugs\/c1\/bisoprolol\//);
  });

  it("removing a photo the clinic never had writes nothing", async () => {
    const { DELETE } = await import("@/app/api/crm/catalogs/drugs/[id]/photo/route");
    const res = await DELETE(
      new Request("https://x/api/crm/catalogs/drugs/bisoprolol/photo", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(h.upserts).toEqual([]);
  });
});

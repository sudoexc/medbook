/**
 * Audit MA-07: Telegram initData is a patient's whole account for 24 hours,
 * and every `/api/miniapp/*` endpoint used to accept it from `?initData=`,
 * including the ones that cancel visits, add relatives or delete the
 * account. The Mini App put it into the event-stream URL, document and
 * conclusion links and the calendar link, so it sat in nginx's access log
 * and in links patients forwarded from the external browser.
 *
 * Pinned here:
 *   - initData is read from the header only: a POST / DELETE carrying it
 *     only in the query is a 401;
 *   - the surfaces a browser opens without headers take a signed link that
 *     opens one resource of one patient for minutes, and nothing else;
 *   - the lists hand out such links, never initData; no Mini App client
 *     code puts initData into a URL, and nginx logs those queries redacted.
 */
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_SECRET = "test-app-secret";
});

const h = vi.hoisted(() => ({
  documents: [] as Array<{ id: string; patientId: string; fileUrl: string }>,
  fetchedKeys: [] as string[],
  handlerRuns: 0,
}));

const CLINIC = { id: "c1", slug: "neurofax", tgBotToken: "555:demoToken", active: true };
const PATIENT = {
  id: "p1",
  clinicId: "c1",
  fullName: "Каримова Дилноза",
  phone: "+998901234567",
  preferredLang: "RU" as const,
  telegramId: "111",
  telegramUsername: null,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) =>
        where.slug === CLINIC.slug || where.id === CLINIC.id ? CLINIC : null,
      ),
    },
    patient: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        (where.telegramId === undefined || where.telegramId === PATIENT.telegramId) &&
        (where.id === undefined || where.id === PATIENT.id)
          ? PATIENT
          : null,
      ),
    },
    document: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; patientId: string } }) =>
        h.documents.find((d) => d.id === where.id && d.patientId === where.patientId)
          ? {
              id: where.id,
              fileUrl: `https://neurofax.uz/files/medbook/clinics/c1/documents/${where.id}.pdf`,
              mimeType: "application/pdf",
              title: "Заключение",
            }
          : null,
      ),
      findMany: vi.fn(async () =>
        h.documents.map((d) => ({
          id: d.id,
          type: "CONCLUSION",
          title: "Заключение",
          fileUrl: d.fileUrl,
          mimeType: "application/pdf",
          sizeBytes: 10,
          createdAt: new Date("2026-09-20T10:00:00Z"),
        })),
      ),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/storage/minio", () => ({
  fetchObject: vi.fn(async (_b: unknown, key: string) => {
    h.fetchedKeys.push(key);
    return { body: new Blob(["%PDF"]).stream(), contentType: "application/pdf", contentLength: 4 };
  }),
  uploadObject: vi.fn(),
}));
vi.mock("@/server/realtime/event-bus", () => ({
  getEventBus: () => ({ subscribe: () => () => {} }),
}));
vi.mock("@/server/realtime/redis-adapter", () => ({
  isRedisEnabled: () => false,
  ensureRedisSubscriber: () => {},
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  getFamilyAllowedPatientIds: vi.fn(async () => ["p1"]),
  resolveActivePatient: vi.fn(async () => ({ ok: true, patientId: "p1", preferredLang: "RU" })),
}));

import { NextRequest } from "next/server";

import {
  createMiniAppHandler,
  resolveMiniAppContext,
} from "@/server/miniapp/handler";
import {
  MINIAPP_LINK_TTL_MS,
  mintMiniAppLink,
  verifyMiniAppLink,
} from "@/server/miniapp/link-token";
import { GET as fileGET } from "@/app/api/miniapp/documents/[id]/file/route";
import { GET as documentsGET } from "@/app/api/miniapp/documents/route";
import { GET as eventsGET } from "@/app/api/miniapp/events/route";

function signInitData(user: Record<string, unknown>): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
  };
  const entries = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(CLINIC.tgBotToken).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  const params = new URLSearchParams(entries);
  params.append("hash", hash);
  return params.toString();
}

const INIT = signInitData({ id: 111, first_name: "Dilnoza" });

beforeEach(() => {
  h.documents = [{ id: "d1", patientId: "p1", fileUrl: "stored" }];
  h.fetchedKeys = [];
  h.handlerRuns = 0;
});

describe("initData comes from the header only", () => {
  it("a valid initData in the query is ignored: 401", async () => {
    const res = await resolveMiniAppContext(
      new Request(
        `https://neurofax.uz/api/miniapp/anything?clinicSlug=neurofax&initData=${encodeURIComponent(INIT)}`,
      ),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("the same initData in the header is accepted", async () => {
    const res = await resolveMiniAppContext(
      new Request("https://neurofax.uz/api/miniapp/anything?clinicSlug=neurofax", {
        headers: { "x-telegram-init-data": INIT },
      }),
    );
    expect(res.ok).toBe(true);
  });

  for (const method of ["POST", "DELETE"]) {
    it(`${method} with initData only in the query is a 401 and never runs the handler`, async () => {
      const handler = createMiniAppHandler({}, async () => {
        h.handlerRuns++;
        return Response.json({ ok: true });
      });
      const res = await handler(
        new Request(
          `https://neurofax.uz/api/miniapp/account?clinicSlug=neurofax&initData=${encodeURIComponent(INIT)}`,
          { method },
        ),
      );
      expect(res.status).toBe(401);
      expect(h.handlerRuns).toBe(0);
    });
  }
});

describe("signed Mini App links", () => {
  const claims = { scope: "doc" as const, clinicId: "c1", patientId: "p1", resourceId: "d1" };

  it("open exactly one resource of one kind, until they expire", () => {
    const now = Date.now();
    const link = mintMiniAppLink(claims, now);
    expect(verifyMiniAppLink(link, { scope: "doc", resourceId: "d1" }, now)).toMatchObject(claims);
    expect(verifyMiniAppLink(link, { scope: "doc", resourceId: "d2" }, now)).toBeNull();
    expect(verifyMiniAppLink(link, { scope: "events" }, now)).toBeNull();
    expect(verifyMiniAppLink(link, { scope: "ics", resourceId: "d1" }, now)).toBeNull();
    expect(
      verifyMiniAppLink(link, { scope: "doc", resourceId: "d1" }, now + MINIAPP_LINK_TTL_MS.doc + 1),
    ).toBeNull();
  });

  it("cannot be edited to name another patient", () => {
    const link = mintMiniAppLink(claims);
    const [body, sig] = link.split(".");
    const wire = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    wire.p = "p_other";
    const forged = `${Buffer.from(JSON.stringify(wire)).toString("base64url")}.${sig}`;
    expect(verifyMiniAppLink(forged, { scope: "doc", resourceId: "d1" })).toBeNull();
    expect(verifyMiniAppLink(INIT, { scope: "doc", resourceId: "d1" })).toBeNull();
  });
});

describe("the document file behind a link", () => {
  function open(id: string, query: string) {
    return fileGET(
      new Request(`https://neurofax.uz/api/miniapp/documents/${id}/file?clinicSlug=neurofax${query}`),
      { params: Promise.resolve({ id }) },
    );
  }

  it("streams with its own link", async () => {
    const t = mintMiniAppLink({ scope: "doc", clinicId: "c1", patientId: "p1", resourceId: "d1" });
    const res = await open("d1", `&t=${encodeURIComponent(t)}`);
    expect(res.status).toBe(200);
    expect(h.fetchedKeys).toEqual(["clinics/c1/documents/d1.pdf"]);
  });

  it("another document's link opens nothing, and says so in a page, not JSON", async () => {
    h.documents.push({ id: "d2", patientId: "p1", fileUrl: "stored" });
    const t = mintMiniAppLink({ scope: "doc", clinicId: "c1", patientId: "p1", resourceId: "d1" });
    const res = await open("d2", `&t=${encodeURIComponent(t)}`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Ссылка устарела");
    expect(h.fetchedKeys).toHaveLength(0);
  });

  it("the old `?initData=` link no longer opens it", async () => {
    const res = await open("d1", `&initData=${encodeURIComponent(INIT)}`);
    expect(res.status).toBe(401);
    expect(h.fetchedKeys).toHaveLength(0);
  });

  it("the documents list hands out per-document links, never initData", async () => {
    const res = await documentsGET(
      new Request("https://neurofax.uz/api/miniapp/documents?clinicSlug=neurofax", {
        headers: { "x-telegram-init-data": INIT },
      }),
    );
    const body = (await res.json()) as { documents: Array<{ fileUrl: string }> };
    const url = new URL(body.documents[0]!.fileUrl, "https://neurofax.uz");
    expect(url.pathname).toBe("/api/miniapp/documents/d1/file");
    expect(url.searchParams.has("initData")).toBe(false);
    expect(
      verifyMiniAppLink(url.searchParams.get("t"), { scope: "doc", resourceId: "d1" }),
    ).toMatchObject({ clinicId: "c1", patientId: "p1" });
  });
});

describe("the event stream", () => {
  it("refuses initData in the query and opens with a stream link", async () => {
    let res = await eventsGET(
      new NextRequest(
        `https://neurofax.uz/api/miniapp/events?clinicSlug=neurofax&initData=${encodeURIComponent(INIT)}`,
      ),
    );
    expect(res.status).toBe(401);

    const ac = new AbortController();
    const t = mintMiniAppLink({ scope: "events", clinicId: "c1", patientId: "p1", resourceId: "p1" });
    res = await eventsGET(
      new NextRequest(
        `https://neurofax.uz/api/miniapp/events?clinicSlug=neurofax&t=${encodeURIComponent(t)}`,
        { signal: ac.signal },
      ),
    );
    expect(res.status).toBe(200);
    ac.abort();

    // A document link is not a stream link.
    const doc = mintMiniAppLink({ scope: "doc", clinicId: "c1", patientId: "p1", resourceId: "p1" });
    res = await eventsGET(
      new NextRequest(
        `https://neurofax.uz/api/miniapp/events?clinicSlug=neurofax&t=${encodeURIComponent(doc)}`,
      ),
    );
    expect(res.status).toBe(401);
  });
});

describe("nothing puts initData into a URL any more", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? files(p) : /\.(tsx?|js)$/.test(p) ? [p] : [];
    });
  }

  it("no Mini App client or server code builds `initData=` into a query", () => {
    const roots = ["src/app/c", "src/app/api/miniapp", "src/server/miniapp"].map((r) =>
      path.join(process.cwd(), r),
    );
    const offenders = roots
      .flatMap(files)
      .filter((f) => /[?&]initData=|set\("initData"|searchParams\.get\("initData"\)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("nginx logs Mini App paths without their query", () => {
    const conf = readFileSync(path.join(process.cwd(), "nginx/nginx.conf"), "utf8");
    expect(conf).toMatch(/map \$request_uri \$loggable_request_uri/);
    expect(conf).toContain('"~^(/api/miniapp/[^?]*)\\?"');
    expect(conf).toContain("$loggable_request_uri $server_protocol");
    expect(conf).not.toMatch(/log_format[^;]*"\$request"/);
  });
});

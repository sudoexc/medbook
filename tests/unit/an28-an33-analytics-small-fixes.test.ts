/**
 * Audit AN-28, AN-29, AN-31, AN-32, AN-33 (low-severity analytics fixes).
 * AN-30 (wait time from arrival to call) is pinned next to its helper in
 * tests/unit/analytics/funnels.test.ts.
 *
 *   - AN-28: the overview CSV writes money in сум and starts with a BOM.
 *   - AN-29: an invoice PDF names the plan stored on the invoice.
 *   - AN-31: every status and patient source has a ru/uz name for the charts.
 *   - AN-32: reading a Telegram chat refreshes the sidebar badge's real key.
 *   - AN-33: «Аналитика» is offered only to the roles its API answers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalyticsSummaryCsv } from "@/lib/analytics/summary-csv";
import { AppointmentStatus, LeadSource } from "@/generated/prisma/enums";
import { ENTERPRISE_FLAGS } from "@/lib/feature-flags";
import { getVisibleCrmNav } from "@/components/layout/crm-sidebar";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const h = vi.hoisted(() => ({
  invoice: null as null | Record<string, unknown>,
  sub: null as null | Record<string, unknown>,
  plans: new Map<string, { slug: string; nameRu: string; nameUz: string }>(),
  pdfInput: null as null | { plan: { slug: string } },
  qc: { invalidateQueries: vi.fn(async () => undefined) },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_admin", role: "ADMIN", clinicId: "c1" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findFirst: vi.fn(async () => h.invoice) },
    clinic: {
      findUnique: vi.fn(async () => ({ nameRu: "Клиника", nameUz: "Klinika" })),
    },
    subscription: { findUnique: vi.fn(async () => h.sub) },
    plan: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => h.plans.get(where.id) ?? null,
      ),
    },
  },
}));
vi.mock("@/server/billing/pdf", () => ({
  formatInvoicePdf: vi.fn(async (input: { plan: { slug: string } }) => {
    h.pdfInput = input;
    return Buffer.from("%PDF");
  }),
  invoicePdfFilename: (n: string) => `${n}.pdf`,
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: unknown) => opts,
  useQueryClient: () => h.qc,
  useQuery: vi.fn(),
}));
vi.mock("@/app/[locale]/crm/telegram/_hooks/use-conversations", () => ({
  invalidateConversationCaches: vi.fn(),
  patchConversationCaches: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  // The hook is called outside a render here; a ref is all it needs.
  useRef: <T,>(v: T) => ({ current: v }),
}));

describe("AN-28: overview CSV", () => {
  const base = {
    period: "week",
    rangeStart: "22 сент. 2026 г.",
    rangeEnd: "28 сент. 2026 г.",
    generatedAt: new Date("2026-09-28T10:00:00.000Z"),
    paymentsTracked: true,
    // 12 500 000 сум over two days, in тийин.
    revenueDaily: [{ amount: 500_000_000 }, { amount: 750_000_000 }],
    appointmentsByStatus: [
      { status: "COMPLETED", count: 8 },
      { status: "NO_SHOW", count: 2 },
    ],
    noShowDaily: [{ total: 10, noShow: 2 }],
    topDoctors: [{ name: "Султанов Азиз", revenue: 900_000_000 }],
    topServices: [{ name: "Консультация, первичная", count: 5 }],
    sources: [{ source: "WEBSITE", count: 3 }],
  };

  it("writes money in сум, not тийин", () => {
    const csv = buildAnalyticsSummaryCsv(base);
    expect(csv).toContain("kpi,revenue_total,12500000\r\n");
    expect(csv).toContain("topDoctors,Султанов Азиз,9000000\r\n");
    expect(csv).toContain("meta,currency,UZS\r\n");
    expect(csv).not.toContain("1250000000");
  });

  it("starts with a UTF-8 BOM so Excel reads Cyrillic", () => {
    const csv = buildAnalyticsSummaryCsv(base);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith("section,key,value\r\n")).toBe(true);
    const bytes = new TextEncoder().encode(csv);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("quotes cells with commas and keeps the counts", () => {
    const csv = buildAnalyticsSummaryCsv(base);
    expect(csv).toContain('topServices,"Консультация, первичная",5\r\n');
    expect(csv).toContain("kpi,appointments_total,10\r\n");
    expect(csv).toContain("kpi,no_show_pct,20\r\n");
  });

  it("leaves money empty when the clinic does not record payments", () => {
    const csv = buildAnalyticsSummaryCsv({ ...base, paymentsTracked: false });
    expect(csv).toContain("kpi,revenue_total,\r\n");
    expect(csv).not.toContain("topDoctors");
    expect(csv).not.toContain("meta,currency");
  });

  it("the page builds its file through the helper", () => {
    const page = read(
      "src/app/[locale]/crm/analytics/_components/analytics-page-client.tsx",
    );
    expect(page).toContain("buildAnalyticsSummaryCsv(");
    expect(page).not.toContain("String(totalRevenue)");
  });
});

describe("AN-29: invoice PDF plan", () => {
  const PLANS = {
    basic: { slug: "basic", nameRu: "Базовый", nameUz: "Asosiy" },
    pro: { slug: "pro", nameRu: "Про", nameUz: "Pro" },
    enterprise: { slug: "enterprise", nameRu: "Энтерпрайз", nameUz: "Enterprise" },
  };

  beforeEach(() => {
    h.pdfInput = null;
    h.plans = new Map([
      ["plan_basic", PLANS.basic],
      ["plan_pro", PLANS.pro],
      ["plan_ent", PLANS.enterprise],
    ]);
    // Paid for Pro, then asked for Enterprise: Pro is current, Enterprise queued.
    h.sub = { clinicId: "c1", pendingPlanId: "plan_ent", plan: PLANS.pro };
    h.invoice = {
      id: "inv1",
      number: "INV-2026-0001",
      status: "PAID",
      amountTiins: BigInt(150_000_000),
      currency: "UZS",
      periodStart: new Date("2026-09-01T00:00:00Z"),
      periodEnd: new Date("2026-10-01T00:00:00Z"),
      dueAt: new Date("2026-09-08T00:00:00Z"),
      paidAt: new Date("2026-09-02T00:00:00Z"),
      paymentRef: "ref",
      targetPlanId: "plan_pro",
    };
  });

  async function getPdf(): Promise<Response> {
    const { GET } = await import("@/app/api/crm/billing/invoices/[id]/pdf/route");
    return GET(new Request("http://x/api/crm/billing/invoices/inv1/pdf"));
  }

  it("names the invoice's own plan, not the upgrade queued after it", async () => {
    const res = await getPdf();
    expect(res.status).toBe(200);
    expect(h.pdfInput?.plan.slug).toBe("pro");
  });

  it("an older Basic invoice still reads Basic after the move to Pro", async () => {
    h.invoice = { ...h.invoice, targetPlanId: "plan_basic" };
    h.sub = { clinicId: "c1", pendingPlanId: null, plan: PLANS.pro };
    await getPdf();
    expect(h.pdfInput?.plan.slug).toBe("basic");
  });

  it("an invoice without a target names the current plan", async () => {
    h.invoice = { ...h.invoice, targetPlanId: null };
    await getPdf();
    expect(h.pdfInput?.plan.slug).toBe("pro");
  });
});

describe("AN-31: status and source names for the charts", () => {
  const messages = {
    ru: JSON.parse(read("src/messages/ru.json")),
    uz: JSON.parse(read("src/messages/uz.json")),
  };

  it.each(["ru", "uz"] as const)("%s names every status and source", (lang) => {
    const m = messages[lang];
    for (const s of Object.values(AppointmentStatus)) {
      expect(m.analyticsReports.status[s], `${lang} status ${s}`).toBeTruthy();
    }
    for (const s of Object.values(LeadSource)) {
      expect(m.onlineRequests.source[s], `${lang} source ${s}`).toBeTruthy();
    }
  });

  it("the charts print those names instead of the codes", () => {
    const charts = read(
      "src/app/[locale]/crm/analytics/_components/analytics-charts.tsx",
    );
    expect(charts).not.toContain("slice(0, 4).toLowerCase()");
    // The legend text; `key={s.source}` stays as the React key.
    expect(charts).not.toMatch(/>\s*\{s\.source\}\s*</);
    expect(charts).toContain("statusLabel(s.status)");
    expect(charts).toContain("sourceLabel(s.source)");
  });
});

describe("AN-32: mark-read refreshes the sidebar badge", () => {
  it("invalidates the key useShellSummary reads", async () => {
    const { shellSummaryKey } = await import("@/hooks/use-shell-summary");
    const { useMarkConversationRead } = await import(
      "@/app/[locale]/crm/telegram/_hooks/use-mark-read"
    );
    const opts = useMarkConversationRead() as unknown as {
      onMutate: (id: string) => Promise<void>;
      onSettled: (d: unknown, e: unknown, id: string) => void;
    };
    await opts.onMutate("conv1");
    opts.onSettled(undefined, null, "conv1");
    const keys = h.qc.invalidateQueries.mock.calls.map(
      (c) => (c as unknown as [{ queryKey: unknown }])[0].queryKey,
    );
    expect(keys).toContainEqual(shellSummaryKey);
    expect(keys).not.toContainEqual(["shell-summary"]);
  });
});

describe("AN-33: «Аналитика» only for the roles its API answers", () => {
  const hasAnalytics = (role: "ADMIN" | null) =>
    getVisibleCrmNav(ENTERPRISE_FLAGS, role).some((g) =>
      g.items.some((i) => i.href === "analytics"),
    );

  it("admins keep the item, everyone else loses it", () => {
    expect(hasAnalytics("ADMIN")).toBe(true);
    expect(hasAnalytics(null)).toBe(false);
  });

  it("the page answers 404 to roles the API refuses", () => {
    const page = read("src/app/[locale]/crm/analytics/page.tsx");
    expect(page).toContain('if (!isAdmin && role !== "DOCTOR") notFound();');
  });

  it("the sidebar gauge sends non-admins to today's appointments", () => {
    const sidebar = read("src/components/layout/crm-sidebar.tsx");
    expect(sidebar).toContain("`/${locale}/crm/appointments?dateMode=today`");
  });
});

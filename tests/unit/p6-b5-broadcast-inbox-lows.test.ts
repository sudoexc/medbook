/**
 * P6 B5: the low-severity broadcast, inbox and notification-centre findings.
 *
 *   G6-19  a send a worker already took (SENDING) is still pending: the
 *          dialog does not say «завершена» early, it keeps polling, and the
 *          history keeps «Отправляется».
 *   G6-20  the one-patient scope of a card link shows as a chip and a tab or
 *          a search lifts it.
 *   G6-21  the broadcast preview is the launcher's render through the
 *          sender's HTML pass, with the real clinic; an unknown {{…}} is
 *          refused.
 *   G6-22  empty threads go last, paging follows that order, «Все» is the
 *          server's count, partial temperature counts say so.
 *   G6-23  one marketing switch in the Mini App, and the CRM card shows the
 *          flag the broadcasts obey.
 *   G6-25  notification texts read as the patient reads them; campaign
 *          statuses, channels and audiences are in words.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isBroadcastFinished,
  pendingSendCount,
  type BroadcastProgress,
} from "@/app/[locale]/crm/telegram/_hooks/use-broadcast";
import { partialTemperatures } from "@/app/[locale]/crm/telegram/_lib/inbox-temperature";
import type { InboxConversation } from "@/app/[locale]/crm/telegram/_hooks/types";
import {
  BROADCAST_PLACEHOLDERS,
  broadcastContext,
  renderBroadcastBody,
  unknownBroadcastPlaceholders,
} from "@/server/campaigns/broadcast-body";
import {
  CONVERSATION_LIST_ORDER,
  afterConversationCursor,
} from "@/server/conversations/list-order";
import { telegramHtmlToText as mirrorDecoder } from "@/server/conversations/notification-mirror";
import { BroadcastSchema } from "@/server/schemas/campaign";
import { render } from "@/server/notifications/template";
import {
  notificationBodyText,
  telegramHtmlToText,
  toTelegramHtml,
} from "@/server/notifications/telegram-html";

const h = vi.hoisted(() => ({
  campaigns: [] as Array<Record<string, unknown>>,
  byStatus: [] as Array<{ campaignId: string; status: string; _count: { _all: number } }>,
  blocked: [] as Array<{ campaignId: string; _count: { _all: number } }>,
  convRows: [] as Array<Record<string, unknown>>,
  convFindMany: [] as Array<Record<string, unknown>>,
  convCount: [] as Array<Record<string, unknown>>,
  cursorRow: null as null | { id: string; lastMessageAt: Date | null },
  total: 0,
  inbox: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const handler =
    (
      _opts: unknown,
      fn: (a: { request: Request; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) =>
      fn({
        request,
        ctx: { kind: "TENANT", clinicId: "clinic_A", userId: "u_desk", role: "RECEPTIONIST" },
      });
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/server/miniapp/handler", () => ({
  createMiniAppListHandler:
    (_opts: unknown, fn: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      fn({ request, ctx: { patientId: "p_1", clinicId: "clinic_A" } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findMany: vi.fn(async () => h.campaigns) },
    notificationSend: {
      groupBy: vi.fn(async (args: { where: { status?: string } }) =>
        args.where.status === "FAILED" ? h.blocked : h.byStatus,
      ),
      findMany: vi.fn(async () => h.inbox),
    },
    conversation: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        h.convFindMany.push(args);
        return h.convRows.map((r) => ({ ...r }));
      }),
      count: vi.fn(async (args: Record<string, unknown>) => {
        h.convCount.push(args);
        return h.total;
      }),
      findFirst: vi.fn(async () => h.cursorRow),
    },
    doctor: { findFirst: vi.fn(async () => null) },
  },
}));

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const ru = JSON.parse(read("src/messages/ru.json"));
const uz = JSON.parse(read("src/messages/uz.json"));

beforeEach(() => {
  h.campaigns = [];
  h.byStatus = [];
  h.blocked = [];
  h.convRows = [];
  h.convFindMany = [];
  h.convCount = [];
  h.cursorRow = null;
  h.total = 0;
  h.inbox = [];
});

function progress(
  status: string,
  sendsByStatus: BroadcastProgress["sendsByStatus"],
): BroadcastProgress {
  return {
    campaign: { id: "c1", name: "x", status, totalCount: 500, scheduledFor: null },
    sendsByStatus,
  };
}

describe("G6-19: SENDING is still on its way", () => {
  it("counts QUEUED and SENDING as pending", () => {
    expect(pendingSendCount({ QUEUED: 3, SENDING: 7, SENT: 490 })).toBe(10);
    expect(pendingSendCount({ SENT: 5 })).toBe(0);
  });

  it("is not finished while the last sends are in flight", () => {
    expect(isBroadcastFinished(progress("SENDING", { SENDING: 10, SENT: 490 }))).toBe(false);
    expect(isBroadcastFinished(progress("SENDING", { SENT: 495, FAILED: 5 }))).toBe(true);
    // The server closed it, whatever the histogram says.
    expect(isBroadcastFinished(progress("DONE", {}))).toBe(true);
    expect(isBroadcastFinished(progress("CANCELLED", {}))).toBe(true);
    // Nothing counted yet: keep polling.
    expect(isBroadcastFinished(progress("SENDING", {}))).toBe(false);
  });

  it("the dialog and the poller read the same pair", () => {
    const dialog = read("src/app/[locale]/crm/telegram/_components/broadcast-dialog.tsx");
    expect(dialog).toContain("pendingSendCount(sbs)");
    expect(dialog).toContain("isBroadcastFinished(progress.data)");
    expect(dialog).not.toMatch(/const pending = sbs\.QUEUED/);
    const hook = read("src/app/[locale]/crm/telegram/_hooks/use-broadcast.ts");
    expect(hook).toContain("isBroadcastFinished(data) ? false : 2000");
  });

  it("the history keeps a broadcast with SENDING rows «sending»", async () => {
    h.campaigns = [
      {
        id: "c1",
        name: "Акция",
        body: "x",
        segment: { kind: "all" },
        status: "SENDING",
        scheduledFor: null,
        startedAt: new Date("2026-10-01T08:00:00Z"),
        createdAt: new Date("2026-10-01T08:00:00Z"),
        createdBy: null,
      },
    ];
    h.byStatus = [
      { campaignId: "c1", status: "SENT", _count: { _all: 490 } },
      { campaignId: "c1", status: "SENDING", _count: { _all: 10 } },
    ];
    const { GET } = await import("@/app/api/crm/campaigns/broadcasts/route");
    const res = await GET(new Request("https://crm.test/api/crm/campaigns/broadcasts"));
    const body = (await res.json()) as {
      items: Array<{ status: string; funnel: { queued: number; total: number } }>;
    };
    expect(body.items[0]).toMatchObject({
      status: "sending",
      funnel: { queued: 10, total: 500 },
    });

    h.byStatus = [{ campaignId: "c1", status: "SENT", _count: { _all: 500 } }];
    const done = await (await GET(new Request("https://crm.test/api/crm/campaigns/broadcasts"))).json();
    expect(done.items[0].status).toBe("done");
  });
});

describe("G6-20: the one-patient scope is visible and goes away", () => {
  const list = read("src/app/[locale]/crm/telegram/_components/conversation-list.tsx");

  it("shows a chip that clears the scope", () => {
    expect(list).toContain("filters.patientId ? (");
    expect(list).toContain("onClick={() => setFilters({ patientId: null })}");
    expect(list).toContain('t("list.patientScope", { name: patientScopeName })');
  });

  it("a tab or a search lifts it", () => {
    expect(list).toContain('setFilters({ unanswered: true, mode: "all", patientId: null })');
    expect(list).toContain('setFilters({ mode: "takeover", unanswered: false, patientId: null })');
    expect(list).toContain('setFilters({ mode: "all", unanswered: false, patientId: null })');
    expect(list).toContain("setFilters({ q: search, patientId: null })");
  });

  it("has its words in both languages", () => {
    for (const m of [ru, uz]) {
      expect(m.tgInbox.list.patientScope).toContain("{name}");
      expect(m.tgInbox.list.patientScopeUnnamed).toBeTruthy();
      expect(m.tgInbox.list.patientScopeClear).toBeTruthy();
      expect(m.tgInbox.list.tempLoadedHint).toBeTruthy();
    }
  });
});

const CLINIC = {
  nameRu: "Нейрофакс",
  nameUz: "Neyrofaks",
  phone: "+998 71 200-00-00",
  addressRu: "ул. Мирабад, 5",
  addressUz: "Mirobod ko'chasi, 5",
};

describe("G6-21: the preview is what the patient gets", () => {
  it("keeps **x** as typed and <b> as formatting, with the real clinic", () => {
    const body = "**Акция** <b>до пятницы</b>, {{patient.firstName}}! Звоните {{clinic.phone}}";
    const stored = renderBroadcastBody(body, { fullName: "Каримов Алишер" }, CLINIC, "RU");
    const sent = toTelegramHtml(stored);
    expect(sent).toBe("**Акция** <b>до пятницы</b>, Алишер! Звоните +998 71 200-00-00");
  });

  it("fills the clinic in the patient's language and escapes a name", () => {
    const ctx = broadcastContext({ fullName: "Abdullayev G'ulom" }, CLINIC, "UZ");
    expect(ctx).toMatchObject({
      patient: { firstName: "G'ulom" },
      clinic: { name: "Neyrofaks", address: "Mirobod ko'chasi, 5" },
    });
    expect(
      renderBroadcastBody("{{patient.firstName}}", { fullName: "Abdullayev G'ulom" }, CLINIC, "UZ"),
    ).toBe("G&#39;ulom");
  });

  it("finds the tokens nothing fills, and the endpoint refuses them", () => {
    expect(unknownBroadcastPlaceholders("до {{appointment.date}}, {{clinic.phone}}")).toEqual([
      "appointment.date",
    ]);
    expect(unknownBroadcastPlaceholders(BROADCAST_PLACEHOLDERS.map((k) => `{{${k}}}`).join(" "))).toEqual([]);
    const base = { channel: "TG", segment: { kind: "all" } };
    expect(BroadcastSchema.safeParse({ ...base, body: "до {{appointment.date}}" }).success).toBe(false);
    expect(BroadcastSchema.safeParse({ ...base, body: "Звоните {{clinic.phone}}" }).success).toBe(true);
  });

  it("the launcher and the preview share the render", () => {
    expect(read("src/server/campaigns/launch.ts")).toContain("renderBroadcastBody(");
    const preview = read("src/app/[locale]/crm/telegram/_components/broadcast-preview.tsx");
    expect(preview).toContain("toTelegramHtml(");
    expect(preview).toContain("renderBroadcastBody(");
    expect(preview).toContain("useClinicInfo(true)");
    expect(preview).not.toContain("fillPlaceholders");
    expect(preview).not.toContain('t("preview.clinicAddress")');
    const dialog = read("src/app/[locale]/crm/telegram/_components/broadcast-dialog.tsx");
    expect(dialog).toContain("unknownKeys.length === 0 &&");
    for (const m of [ru, uz]) {
      expect(m.tgInbox.broadcast.message.unknownPlaceholder).toContain("{key}");
      expect(m.tgInbox.broadcast.message.unknownPlaceholder).not.toMatch(/[—–]/);
    }
  });
});

function row(id: string, lastMessageAt: string | null, extra: Partial<InboxConversation> = {}) {
  return { id, lastMessageAt, awaitingReplySince: null, ...extra } as InboxConversation;
}

describe("G6-22: empty threads last, paging in that order, real counts", () => {
  it("orders by last message with NULL last, then id", () => {
    expect(CONVERSATION_LIST_ORDER).toEqual([
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
  });

  it("builds the page after a cursor, a NULL one included", () => {
    const at = new Date("2026-10-01T10:00:00Z");
    expect(afterConversationCursor({ id: "c5", lastMessageAt: at })).toEqual({
      OR: [
        { lastMessageAt: { lt: at } },
        { lastMessageAt: at, id: { lt: "c5" } },
        { lastMessageAt: null },
      ],
    });
    expect(afterConversationCursor({ id: "c9", lastMessageAt: null })).toEqual({
      lastMessageAt: null,
      id: { lt: "c9" },
    });
  });

  it("the first page carries the count; the next cursor is the last row shown", async () => {
    h.total = 412;
    h.convRows = [row("c3", "2026-10-01T10:00:00Z"), row("c2", "2026-10-01T09:00:00Z"), row("c1", null)];
    const { GET } = await import("@/app/api/crm/conversations/route");
    const res = await GET(new Request("https://crm.test/api/crm/conversations?channel=TG&limit=2"));
    const body = (await res.json()) as { rows: Array<{ id: string }>; nextCursor: string; total: number };
    expect(body.rows.map((r) => r.id)).toEqual(["c3", "c2"]);
    expect(body.nextCursor).toBe("c2");
    expect(body.total).toBe(412);
    expect(h.convFindMany[0]).toMatchObject({ orderBy: [...CONVERSATION_LIST_ORDER], take: 3 });
    expect(h.convFindMany[0]).not.toHaveProperty("cursor");
    expect(h.convFindMany[0]).not.toHaveProperty("skip");
    expect(h.convCount[0]).toEqual({ where: { channel: "TG" } });
  });

  it("a later page starts after the cursor row and is not counted again", async () => {
    const at = new Date("2026-10-01T09:00:00Z");
    h.cursorRow = { id: "c2", lastMessageAt: at };
    h.convRows = [row("c1", null)];
    const { GET } = await import("@/app/api/crm/conversations/route");
    const res = await GET(
      new Request("https://crm.test/api/crm/conversations?channel=TG&limit=2&cursor=c2"),
    );
    const body = (await res.json()) as { rows: Array<{ id: string }>; nextCursor: string | null };
    expect(body).not.toHaveProperty("total");
    expect(body.nextCursor).toBeNull();
    expect(h.convFindMany[0]!.where).toEqual({
      AND: [{ channel: "TG" }, afterConversationCursor({ id: "c2", lastMessageAt: at })],
    });
    expect(h.convCount).toHaveLength(0);
  });

  it("a cursor row that is gone ends the list", async () => {
    h.cursorRow = null;
    const { GET } = await import("@/app/api/crm/conversations/route");
    const res = await GET(new Request("https://crm.test/api/crm/conversations?cursor=gone"));
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
    expect(h.convFindMany).toHaveLength(0);
  });

  it("marks only the temperature counts more pages can grow", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    const fresh = [row("a", "2026-10-02T11:30:00Z")];
    const old = [row("a", "2026-10-02T11:30:00Z"), row("b", "2026-10-02T08:00:00Z")];
    expect(partialTemperatures({ rows: old, hasNextPage: false, now })).toEqual({
      hot: false,
      warm: false,
      cold: false,
    });
    // The oldest loaded row is still inside the hot window: hot may grow.
    expect(partialTemperatures({ rows: fresh, hasNextPage: true, now })).toEqual({
      hot: true,
      warm: true,
      cold: true,
    });
    // Past the hot window: no hot thread is left further down.
    expect(partialTemperatures({ rows: old, hasNextPage: true, now }).hot).toBe(false);
    expect(partialTemperatures({ rows: [row("e", null)], hasNextPage: true, now }).hot).toBe(false);
  });

  it("«Все» shows the server's count", () => {
    const list = read("src/app/[locale]/crm/telegram/_components/conversation-list.tsx");
    expect(list).toContain("String(total ?? rows.length)");
    expect(read("src/app/[locale]/crm/telegram/_components/telegram-page-client.tsx")).toContain(
      "total={listQuery.data?.pages[0]?.total}",
    );
  });
});

describe("G6-23: one marketing switch, and the card shows it", () => {
  it("the Mini App profile no longer writes consentMarketing", () => {
    const screen = read("src/app/c/[slug]/my/_components/profile-screen.tsx");
    expect(screen).not.toContain("consentLabel");
    expect(screen).not.toContain("consentMarketing: consent");
    expect(screen).toContain("marketingOptOut: !marketingAllowed");
    expect(read("src/app/c/[slug]/my/_messages/ru.ts")).not.toContain("consentLabel");
    expect(read("src/app/c/[slug]/my/_messages/uz.ts")).not.toContain("consentLabel");
  });

  it("the CRM card reads marketingOptOut", () => {
    const panel = read("src/app/[locale]/crm/patients/[id]/_components/patient-info-panel.tsx");
    expect(panel).toContain("patient.marketingOptOut");
    expect(panel).not.toContain("patient.consentMarketing ?");
    for (const m of [ru, uz]) {
      const p = m.patientCard.infoPanel;
      expect(p.marketingBroadcasts && p.marketingReceives && p.marketingOptedOut).toBeTruthy();
    }
  });
});

describe("G6-25: texts as the patient reads them, statuses in words", () => {
  it("decodes the template engine's entities", () => {
    const stored = render("{{patient.firstName}}, напоминаем: {{x}}", {
      patient: { firstName: "G'ulom" },
      x: '"Нейрофакс" & Co',
    });
    expect(stored).toBe("G&#39;ulom, напоминаем: &quot;Нейрофакс&quot; &amp; Co");
    expect(notificationBodyText(stored)).toBe('G\'ulom, напоминаем: "Нейрофакс" & Co');
  });

  it("keeps a typed «<14» and drops real formatting", () => {
    expect(notificationBodyText("Детям <14 лет и >60 скидка")).toBe("Детям <14 лет и >60 скидка");
    expect(notificationBodyText("<b>Акция</b>\nдо пятницы")).toBe("Акция\nдо пятницы");
    expect(notificationBodyText(null)).toBe("");
  });

  it("an out-of-range entity is left as typed instead of throwing", () => {
    expect(telegramHtmlToText("a &#99999999; b")).toBe("a &#99999999; b");
    expect(mirrorDecoder).toBe(telegramHtmlToText);
  });

  it("the notification centre prints decoded text and channel names", () => {
    for (const file of [
      "src/app/[locale]/crm/notifications/_components/notifications-activity-list.tsx",
      "src/app/[locale]/crm/notifications/_components/notifications-details-rail.tsx",
    ]) {
      const src = read(file);
      expect(src).toContain("notificationBodyText(row.body)");
      expect(src).toContain("tChannel(row.channel)");
      expect(src).not.toMatch(/\{row\.body\}/);
      expect(src).not.toMatch(/\{row\.channel\}/);
    }
  });

  it("the Mini App inbox returns plain text", async () => {
    h.inbox = [
      {
        id: "s1",
        body: "G&#39;ulom, ждём вас",
        status: "SENT",
        createdAt: new Date("2026-10-01T08:00:00Z"),
        readAt: null,
        appointmentId: null,
        caseId: null,
        template: null,
      },
    ];
    const { GET } = await import("@/app/api/miniapp/inbox/route");
    const res = await GET(new Request("https://crm.test/api/miniapp/inbox?clinicSlug=x"));
    const body = (await res.json()) as { items: Array<{ body: string }> };
    expect(body.items[0]!.body).toBe("G'ulom, ждём вас");
  });

  it("campaign statuses, channels and audiences are translated", () => {
    const src = read("src/app/[locale]/crm/notifications/_components/campaigns-list.tsx");
    expect(src).toContain("t(`status.${row.status}`)");
    expect(src).toContain("tChannel(row.channel)");
    expect(src).toContain('tAudience("kind.all")');
    for (const m of [ru, uz]) {
      for (const s of ["DRAFT", "SENDING", "DONE", "FAILED", "CANCELLED"]) {
        expect(m.notifications.campaigns.status[s]).toBeTruthy();
      }
      expect(m.notifications.types.labels.TG).toBe("Telegram");
    }
  });
});

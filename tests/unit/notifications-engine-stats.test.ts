/**
 * Audit TG-06: the notifications center KPI strip.
 *
 *   - a reminder created yesterday that fails today counts in «Ошибки»
 *     (by failedAt, not createdAt);
 *   - one Telegram reminder is +1 «Отправлено», its in-app mirror is not
 *     a second one but its own «В приложении» figure;
 *   - «В очереди» is what is due and not out yet, not the next five days.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchesWhere } from "./notifications/where-matcher";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ sends: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_opts: unknown, handler: (a: { request: Request }) => Promise<Response>) =>
    (request: Request) =>
      handler({ request }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationSend: {
      count: async ({ where }: { where: Row }) =>
        db.sends.filter((r) => matchesWhere(r, where)).length,
      groupBy: async ({ by, where }: { by: string[]; where: Row }) => {
        const key = by[0]!;
        const m = new Map<unknown, number>();
        for (const r of db.sends.filter((x) => matchesWhere(x, where))) {
          m.set(r[key], (m.get(r[key]) ?? 0) + 1);
        }
        return [...m].map(([k, n]) => ({ [key]: k, _count: { _all: n } }));
      },
    },
    notificationTemplate: {
      count: async () => 3,
      findMany: async () => [],
    },
  },
}));

const NOW = new Date("2026-10-01T09:00:00.000Z"); // 14:00 Tashkent
const YESTERDAY = new Date("2026-09-30T08:00:00.000Z");

function send(over: Row): Row {
  return {
    id: Math.random().toString(36).slice(2),
    channel: "TG",
    status: "QUEUED",
    templateId: null,
    createdAt: YESTERDAY,
    scheduledFor: NOW,
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    ...over,
  };
}

async function stats() {
  const { GET } = await import("@/app/api/crm/notifications/stats/route");
  const res = await GET(new Request("https://x/api/crm/notifications/stats"));
  return (await res.json()) as {
    today: { sent: number; inApp: number; failed: number; queued: number };
    last30d: { total: number; sent: number; failed: number; inApp: number };
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.sends = [];
});

describe("GET /api/crm/notifications/stats", () => {
  it("counts today's failure of a reminder created yesterday", async () => {
    db.sends.push(
      send({
        status: "FAILED",
        createdAt: YESTERDAY,
        failedAt: new Date(NOW.getTime() - 60 * 60_000),
      }),
    );
    expect((await stats()).today.failed).toBe(1);
  });

  it("does not count a failure from yesterday", async () => {
    db.sends.push(send({ status: "FAILED", failedAt: YESTERDAY }));
    expect((await stats()).today.failed).toBe(0);
  });

  it("counts one Telegram reminder once; its in-app mirror is shown apart", async () => {
    const sentAt = new Date(NOW.getTime() - 30 * 60_000);
    db.sends.push(
      send({ channel: "TG", status: "SENT", sentAt }),
      send({ channel: "INAPP", status: "DELIVERED", sentAt, deliveredAt: sentAt }),
    );
    const s = await stats();
    expect(s.today.sent).toBe(1);
    expect(s.today.inApp).toBe(1);
    expect(s.last30d.total).toBe(1);
    expect(s.last30d.sent).toBe(1);
    expect(s.last30d.inApp).toBe(1);
  });

  it("queues only what is due now, not reminders planned for later days", async () => {
    db.sends.push(
      send({ status: "QUEUED", scheduledFor: new Date(NOW.getTime() - 60_000) }),
      send({ status: "QUEUED", scheduledFor: new Date(NOW.getTime() + 3 * 86_400_000) }),
      send({ channel: "INAPP", status: "QUEUED", scheduledFor: new Date(NOW.getTime() - 60_000) }),
    );
    expect((await stats()).today.queued).toBe(1);
  });
});

/**
 * Audit TG-08: «Повторить» / «Отправить ещё раз» for appointment reminders.
 *
 *   - retrying a FAILED reminder of an appointment that did not move ends
 *     SENT, not «Отменено» (the stale-time guard reads appointmentAt, not
 *     the moved scheduledFor);
 *   - retrying a SENT row answers 409 (it would reach the patient twice);
 *   - a reminder of a rescheduled appointment is still cancelled;
 *   - «Отправить ещё раз» carries the appointment start over and refuses a
 *     row that is being sent right now.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchesWhere } from "./notifications/where-matcher";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  sends: [] as Array<Record<string, unknown>>,
  appt: null as null | Record<string, unknown>,
  tgSent: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
}));

const START = new Date("2026-10-02T06:00:00.000Z"); // 11:00 Tashkent tomorrow
const TEMPLATE = {
  key: "appointment.reminder-24h",
  trigger: "APPOINTMENT_BEFORE",
  triggerConfig: { offsetMin: -1440 },
};

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));

vi.mock("@/lib/api-handler", () => ({
  createApiHandler:
    (_opts: unknown, handler: (a: { request: Request }) => Promise<Response>) =>
    (request: Request) =>
      handler({ request }),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: Request, entry: Record<string, unknown>) => {
    state.audits.push(entry);
  }),
}));

function withTemplate(row: Row | undefined) {
  if (!row) return null;
  return {
    ...row,
    template: TEMPLATE,
    patient: { id: "p1", phone: "+998901112233", telegramId: "tg1", preferredLang: "RU" },
    clinic: { slug: "neurofax" },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationSend: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        withTemplate(state.sends.find((s) => s.id === where.id)),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const s of state.sends) {
          if (!matchesWhere(s, where)) continue;
          Object.assign(s, data);
          count += 1;
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const s = state.sends.find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return s;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `clone_${state.sends.length}`, ...data };
        state.sends.push(row);
        return row;
      }),
    },
    appointment: {
      findUnique: vi.fn(async () => state.appt),
    },
  },
}));

vi.mock("@/server/notifications/adapters", () => ({
  resolveAdapters: vi.fn(async () => ({
    tg: {
      send: vi.fn(async (_chat: string, body: string) => {
        state.tgSent.push(body);
        return { messageId: 7 };
      }),
    },
  })),
}));
vi.mock("@/server/notifications/rate-limit", () => ({
  getRateLimiter: () => ({ check: async () => true }),
}));
vi.mock("@/server/notifications/record-delivery", () => ({
  recordNotificationDelivery: vi.fn(
    async ({ send, outcome }: { send: { id: string }; outcome: { kind: string } }) => {
      const s = state.sends.find((x) => x.id === send.id)!;
      s.status = outcome.kind === "sent" ? "SENT" : "FAILED";
    },
  ),
}));
vi.mock("@/server/conversations/notification-mirror", () => ({
  mirrorNotificationToConversation: vi.fn(async () => undefined),
}));
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => undefined),
  getQueue: () => ({ registerWorker: vi.fn() }),
}));

function failedReminder(over: Row = {}): Row {
  return {
    id: "snd_1",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: "apt_1",
    campaignId: null,
    caseId: null,
    templateId: "tpl_24h",
    channel: "TG",
    recipient: "tg1",
    body: "Завтра в 11:00 ждём вас.",
    status: "FAILED",
    failedReason: "Telegram 502",
    failedAt: new Date(),
    retryCount: 3,
    claimedAt: new Date(Date.now() - 60 * 60_000),
    scheduledFor: new Date(START.getTime() - 1440 * 60_000),
    appointmentAt: START,
    ...over,
  };
}

async function retry(id: string) {
  const { POST } = await import("@/app/api/crm/notifications/sends/[id]/retry/route");
  return POST(
    new Request(`https://x/api/crm/notifications/sends/${id}/retry`, { method: "POST" }),
  );
}

async function deliver(id: string) {
  const { _deliverForTests } = await import("@/server/workers/notifications-send");
  await _deliverForTests({ sendId: id });
}

beforeEach(() => {
  state.sends = [];
  state.tgSent = [];
  state.audits = [];
  state.appt = { status: "BOOKED", confirmedAt: null, date: START };
});

describe("POST /sends/[id]/retry", () => {
  it("requeues a FAILED reminder due now, and it goes out (not «Отменено»)", async () => {
    state.sends.push(failedReminder());
    const res = await retry("snd_1");
    expect(res.status).toBe(200);
    const row = state.sends[0]!;
    expect(row.status).toBe("QUEUED");
    expect(row.retryCount).toBe(0);
    expect(row.failedAt).toBeNull();
    expect(Math.abs((row.scheduledFor as Date).getTime() - Date.now())).toBeLessThan(5_000);

    await deliver("snd_1");
    expect(row.status).toBe("SENT");
    expect(state.tgSent).toEqual(["Завтра в 11:00 ждём вас."]);
  });

  it("pins the appointment start of a row built before appointmentAt existed", async () => {
    state.sends.push(failedReminder({ appointmentAt: null }));
    await retry("snd_1");
    expect((state.sends[0]!.appointmentAt as Date).getTime()).toBe(START.getTime());
    await deliver("snd_1");
    expect(state.sends[0]!.status).toBe("SENT");
  });

  it("answers 409 for a SENT row and leaves it alone", async () => {
    state.sends.push(failedReminder({ status: "SENT", failedAt: null }));
    const res = await retry("snd_1");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "notification.retry.not_retryable",
    );
    expect(state.sends[0]!.status).toBe("SENT");
  });

  it("answers 409 for a row being sent right now, accepts one abandoned mid-send", async () => {
    state.sends.push(failedReminder({ status: "SENDING", claimedAt: new Date() }));
    expect((await retry("snd_1")).status).toBe(409);
    state.sends[0]!.claimedAt = new Date(Date.now() - 11 * 60_000);
    expect((await retry("snd_1")).status).toBe(200);
    expect(state.sends[0]!.status).toBe("QUEUED");
  });

  it("still cancels the retried reminder of an appointment that moved", async () => {
    state.sends.push(failedReminder());
    await retry("snd_1");
    state.appt = { status: "BOOKED", confirmedAt: null, date: new Date(START.getTime() + 2 * 86_400_000) };
    await deliver("snd_1");
    expect(state.tgSent).toEqual([]);
    expect(state.sends[0]!.status).toBe("CANCELLED");
    expect(state.sends[0]!.failedReason).toBe(
      "appointment time changed after reminder was queued",
    );
  });
});

describe("POST /sends/[id]/resend", () => {
  async function resend(id: string) {
    const { POST } = await import("@/app/api/crm/notifications/sends/[id]/resend/route");
    return POST(
      new Request(`https://x/api/crm/notifications/sends/${id}/resend`, { method: "POST" }),
    );
  }

  it("clones a reminder with its appointment start, so the clone goes out", async () => {
    state.sends.push(failedReminder({ status: "SENT" }));
    const res = await resend("snd_1");
    expect(res.status).toBe(201);
    const clone = state.sends[1]!;
    expect((clone.appointmentAt as Date).getTime()).toBe(START.getTime());
    await deliver(clone.id as string);
    expect(clone.status).toBe("SENT");
  });

  it("refuses a row that is being sent right now", async () => {
    state.sends.push(failedReminder({ status: "SENDING", claimedAt: new Date() }));
    expect((await resend("snd_1")).status).toBe(409);
    expect(state.sends).toHaveLength(1);
  });
});

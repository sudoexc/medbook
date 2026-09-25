import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit AP-02 at the route: «Напомнить всем» dispatches exactly the rows the
 * manual-reminder materialiser created in this call. It used to enqueue
 * «every QUEUED row of these appointments scheduled from now on», which were
 * the day's future cascade reminders.
 */

const state = vi.hoisted(() => ({
  enqueued: [] as string[],
  materialize: [] as Array<Record<string, unknown>>,
  sendReads: 0,
}));

vi.mock("@/lib/api-handler", () => ({
  createApiHandler:
    (
      opts: { bodySchema: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) =>
      handler({
        request,
        body: opts.bodySchema.parse(await request.json()),
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: "RECEPTIONIST" },
      }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; clinicId: string } }) =>
        // a3 belongs to another clinic.
        where.id.in.filter((id) => id !== "a3").map((id) => ({ id })),
      ),
    },
    notificationSend: {
      findMany: vi.fn(async () => {
        state.sendReads += 1;
        return [{ id: "cascade_3h" }];
      }),
    },
  },
}));

vi.mock("@/server/notifications/triggers", () => ({
  materializeManualReminders: vi.fn(async (args: Record<string, unknown>) => {
    state.materialize.push(args);
    return {
      sendIds: ["m1", "m1_inapp", "m2", "m2_inapp"],
      reminded: 2,
      skipped: 0,
      noChannel: 0,
      templateDisabled: false,
    };
  }),
}));

vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async (_q: string, _j: string, data: { sendId: string }) => {
    state.enqueued.push(data.sendId);
  }),
}));

vi.mock("@/server/workers/notifications-send", () => ({
  QUEUE_NAME: "notifications:send",
  JOB_NAME: "deliver",
}));

beforeEach(() => {
  state.enqueued = [];
  state.materialize = [];
  state.sendReads = 0;
});

describe("POST /api/crm/appointments/bulk-reminders", () => {
  it("dispatches only the rows created by this call and reports patients, not rows", async () => {
    const { POST } = await import("@/app/api/crm/appointments/bulk-reminders/route");
    const res = await POST(
      new Request("https://x/api/crm/appointments/bulk-reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentIds: ["a1", "a2", "a3"] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.materialize[0]).toMatchObject({
      clinicId: "c1",
      appointmentIds: ["a1", "a2"],
    });
    expect(state.enqueued).toEqual(["m1", "m1_inapp", "m2", "m2_inapp"]);
    // Never goes looking for other QUEUED rows of these appointments.
    expect(state.sendReads).toBe(0);
    const body = await res.json();
    expect(body).toMatchObject({ reminded: 2, scoped: 2, requested: 3 });
  });
});

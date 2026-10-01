/**
 * Audit Q-07: the kiosk loaded the doctors and their queues once, when the
 * page opened, and «перед вами» was the board's waiting list without the
 * patient on the doctor's table. Switched on at 8:00, it said «0 в очереди,
 * перед вами 0 чел.» at noon while 15 people waited.
 *
 * Pinned here:
 *   - the count is the live queue endpoint's: waiting plus the one being
 *     seen, the same numbers the TV shows;
 *   - the kiosk merges it with its services by doctor;
 *   - the page keeps the list live (board stream + poll) and reloads it on
 *     the doctor step, and shows the live count on the confirm screen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findMany: vi.fn(async () => [
        { id: "doc_1", nameRu: "Султанов Азиз", nameUz: "Sultonov Aziz", color: null, cabinet: { number: "3" } },
        { id: "doc_2", nameRu: "Алиева Нигора", nameUz: "Aliyeva Nigora", color: null, cabinet: { number: "5" } },
      ]),
    },
  },
}));
vi.mock("@/server/doctors/on-duty", () => ({
  loadOnDutyDoctorIds: vi.fn(async () => new Set(["doc_1", "doc_2"])),
}));
vi.mock("@/server/appointments/queue-projection", () => ({
  getQueueProjection: vi.fn(async () =>
    new Map([
      [
        "doc_1",
        {
          current: { appointmentId: "a0" },
          waiting: [{ appointmentId: "a1" }, { appointmentId: "a2" }],
          perVisitMin: 20,
        },
      ],
      ["doc_2", { current: null, waiting: [], perVisitMin: 30 }],
    ]),
  ),
}));
vi.mock("@/server/clinic-public/resolve", () => ({
  createPublicClinicHandler:
    (handler: (a: { request: Request; ctx: Record<string, unknown> }) => Promise<Response>) =>
    (request: Request) =>
      handler({ request, ctx: { clinicId: "c1", clinicSlug: "neurofax" } }),
}));

import { mergeKioskDoctors } from "@/lib/kiosk-flow";
import { BOARD_REFETCH_EVENTS } from "@/hooks/use-queue-board";

describe("how many are ahead", () => {
  it("the live queue counts the patient on the table too", async () => {
    const { GET } = await import("@/app/api/c/[slug]/queue/doctors/route");
    const body = (await (await GET(new Request("https://x/api/c/neurofax/queue/doctors"))).json()) as {
      doctors: Array<{ id: string; waitingCount: number }>;
    };
    const counts = Object.fromEntries(body.doctors.map((d) => [d.id, d.waitingCount]));
    expect(counts).toEqual({ doc_1: 3, doc_2: 0 });
  });

  it("the kiosk shows that count and the doctor's services", () => {
    const merged = mergeKioskDoctors(
      [
        { id: "doc_1", nameRu: "Султанов Азиз", nameUz: null, cabinet: "3", color: null, waitingCount: 3 },
        { id: "doc_2", nameRu: "Алиева Нигора", nameUz: "Aliyeva Nigora", cabinet: "5", color: "#f00", waitingCount: 0 },
      ],
      [{ id: "doc_1", services: [{ id: "svc_eeg", nameRu: "ЭЭГ", nameUz: "EEG", price: 250_000 }] }],
    );
    expect(merged).toEqual([
      {
        id: "doc_1",
        nameRu: "Султанов Азиз",
        nameUz: "Султанов Азиз",
        cabinet: "3",
        color: null,
        ahead: 3,
        services: [{ id: "svc_eeg", nameRu: "ЭЭГ", nameUz: "EEG", price: 250_000 }],
      },
      {
        id: "doc_2",
        nameRu: "Алиева Нигора",
        nameUz: "Aliyeva Nigora",
        cabinet: "5",
        color: "#f00",
        ahead: 0,
        services: [],
      },
    ]);
  });
});

describe("the kiosk keeps the list live", () => {
  const root = process.cwd();
  const hook = readFileSync(path.join(root, "src/hooks/use-kiosk-doctors.ts"), "utf8");
  const page = readFileSync(path.join(root, "src/app/kiosk/page.tsx"), "utf8");

  it("refetches on the board stream's queue events and polls as a fallback", () => {
    expect(hook).toContain("openBoardEventSource(");
    expect(hook).toContain("/queue/events");
    expect(hook).toContain("BOARD_REFETCH_EVENTS.has(type)");
    expect(hook).toMatch(/setInterval\(fetchDoctors, BOARD_POLL_FALLBACK_MS\)/);
    expect(hook).toContain("/queue/doctors");
    // A walk-in from reception, a call, a cancel: each changes the counts.
    for (const t of ["appointment.created", "queue.updated", "queue.called", "appointment.cancelled"]) {
      expect(BOARD_REFETCH_EVENTS.has(t)).toBe(true);
    }
  });

  it("the page reads the live list, reloads it on the doctor step, and never counts the board's waiting list", () => {
    expect(page).toContain("useKioskDoctors(slug)");
    expect(page).toMatch(/if \(step === "select-doctor"\) refreshDoctors\(\)/);
    expect(page).not.toMatch(/waiting\.length/);
    expect(page).toContain("liveAhead(selectedDoctor)");
  });
});

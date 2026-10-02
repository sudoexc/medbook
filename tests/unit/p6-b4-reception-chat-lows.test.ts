/**
 * P6 B4: the low-severity call-center and Telegram-rail findings.
 *
 *   CM-27  a call that starts ringing raises a toast; the queue's hint says
 *          how it really refreshes.
 *   G6-09  «Ещё → Случаи / Платежи / Документы» open that tab; no «Пополнить».
 *   G6-10  «Авто-сообщения» says the load failed instead of spinning.
 *   G6-11  «Записать на приём» from the composer works with the rail hidden.
 *   G6-12  the no-show rate is a share of the visits that happened.
 *   G6-13  no «Связанные темы» counted from Russian substrings.
 *   G6-14  create/link errors in words; a bot chat can be untied from a card.
 *   G6-15  quick replies greet the Telegram name, in the patient's language,
 *          and never insert an empty clinic phone.
 *   G6-16  no «AI-ассистент» with a hard-coded confidence; no unreachable
 *          «верифицирован» badge.
 *   G6-17  the chat statistics split staff from the bot and say what they
 *          count.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { diffRingingCalls } from "@/lib/calls/new-calls";
import { noShowFigures, noShowFiguresOf } from "@/lib/patients/no-show";
import { linkedCardTab } from "@/app/[locale]/crm/patients/[id]/_lib/card-tab";
import {
  avgStaffReplySeconds,
  chatMessageCounts,
  durationParts,
} from "@/app/[locale]/crm/telegram/_lib/chat-stats";
import { createPatientErrorKey } from "@/app/[locale]/crm/telegram/_lib/create-patient-error";
import {
  fillPlaceholders,
  hasUnfilledPlaceholders,
  replyRecipient,
} from "@/app/[locale]/crm/telegram/_lib/placeholders";
import { UpdateConversationSchema } from "@/server/schemas/conversation";

const h = vi.hoisted(() => ({
  byStatus: [] as Array<{ status: string; _count: { _all: number } }>,
}));

vi.mock("@/lib/api-handler", () => {
  const handler =
    (_opts: unknown, fn: (a: { request: Request }) => Promise<Response>) =>
    async (request: Request) =>
      fn({ request });
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/server/patient/finance", () => ({
  loadPatientFinance: vi.fn(async () => ({ balance: 0 })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findUnique: vi.fn(async () => ({
        clinicId: "clinic_A",
        segment: "ACTIVE",
        visitsCount: 1,
        ltv: 0,
        lastVisitAt: null,
        birthDate: null,
      })),
    },
    appointment: {
      groupBy: vi.fn(async () => h.byStatus),
      aggregate: vi.fn(async () => ({ _avg: { priceFinal: null } })),
    },
  },
}));

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const ru = JSON.parse(read("src/messages/ru.json"));
const uz = JSON.parse(read("src/messages/uz.json"));
const RAIL = "src/app/[locale]/crm/telegram/_components/chat-right-rail.tsx";
const COMPOSER = "src/app/[locale]/crm/telegram/_components/message-composer.tsx";

beforeEach(() => {
  h.byStatus = [];
});

describe("CM-27: a new ringing call is announced", () => {
  it("the first list is the baseline; every later new id is news", () => {
    const first = diffRingingCalls(null, ["A", "B"]);
    expect(first.fresh).toEqual([]);
    // The old rule's miss: [A,B] → [C,A,B] compared 3 > 3 and stayed silent.
    const second = diffRingingCalls(first.seen, ["C", "A", "B"]);
    expect(second.fresh).toEqual(["C"]);
    // Nothing new, nothing said; ended calls leave the set.
    const third = diffRingingCalls(second.seen, ["C"]);
    expect(third.fresh).toEqual([]);
    expect([...third.seen]).toEqual(["C"]);
    // Two at once after an empty queue.
    expect(diffRingingCalls(new Set(), ["D", "E"]).fresh).toEqual(["D", "E"]);
  });

  it("the page owns the alert, since the queue column unmounts on the missed tab", () => {
    const page = read("src/app/[locale]/crm/call-center/_components/call-center-page-client.tsx");
    expect(page).toContain("useIncomingCallAlerts(incomingQuery.data);");
    const queue = read("src/app/[locale]/crm/call-center/_components/incoming-queue.tsx");
    expect(queue).not.toMatch(/from "sonner"|toast\./);
    const hook = read("src/app/[locale]/crm/call-center/_hooks/use-incoming-calls.ts");
    expect(hook).toMatch(/playNotificationSound\(\)/);
  });

  it("the hint no longer promises a 5-second refresh", () => {
    expect(ru.callCenter.queue.pollingHint).not.toMatch(/5/);
    expect(uz.callCenter.queue.pollingHint).not.toMatch(/5/);
  });
});

describe("G6-09: the rail's links open the tab they name", () => {
  it("?tab= picks the tab, #case- wins, anything else stays on the overview", () => {
    expect(linkedCardTab("?tab=payments", "")).toBe("payments");
    expect(linkedCardTab("?tab=cases", "")).toBe("cases");
    expect(linkedCardTab("?tab=documents", "")).toBe("documents");
    expect(linkedCardTab("?tab=payments", "#case-c1")).toBe("cases");
    expect(linkedCardTab("?tab=nope", "")).toBeNull();
    expect(linkedCardTab("", "")).toBeNull();
  });

  it("the card reads it, and the rail offers no top-up", () => {
    const card = read("src/app/[locale]/crm/patients/[id]/_components/patient-card-client.tsx");
    expect(card).toMatch(/linkedCardTab\(window\.location\.search, window\.location\.hash\)/);
    const rail = read(RAIL);
    expect(rail).not.toMatch(/action=topup/);
    expect(rail).toMatch(/\/\$\{locale\}\/crm\/patients\/\$\{patientId\}\?tab=payments/);
  });
});

describe("G6-10: a failed load of the auto messages is said", () => {
  it("the error branch comes before the spinner", () => {
    const src = read("src/app/[locale]/crm/telegram/_components/auto-messages-dialog.tsx");
    const error = src.indexOf("query.isError && !draft ?");
    const spinner = src.indexOf("query.isLoading || !draft ?");
    expect(error).toBeGreaterThan(-1);
    expect(spinner).toBeGreaterThan(error);
  });
});

describe("G6-11: booking from the composer with the rail hidden", () => {
  it("the page mounts the booking dialog outside the rail, keyed by dialog", () => {
    const page = read("src/app/[locale]/crm/telegram/_components/telegram-page-client.tsx");
    expect(page).toContain("<ChatBookingDialog key={selected.id} conversation={selected} />");
    const rail = read(RAIL);
    // The rail's own «Записать» goes through the same event.
    expect(rail).toContain(
      "onBook={() => dispatchOpenAppointment({ conversationId: conversation.id })}",
    );
    expect(rail.match(/<NewAppointmentDialog/g)).toHaveLength(1);
  });
});

describe("G6-12: no-show rate over the visits that happened", () => {
  it("1 missed of 2 past visits is 50%, whatever is booked or cancelled", () => {
    expect(
      noShowFiguresOf([
        { status: "COMPLETED" },
        { status: "NO_SHOW" },
        { status: "BOOKED" },
        { status: "CONFIRMED" },
        { status: "CANCELLED" },
        { status: "CANCELLED" },
        { status: "CANCELLED" },
        { status: "CANCELLED" },
      ]),
    ).toEqual({ settled: 2, noShow: 1, pct: 50 });
    expect(noShowFigures({ completed: 0, noShow: 0 })).toEqual({ settled: 0, noShow: 0, pct: 0 });
  });

  it("the stats API answers 50% and the settled count", async () => {
    h.byStatus = [
      { status: "COMPLETED", _count: { _all: 1 } },
      { status: "NO_SHOW", _count: { _all: 1 } },
      { status: "BOOKED", _count: { _all: 2 } },
      { status: "CANCELLED", _count: { _all: 4 } },
    ];
    const { GET } = await import("@/app/api/crm/patients/[id]/stats/route");
    const res = await GET(new Request("http://x/api/crm/patients/p1/stats"));
    const body = (await res.json()) as Record<string, number>;
    expect(body.noShowPct).toBe(50);
    expect(body.settledAppointments).toBe(2);
    expect(body.totalAppointments).toBe(8);
  });

  it("the patient card's hero and right rail use the same rule", () => {
    for (const file of [
      "src/app/[locale]/crm/patients/[id]/_components/patient-hero.tsx",
      "src/app/[locale]/crm/patients/[id]/_components/patient-right-rail.tsx",
    ]) {
      const src = read(file);
      expect(src, file).toContain("noShowFiguresOf(appointments).pct");
      expect(src, file).not.toMatch(/\/ appointments\.length/);
    }
    expect(read(RAIL)).toMatch(/stats\.settledAppointments === 0/);
  });
});

describe("G6-13, G6-16: no made-up analytics in the rail", () => {
  it("no topics, no AI card, no constant confidence, no verified flag", () => {
    const rail = read(RAIL);
    expect(rail).not.toMatch(/RelatedTopicsCard|countTopics|TOPIC_TERMS/);
    expect(rail).not.toMatch(/AiAssistantCard|deriveAiRecs|confidence/);
    expect(rail).not.toMatch(/isVerified/);
  });
});

describe("G6-14: errors in words, and untying a chat", () => {
  it("maps the API's answers to the rail's messages", () => {
    expect(createPatientErrorKey(400, { error: "ValidationError", reason: "invalid_phone" })).toBe(
      "invalidPhone",
    );
    expect(createPatientErrorKey(400, { error: "ValidationError" })).toBe("invalid");
    expect(createPatientErrorKey(403, { error: "Forbidden" })).toBe("forbidden");
    expect(createPatientErrorKey(500, null)).toBe("failed");
    for (const key of ["invalidPhone", "invalid", "forbidden", "failed", "linkFailed"]) {
      expect(ru.tgInbox.rail.createErrors[key], key).toBeTruthy();
      expect(uz.tgInbox.rail.createErrors[key], key).toBeTruthy();
    }
  });

  it("no raw code reaches the toast", () => {
    const rail = read(RAIL);
    expect(rail).not.toMatch(/NAME_REQUIRED|PHONE_REQUIRED|Link failed|"Create failed"/);
    expect(rail).toMatch(/readPlanLimit\(res\.status, j\)/);
  });

  it("a bot chat can be untied: the PATCH takes patientId null", () => {
    expect(UpdateConversationSchema.safeParse({ patientId: null }).success).toBe(true);
    const rail = read(RAIL);
    expect(rail).toContain("JSON.stringify({ patientId: null })");
    expect(rail).toMatch(/<UnlinkPatientCard\s+conversation=\{conversation\}/);
  });
});

describe("G6-15: quick replies", () => {
  const conv = {
    patient: null,
    contactFirstName: "Dilnoza",
    contactLastName: "Karimova",
  };

  it("greet the Telegram name in a chat with no card, the given name with one", () => {
    expect(replyRecipient(conv)).toEqual({ firstName: "Dilnoza", name: "Dilnoza Karimova" });
    expect(
      replyRecipient({ ...conv, patient: { fullName: "Каримова Дилноза Алишеровна" } }),
    ).toEqual({ firstName: "Дилноза", name: "Каримова Дилноза Алишеровна" });
    expect(replyRecipient({ patient: null, contactFirstName: null, contactLastName: null })).toEqual({
      firstName: "",
      name: "",
    });
  });

  it("an empty value leaves the token visible instead of «, здравствуйте!»", () => {
    const text = fillPlaceholders("{{patient.firstName}}, здравствуйте! Телефон {{clinic.phone}}", {
      firstName: "",
      name: "",
      clinic: "НейроФакс",
      phone: "",
      address: "",
    });
    expect(text).toBe("{{patient.firstName}}, здравствуйте! Телефон {{clinic.phone}}");
    expect(hasUnfilledPlaceholders(text)).toBe(true);
    expect(hasUnfilledPlaceholders("Dilnoza, здравствуйте!")).toBe(false);
  });

  it("the picker waits for the clinic and starts in the patient's language", () => {
    const composer = read(COMPOSER);
    expect(composer).toContain("const clinicQ = useClinicInfo(true);");
    expect(composer).toContain("disabled={clinicPending}");
    expect(composer).toMatch(/conversation\.patient\?\.preferredLang \?\?/);
    expect(composer).toMatch(/\.\.\.replyRecipient\(conversation\)/);
    for (const file of [
      "src/app/api/crm/conversations/route.ts",
      "src/app/api/crm/conversations/[id]/route.ts",
    ]) {
      expect(read(file), file).toMatch(/preferredLang: true/);
    }
    expect(ru.tgInbox.composer.canned.unfilled).toBeTruthy();
    expect(uz.tgInbox.composer.canned.unfilled).toBeTruthy();
  });
});

describe("G6-17: chat statistics", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 9, min)).toISOString();
  const messages = [
    { direction: "IN" as const, senderId: null, origin: null, createdAt: at(0) },
    // The bot's welcome, at once: not an answer.
    { direction: "OUT" as const, senderId: null, origin: null, createdAt: at(0) },
    { direction: "IN" as const, senderId: null, origin: null, createdAt: at(2) },
    // The receptionist answers 10 minutes after the first question.
    { direction: "OUT" as const, senderId: "u_reception", origin: null, createdAt: at(10) },
    // A reminder copied into the dialog answers nobody.
    { direction: "OUT" as const, senderId: null, origin: "notification" as const, createdAt: at(30) },
    { direction: "IN" as const, senderId: null, origin: null, createdAt: at(40) },
    { direction: "OUT" as const, senderId: "u_reception", origin: null, createdAt: at(44) },
  ];

  it("staff replies apart from the bot's; automatic sends are neither", () => {
    expect(chatMessageCounts(messages)).toEqual({ fromPatient: 3, staffReplies: 2, botReplies: 1 });
  });

  it("reply time runs from the first unanswered message to a staff reply", () => {
    // (10 min + 4 min) / 2 = 7 min.
    expect(avgStaffReplySeconds(messages)).toBe(420);
    expect(avgStaffReplySeconds(messages.slice(0, 2))).toBeNull();
  });

  it("durations come with a translated unit", () => {
    expect(durationParts(45)).toEqual({ unit: "sec", n: 45 });
    expect(durationParts(59.6)).toEqual({ unit: "min", n: 1 });
    expect(durationParts(420)).toEqual({ unit: "min", n: 7 });
    expect(durationParts(5400)).toEqual({ unit: "hour", n: 1.5 });
    for (const key of ["durationSec", "durationMin", "durationHour", "staffReplies", "avgStaffReply", "loadedScope"]) {
      expect(ru.tgInbox.rail.stats[key], key).toBeTruthy();
      expect(uz.tgInbox.rail.stats[key], key).toBeTruthy();
    }
  });

  it("the card says it counts the loaded messages, not «за 30 дней»", () => {
    const rail = read(RAIL);
    expect(rail).toContain('{t("loadedScope")}');
    expect(rail).not.toContain('{t("period")}');
    expect(rail).not.toMatch(/`\$\{Math\.round\(seconds\)\}s`/);
  });
});

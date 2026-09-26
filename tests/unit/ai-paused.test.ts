import { readFileSync } from "node:fs";
import path from "node:path";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit UX-01: AI is paused (`AI_ENABLED = false`), yet only the UI knew.
 * The dimmed «AI-резюме» panel on a patient's visit history still fetched
 * the summary; the endpoint queued an LLM job on every open, and with no
 * provider key the worker stored «[mock-llm: mock] Пациент: …» in the card
 * (and the DSAR export). A doctor's Telegram voice note overwrote the open
 * case's SOAP draft with «[mock-transcript] Пациент жалуется на головную
 * боль».
 *
 * With AI paused the server now queues nothing, calls no provider and writes
 * nothing, and the panel is not mounted.
 */

vi.mock("@/lib/ai-enabled", () => ({ AI_ENABLED: false }));

const spies = vi.hoisted(() => ({
  enqueue: vi.fn(async () => undefined),
  generatePatientSummary: vi.fn(),
  transcribe: vi.fn(),
  structureSoap: vi.fn(),
  sendMessage: vi.fn(async () => ({ ok: true })),
  getFile: vi.fn(),
  patientUpdate: vi.fn(),
  medicalCaseUpdate: vi.fn(),
  medicalCaseFindFirst: vi.fn(async () => ({ id: "case1" })),
  audit: vi.fn(async () => undefined),
  useQuery: vi.fn<(opts: Record<string, unknown>) => Record<string, unknown>>(() => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    refetch: () => undefined,
  })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: { findUnique: vi.fn(), update: spies.patientUpdate },
    appointment: { findMany: vi.fn(async () => []) },
    medicalCase: {
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      findFirst: spies.medicalCaseFindFirst,
      update: spies.medicalCaseUpdate,
    },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/server/queue", () => ({
  enqueue: spies.enqueue,
  getQueue: () => ({ registerWorker: vi.fn() }),
}));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/ai/summary", () => ({
  generatePatientSummary: spies.generatePatientSummary,
}));
vi.mock("@/server/ai/transcribe", () => ({ transcribe: spies.transcribe }));
vi.mock("@/server/ai/soap", () => ({
  structureSoap: spies.structureSoap,
  stitchSoapMarkdown: () => "",
}));
vi.mock("@/server/telegram/send", () => ({ sendMessage: spies.sendMessage }));
vi.mock("@/server/telegram/bot-api", () => ({
  getFile: spies.getFile,
  buildFileDownloadUrl: () => "https://tg/file",
}));
vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "DOCTOR" };
  return {
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: spies.audit }));
vi.mock("@tanstack/react-query", () => ({ useQuery: spies.useQuery }));
vi.mock("next-intl", () => ({
  useLocale: () => "uz",
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import {
  AI_PAUSED_SUMMARY,
  readOrRefreshPatientSummary,
} from "@/server/ai/patient-summary-cache";
import { _refreshForTests } from "@/server/workers/patient-summary-refresh";
import { _processForTests } from "@/server/workers/voice-soap";
import { handleDoctorVoice } from "@/server/telegram/voice-handler";
import { t as botT } from "@/server/telegram/messages";
import { AISummaryPanel } from "@/app/[locale]/doctor/reception/_components/ai-summary-panel";

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockClear();
});

describe("patient summary while AI is paused", () => {
  it("queues no job and hands out no cached (mock) text, even when stale or forced", async () => {
    const db = {
      patient: {
        findUnique: vi.fn(async () => ({
          id: "p1",
          summaryCache: "[mock-llm: mock] Пациент: Иванова Мария, F, возраст 34",
          summaryCacheUpdatedAt: new Date("2026-01-01T00:00:00Z"),
        })),
      },
      appointment: { findFirst: vi.fn(async () => null) },
    };
    const enqueueRefresh = vi.fn(async () => undefined);
    for (const forceRefresh of [false, true]) {
      const res = await readOrRefreshPatientSummary(db, "c1", "u1", "p1", "ru", {
        forceRefresh,
        enqueueRefresh,
      });
      expect(res).toEqual(AI_PAUSED_SUMMARY);
    }
    expect(enqueueRefresh).not.toHaveBeenCalled();
    expect(db.patient.findUnique).not.toHaveBeenCalled();
    expect(spies.enqueue).not.toHaveBeenCalled();
  });

  it("the refresh endpoint refuses without queueing or auditing", async () => {
    const { POST } = await import("@/app/api/crm/patients/[id]/summary/refresh/route");
    const res = await POST(
      new Request("https://x/api/crm/patients/p1/summary/refresh?locale=ru", { method: "POST" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ai_disabled" });
    expect(spies.enqueue).not.toHaveBeenCalled();
    expect(spies.audit).not.toHaveBeenCalled();
  });

  it("a job already in the queue writes nothing and calls no LLM", async () => {
    await _refreshForTests({ clinicId: "c1", userId: "u1", patientId: "p1", locale: "ru" });
    expect(spies.generatePatientSummary).not.toHaveBeenCalled();
    expect(spies.patientUpdate).not.toHaveBeenCalled();
  });
});

describe("doctor's voice note while AI is paused", () => {
  const clinic = { id: "c1", slug: "neurofax", tgBotToken: "tok", tgBotUsername: "bot" };

  it("is not queued, not downloaded, and the doctor is told why", async () => {
    const res = await handleDoctorVoice({
      clinic: clinic as never,
      chatId: "42",
      tgUserId: "777",
      voice: { duration: 12, file_id: "f1" },
      doctor: { userId: "u1", doctorId: "d1", lang: "ru" },
    });
    expect(res.kind).toBe("ai-paused");
    expect(spies.enqueue).not.toHaveBeenCalled();
    expect(spies.getFile).not.toHaveBeenCalled();
    expect(spies.sendMessage).toHaveBeenCalledWith(
      clinic,
      "42",
      botT("ru", "tgVoiceReply.aiPaused"),
    );
    expect(botT("uz", "tgVoiceReply.aiPaused")).not.toBe(botT("ru", "tgVoiceReply.aiPaused"));
  });

  it("a queued job neither transcribes nor overwrites the SOAP draft", async () => {
    await _processForTests({
      clinicId: "c1",
      userId: "u1",
      doctorId: "d1",
      caseId: "case1",
      fileUrl: "https://tg/file",
      durationSec: 12,
    });
    expect(spies.transcribe).not.toHaveBeenCalled();
    expect(spies.structureSoap).not.toHaveBeenCalled();
    expect(spies.medicalCaseUpdate).not.toHaveBeenCalled();
  });
});

describe("AISummaryPanel while AI is paused", () => {
  it("never fetches the summary", () => {
    renderToStaticMarkup(React.createElement(AISummaryPanel, { patientId: "p1" }));
    expect(spies.useQuery).toHaveBeenCalled();
    for (const [opts] of spies.useQuery.mock.calls) {
      expect(opts.enabled).toBe(false);
    }
  });

  it("is not mounted on the doctor's visit history page", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/doctor/visits/[patientId]/page.tsx"),
      "utf8",
    );
    const mounts = src.match(/<AISummaryPanel\b/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(src).toMatch(/\{AI_ENABLED \? \(\s*<AISummaryPanel\b/);
  });
});

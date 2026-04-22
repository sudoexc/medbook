/**
 * Conversation FSM for the clinic Telegram bot.
 *
 * States (per charter):
 *   start        — fresh chat, no lang chosen
 *   lang_select  — waiting for language pick
 *   service_select — waiting for specialization
 *   doctor_select  — waiting for doctor within selected service
 *   slot_select    — waiting for slot within chosen doctor
 *   name_input     — waiting for patient name
 *   confirm        — waiting for confirmation
 *   done           — terminal; next message restarts
 *
 * Storage:
 *  - If `REDIS_URL` is set and a `redis` client was injected via
 *    `__setStateStoreForTests`, state is persisted with 30-min TTL.
 *  - Otherwise in-memory `Map` keyed by `${clinicId}:${chatId}`.
 *
 * The FSM is framework-agnostic: `step(prev, event)` returns `{next, outgoing}`
 * where `outgoing` describes a message to send (text + optional inline keyboard).
 * The webhook glues this to `send.ts`. Everything below is pure — easy to unit
 * test.
 *
 * Non-goals (for now):
 *  - Actually creating Appointment rows — Phase 3d (miniapp does that cleanly
 *    with verified init_data). Bot FSM prepares the data but ends at `done`
 *    with a summary; a follow-up commit from `telegram-bot-developer` will
 *    tie `confirm` to the Appointment POST.
 */

import type { TgInlineKeyboard } from "./send";
import { type BotLang, t } from "./messages";

export type FsmState =
  | "start"
  | "lang_select"
  | "service_select"
  | "doctor_select"
  | "slot_select"
  | "name_input"
  | "confirm"
  | "done";

export type FsmData = {
  lang?: BotLang;
  serviceId?: string;
  serviceName?: string;
  doctorId?: string;
  doctorName?: string;
  slotIso?: string;
  slotLabel?: string;
  name?: string;
};

export type FsmSnapshot = {
  state: FsmState;
  data: FsmData;
  updatedAt: number;
};

export type FsmEvent =
  | { kind: "start" }
  | { kind: "text"; text: string }
  | { kind: "callback"; data: string };

export type OutgoingMessage = {
  text: string;
  replyMarkup?: { inline_keyboard: TgInlineKeyboard };
};

export type FsmStep = {
  next: FsmSnapshot;
  outgoing: OutgoingMessage | null;
};

/**
 * Fixture catalog for tests / dev. The real webhook passes a live catalog
 * fetched from Prisma (services + doctors + next available slots). Keeping a
 * tiny stub here means the FSM is testable without a DB.
 */
export type Catalog = {
  services: Array<{ id: string; nameRu: string; nameUz: string }>;
  doctorsByService: Record<
    string,
    Array<{ id: string; nameRu: string; nameUz: string }>
  >;
  slotsByDoctor: Record<string, Array<{ iso: string; label: string }>>;
};

export const EMPTY_CATALOG: Catalog = {
  services: [],
  doctorsByService: {},
  slotsByDoctor: {},
};

function now(): number {
  return Date.now();
}

function langName(lang: BotLang | undefined, s: { nameRu: string; nameUz: string }): string {
  return lang === "uz" ? s.nameUz : s.nameRu;
}

function kb(rows: Array<Array<{ text: string; data: string }>>): OutgoingMessage["replyMarkup"] {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data })),
    ),
  };
}

/**
 * Pure transition. `prev` is the current FSM snapshot, `event` is the
 * incoming Telegram event, `catalog` is the data needed to render options.
 */
export function step(
  prev: FsmSnapshot,
  event: FsmEvent,
  catalog: Catalog,
): FsmStep {
  // Commands that always restart the flow.
  if (event.kind === "text" && event.text.trim() === "/start") {
    return startFlow();
  }
  if (event.kind === "start") {
    return startFlow();
  }

  switch (prev.state) {
    case "start":
      return startFlow();

    case "lang_select": {
      if (event.kind === "callback" && event.data.startsWith("lang:")) {
        const chosen = event.data.slice("lang:".length) as BotLang;
        const lang: BotLang = chosen === "uz" ? "uz" : "ru";
        return enterServiceSelect({ ...prev.data, lang }, lang, catalog);
      }
      // any other input re-prompts
      return {
        next: prev,
        outgoing: buildLangPrompt(),
      };
    }

    case "service_select": {
      if (event.kind === "callback" && event.data.startsWith("svc:")) {
        const serviceId = event.data.slice("svc:".length);
        const svc = catalog.services.find((s) => s.id === serviceId);
        if (!svc) {
          return enterServiceSelect(prev.data, prev.data.lang, catalog);
        }
        const data: FsmData = {
          ...prev.data,
          serviceId: svc.id,
          serviceName: langName(prev.data.lang, svc),
        };
        return enterDoctorSelect(data, prev.data.lang, catalog);
      }
      return {
        next: prev,
        outgoing: buildServicePrompt(prev.data.lang, catalog),
      };
    }

    case "doctor_select": {
      if (event.kind === "callback" && event.data.startsWith("doc:")) {
        const doctorId = event.data.slice("doc:".length);
        const docs = catalog.doctorsByService[prev.data.serviceId ?? ""] ?? [];
        const doc = docs.find((d) => d.id === doctorId);
        if (!doc) {
          return enterDoctorSelect(prev.data, prev.data.lang, catalog);
        }
        const data: FsmData = {
          ...prev.data,
          doctorId: doc.id,
          doctorName: langName(prev.data.lang, doc),
        };
        return enterSlotSelect(data, prev.data.lang, catalog);
      }
      if (event.kind === "callback" && event.data === "back") {
        return enterServiceSelect(prev.data, prev.data.lang, catalog);
      }
      return {
        next: prev,
        outgoing: buildDoctorPrompt(prev.data.lang, prev.data.serviceId, catalog),
      };
    }

    case "slot_select": {
      if (event.kind === "callback" && event.data.startsWith("slot:")) {
        const iso = event.data.slice("slot:".length);
        const slots = catalog.slotsByDoctor[prev.data.doctorId ?? ""] ?? [];
        const slot = slots.find((s) => s.iso === iso);
        if (!slot) {
          return enterSlotSelect(prev.data, prev.data.lang, catalog);
        }
        const data: FsmData = {
          ...prev.data,
          slotIso: slot.iso,
          slotLabel: slot.label,
        };
        return enterNameInput(data, prev.data.lang);
      }
      if (event.kind === "callback" && event.data === "back") {
        return enterDoctorSelect(prev.data, prev.data.lang, catalog);
      }
      return {
        next: prev,
        outgoing: buildSlotPrompt(prev.data.lang, prev.data.doctorId, catalog),
      };
    }

    case "name_input": {
      if (event.kind === "text") {
        const raw = event.text.trim();
        if (raw.length < 2) {
          return {
            next: prev,
            outgoing: { text: t(prev.data.lang, "name.tooShort") },
          };
        }
        const data: FsmData = { ...prev.data, name: raw };
        return enterConfirm(data, prev.data.lang);
      }
      return {
        next: prev,
        outgoing: { text: t(prev.data.lang, "name.prompt") },
      };
    }

    case "confirm": {
      if (event.kind === "callback" && event.data === "confirm") {
        return {
          next: {
            state: "done",
            data: prev.data,
            updatedAt: now(),
          },
          outgoing: { text: t(prev.data.lang, "done.success") },
        };
      }
      if (event.kind === "callback" && event.data === "cancel") {
        return {
          next: {
            state: "done",
            data: { lang: prev.data.lang },
            updatedAt: now(),
          },
          outgoing: { text: t(prev.data.lang, "done.cancelled") },
        };
      }
      return {
        next: prev,
        outgoing: buildConfirmPrompt(prev.data, prev.data.lang),
      };
    }

    case "done":
      // Any event after done restarts the flow.
      return startFlow();
  }
}

function startFlow(): FsmStep {
  return {
    next: { state: "lang_select", data: {}, updatedAt: now() },
    outgoing: buildLangPrompt(),
  };
}

function enterServiceSelect(
  data: FsmData,
  lang: BotLang | undefined,
  catalog: Catalog,
): FsmStep {
  return {
    next: { state: "service_select", data, updatedAt: now() },
    outgoing: buildServicePrompt(lang, catalog),
  };
}

function enterDoctorSelect(
  data: FsmData,
  lang: BotLang | undefined,
  catalog: Catalog,
): FsmStep {
  return {
    next: { state: "doctor_select", data, updatedAt: now() },
    outgoing: buildDoctorPrompt(lang, data.serviceId, catalog),
  };
}

function enterSlotSelect(
  data: FsmData,
  lang: BotLang | undefined,
  catalog: Catalog,
): FsmStep {
  return {
    next: { state: "slot_select", data, updatedAt: now() },
    outgoing: buildSlotPrompt(lang, data.doctorId, catalog),
  };
}

function enterNameInput(data: FsmData, lang: BotLang | undefined): FsmStep {
  return {
    next: { state: "name_input", data, updatedAt: now() },
    outgoing: { text: t(lang, "name.prompt") },
  };
}

function enterConfirm(data: FsmData, lang: BotLang | undefined): FsmStep {
  return {
    next: { state: "confirm", data, updatedAt: now() },
    outgoing: buildConfirmPrompt(data, lang),
  };
}

// ─── Prompt builders ──────────────────────────────────────────────────────

function buildLangPrompt(): OutgoingMessage {
  return {
    text: t("ru", "start.welcome"),
    replyMarkup: kb([
      [
        { text: t("ru", "start.langButton.ru"), data: "lang:ru" },
        { text: t("uz", "start.langButton.uz"), data: "lang:uz" },
      ],
    ]),
  };
}

function buildServicePrompt(
  lang: BotLang | undefined,
  catalog: Catalog,
): OutgoingMessage {
  const services = catalog.services;
  if (services.length === 0) {
    return { text: t(lang, "service.noneAvailable") };
  }
  const rows = services.map((s) => [
    { text: langName(lang, s), data: `svc:${s.id}` },
  ]);
  return {
    text: t(lang, "service.prompt"),
    replyMarkup: kb(rows),
  };
}

function buildDoctorPrompt(
  lang: BotLang | undefined,
  serviceId: string | undefined,
  catalog: Catalog,
): OutgoingMessage {
  const docs = catalog.doctorsByService[serviceId ?? ""] ?? [];
  if (docs.length === 0) {
    return { text: t(lang, "doctor.noneAvailable") };
  }
  const rows = docs.map((d) => [
    { text: langName(lang, d), data: `doc:${d.id}` },
  ]);
  rows.push([{ text: t(lang, "common.back"), data: "back" }]);
  return {
    text: t(lang, "doctor.prompt"),
    replyMarkup: kb(rows),
  };
}

function buildSlotPrompt(
  lang: BotLang | undefined,
  doctorId: string | undefined,
  catalog: Catalog,
): OutgoingMessage {
  const slots = catalog.slotsByDoctor[doctorId ?? ""] ?? [];
  if (slots.length === 0) {
    return { text: t(lang, "slot.noneAvailable") };
  }
  // Render 3-per-row for compact layout.
  const rows: Array<Array<{ text: string; data: string }>> = [];
  for (let i = 0; i < slots.length; i += 3) {
    rows.push(
      slots
        .slice(i, i + 3)
        .map((s) => ({ text: s.label, data: `slot:${s.iso}` })),
    );
  }
  rows.push([{ text: t(lang, "common.back"), data: "back" }]);
  return {
    text: t(lang, "slot.prompt"),
    replyMarkup: kb(rows),
  };
}

function buildConfirmPrompt(
  data: FsmData,
  lang: BotLang | undefined,
): OutgoingMessage {
  const lines = [
    t(lang, "confirm.summary"),
    `• ${data.serviceName ?? "—"}`,
    `• ${data.doctorName ?? "—"}`,
    `• ${data.slotLabel ?? "—"}`,
    `• ${data.name ?? "—"}`,
  ];
  return {
    text: lines.join("\n"),
    replyMarkup: kb([
      [
        { text: t(lang, "confirm.confirmBtn"), data: "confirm" },
        { text: t(lang, "confirm.cancelBtn"), data: "cancel" },
      ],
    ]),
  };
}

// ─── Persistence layer ────────────────────────────────────────────────────

export type StateStore = {
  get(key: string): Promise<FsmSnapshot | null>;
  set(key: string, snap: FsmSnapshot, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
};

const TTL_MS = 30 * 60 * 1000;

class MemoryStore implements StateStore {
  private map = new Map<string, { snap: FsmSnapshot; expires: number }>();

  async get(key: string): Promise<FsmSnapshot | null> {
    const rec = this.map.get(key);
    if (!rec) return null;
    if (rec.expires < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return rec.snap;
  }

  async set(key: string, snap: FsmSnapshot, ttlMs: number): Promise<void> {
    this.map.set(key, { snap, expires: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  // Test helper
  _size(): number {
    return this.map.size;
  }
}

let singleton: StateStore | null = null;

export function getStateStore(): StateStore {
  if (!singleton) singleton = new MemoryStore();
  return singleton;
}

/** Test-only: inject a mock store. */
export function __setStateStoreForTests(s: StateStore | null): void {
  singleton = s;
}

export function stateKey(clinicId: string, chatId: string | number): string {
  return `fsm:${clinicId}:${chatId}`;
}

export async function loadSnapshot(
  clinicId: string,
  chatId: string | number,
): Promise<FsmSnapshot> {
  const store = getStateStore();
  const snap = await store.get(stateKey(clinicId, chatId));
  if (snap) return snap;
  return { state: "start", data: {}, updatedAt: Date.now() };
}

export async function saveSnapshot(
  clinicId: string,
  chatId: string | number,
  snap: FsmSnapshot,
): Promise<void> {
  const store = getStateStore();
  // Once in `done`, drop — next event will restart anyway.
  if (snap.state === "done") {
    await store.delete(stateKey(clinicId, chatId));
    return;
  }
  await store.set(stateKey(clinicId, chatId), snap, TTL_MS);
}

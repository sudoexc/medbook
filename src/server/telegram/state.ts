/**
 * Conversation FSM for the clinic Telegram bot.
 *
 * Simplified design (May 2026 rewrite):
 *   - On `/start` or the first message in a fresh chat, send a single bilingual
 *     welcome with a Mini App `web_app` button (when the clinic has a public
 *     HTTPS origin). Booking happens inside the Mini App.
 *   - Any subsequent message stays silent — the receptionist picks it up in
 *     the CRM Telegram inbox. No multi-step service/doctor/slot/name walks
 *     in chat.
 *
 * Why drop the language picker: Neurofax is bilingual by default (RU/UZ
 * Tashkent audience). Showing both languages in a single message removes a
 * tap and avoids the "wrong language stuck for 30min TTL" failure mode.
 *
 * States:
 *   start     — fresh chat (no snapshot yet, or TTL expired)
 *   welcomed  — already greeted; FSM stays silent until the snapshot expires
 *
 * Storage:
 *  - In-memory `Map` keyed by `${clinicId}:${chatId}`, 30-min TTL. Tests can
 *    swap in a custom store via `__setStateStoreForTests`.
 *
 * The FSM is framework-agnostic: `step(prev, event, catalog)` returns
 * `{next, outgoing}` where `outgoing` describes a message to send (text +
 * optional inline keyboard). The webhook glues this to `send.ts`.
 */

import type { TgInlineKeyboard } from "./send";
import type { BotLang } from "./messages";

export type FsmState = "start" | "welcomed";

export type FsmData = {
  /** Reserved — kept on snapshot for forward compat but unused by the
   * simplified flow (welcome is bilingual). */
  lang?: BotLang;
};

export type FsmSnapshot = {
  state: FsmState;
  data: FsmData;
  updatedAt: number;
};

export type FsmEvent =
  | { kind: "start"; payload?: string }
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

export type Catalog = {
  /**
   * HTTPS URL of the clinic's Mini App. When set, the welcome message
   * includes a `web_app` button. When `null`/absent, the welcome lands
   * without a button (text-only intro).
   */
  miniAppUrl?: string | null;
};

export const EMPTY_CATALOG: Catalog = {};

const WELCOME_TEXT = [
  "👋 Здравствуйте! Это клиника Neurofax.",
  "",
  "Если у вас есть вопросы — просто напишите сюда, регистратура свяжется с вами.",
  "",
  "Для записи на приём нажмите кнопку ниже.",
  "",
  "—",
  "",
  "👋 Assalomu alaykum! Bu Neurofax klinikasi.",
  "",
  "Savollar bo'lsa — shu yerga yozing, ro'yxatxona javob beradi.",
  "",
  "Qabulga yozilish uchun pastdagi tugmani bosing.",
].join("\n");

const WELCOME_BUTTON_TEXT = "📅 Записаться / Yozilish";

function now(): number {
  return Date.now();
}

/**
 * Pure transition. `prev` is the current FSM snapshot, `event` is the
 * incoming Telegram event, `catalog` carries the Mini App URL.
 */
export function step(
  prev: FsmSnapshot,
  event: FsmEvent,
  catalog: Catalog,
): FsmStep {
  const isStartCommand =
    event.kind === "start" ||
    (event.kind === "text" && event.text.trim() === "/start");

  if (isStartCommand || prev.state === "start") {
    return enterWelcome(catalog.miniAppUrl ?? null);
  }

  // Already welcomed: stay silent — operator handles it.
  return { next: prev, outgoing: null };
}

function enterWelcome(miniAppUrl: string | null): FsmStep {
  const replyMarkup = miniAppUrl
    ? {
        inline_keyboard: [
          [{ text: WELCOME_BUTTON_TEXT, web_app: { url: miniAppUrl } }],
        ],
      }
    : undefined;
  return {
    next: { state: "welcomed", data: {}, updatedAt: now() },
    outgoing: { text: WELCOME_TEXT, replyMarkup },
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
  await store.set(stateKey(clinicId, chatId), snap, TTL_MS);
}

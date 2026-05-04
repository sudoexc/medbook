/**
 * Tests for the simplified Telegram bot FSM (`src/server/telegram/state.ts`).
 *
 * The FSM now has only two states (start → welcomed). On `/start` or the
 * very first chat event the bot replies with a single bilingual welcome and
 * an optional `web_app` button; afterwards it stays silent until the
 * snapshot expires (30-min TTL).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __setStateStoreForTests,
  EMPTY_CATALOG,
  loadSnapshot,
  saveSnapshot,
  stateKey,
  step,
  type Catalog,
  type FsmSnapshot,
} from "@/server/telegram/state";

const MINI_APP_URL = "https://neurofax.uz/c/neurofax/my";
const CATALOG_WITH_MINIAPP: Catalog = { miniAppUrl: MINI_APP_URL };

function fresh(): FsmSnapshot {
  return { state: "start", data: {}, updatedAt: Date.now() };
}

function welcomed(): FsmSnapshot {
  return { state: "welcomed", data: {}, updatedAt: Date.now() };
}

describe("fsm.step (simplified welcome flow)", () => {
  it("greets on the first event with a web_app button when miniAppUrl is set", () => {
    const { next, outgoing } = step(
      fresh(),
      { kind: "start" },
      CATALOG_WITH_MINIAPP,
    );
    expect(next.state).toBe("welcomed");
    expect(outgoing?.text).toContain("Neurofax");
    // Bilingual: both RU and UZ greetings in the same message.
    expect(outgoing?.text).toContain("Здравствуйте");
    expect(outgoing?.text).toContain("Assalomu alaykum");
    const btn = outgoing?.replyMarkup?.inline_keyboard?.[0]?.[0];
    expect(btn?.web_app?.url).toBe(MINI_APP_URL);
  });

  it("greets on /start text from any state", () => {
    const { next, outgoing } = step(
      welcomed(),
      { kind: "text", text: "/start" },
      CATALOG_WITH_MINIAPP,
    );
    expect(next.state).toBe("welcomed");
    expect(outgoing?.text).toContain("Neurofax");
  });

  it("greets on first ever text even without /start", () => {
    const { next, outgoing } = step(
      fresh(),
      { kind: "text", text: "hi" },
      CATALOG_WITH_MINIAPP,
    );
    expect(next.state).toBe("welcomed");
    expect(outgoing?.text).toContain("Neurofax");
  });

  it("stays silent after welcoming on subsequent plain text", () => {
    const { next, outgoing } = step(
      welcomed(),
      { kind: "text", text: "у меня болит голова" },
      CATALOG_WITH_MINIAPP,
    );
    expect(next.state).toBe("welcomed");
    expect(outgoing).toBeNull();
  });

  it("stays silent on stray callback queries after welcoming", () => {
    const { next, outgoing } = step(
      welcomed(),
      { kind: "callback", data: "noop" },
      CATALOG_WITH_MINIAPP,
    );
    expect(next.state).toBe("welcomed");
    expect(outgoing).toBeNull();
  });

  it("welcome without miniAppUrl is text-only (no inline keyboard)", () => {
    const { next, outgoing } = step(fresh(), { kind: "start" }, EMPTY_CATALOG);
    expect(next.state).toBe("welcomed");
    expect(outgoing?.text).toContain("Neurofax");
    expect(outgoing?.replyMarkup).toBeUndefined();
  });
});

describe("store (in-memory)", () => {
  beforeEach(() => {
    __setStateStoreForTests(null);
  });
  afterEach(() => {
    __setStateStoreForTests(null);
  });

  it("saves and loads snapshots", async () => {
    const snap: FsmSnapshot = {
      state: "welcomed",
      data: {},
      updatedAt: Date.now(),
    };
    await saveSnapshot("clinic-1", 42, snap);
    const loaded = await loadSnapshot("clinic-1", 42);
    expect(loaded.state).toBe("welcomed");
  });

  it("returns a fresh `start` snapshot when nothing is stored", async () => {
    const loaded = await loadSnapshot("clinic-empty", 999);
    expect(loaded.state).toBe("start");
  });

  it("stateKey is clinic-scoped", () => {
    expect(stateKey("a", 1)).not.toBe(stateKey("b", 1));
  });
});

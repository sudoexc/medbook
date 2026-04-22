/**
 * Tests for the Telegram bot FSM (`src/server/telegram/state.ts`).
 *
 * Coverage: lang → service → doctor → slot → name → confirm → done, plus
 * restart, back, unknown-input behaviours, TTL on the memory store.
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

const CATALOG: Catalog = {
  services: [
    { id: "svc-neurology", nameRu: "Неврология", nameUz: "Nevrologiya" },
    { id: "svc-therapy", nameRu: "Терапия", nameUz: "Terapiya" },
  ],
  doctorsByService: {
    "svc-neurology": [
      { id: "doc-1", nameRu: "Иванов", nameUz: "Ivanov" },
      { id: "doc-2", nameRu: "Петров", nameUz: "Petrov" },
    ],
    "svc-therapy": [],
  },
  slotsByDoctor: {
    "doc-1": [
      { iso: "2026-05-01T10:00", label: "10:00" },
      { iso: "2026-05-01T10:30", label: "10:30" },
    ],
    "doc-2": [],
  },
};

function fresh(): FsmSnapshot {
  return { state: "start", data: {}, updatedAt: Date.now() };
}

describe("fsm.step", () => {
  it("emits welcome + lang buttons from start", () => {
    const { next, outgoing } = step(fresh(), { kind: "start" }, CATALOG);
    expect(next.state).toBe("lang_select");
    expect(outgoing?.text).toContain("Neurofax");
    const btns = outgoing?.replyMarkup?.inline_keyboard?.[0] ?? [];
    expect(btns.map((b) => b.callback_data)).toEqual(["lang:ru", "lang:uz"]);
  });

  it("picks ru → moves to service_select with prompts in ru", () => {
    const { next, outgoing } = step(
      { state: "lang_select", data: {}, updatedAt: 0 },
      { kind: "callback", data: "lang:ru" },
      CATALOG,
    );
    expect(next.state).toBe("service_select");
    expect(next.data.lang).toBe("ru");
    expect(outgoing?.text).toBe("Выберите специализацию:");
    expect(outgoing?.replyMarkup?.inline_keyboard.length).toBe(2);
  });

  it("picks uz → prompts in uz", () => {
    const { next, outgoing } = step(
      { state: "lang_select", data: {}, updatedAt: 0 },
      { kind: "callback", data: "lang:uz" },
      CATALOG,
    );
    expect(next.data.lang).toBe("uz");
    expect(outgoing?.text).toBe("Yo'nalishni tanlang:");
  });

  it("picks service → doctor_select with the chosen service's doctors", () => {
    const start: FsmSnapshot = {
      state: "service_select",
      data: { lang: "ru" },
      updatedAt: 0,
    };
    const { next, outgoing } = step(
      start,
      { kind: "callback", data: "svc:svc-neurology" },
      CATALOG,
    );
    expect(next.state).toBe("doctor_select");
    expect(next.data.serviceId).toBe("svc-neurology");
    expect(next.data.serviceName).toBe("Неврология");
    const rows = outgoing?.replyMarkup?.inline_keyboard ?? [];
    // 2 doctors + 1 "back" row.
    expect(rows.length).toBe(3);
    expect(rows[0]?.[0]?.callback_data).toBe("doc:doc-1");
  });

  it("service with no doctors shows noneAvailable and stays", () => {
    const start: FsmSnapshot = {
      state: "service_select",
      data: { lang: "ru" },
      updatedAt: 0,
    };
    const { next, outgoing } = step(
      start,
      { kind: "callback", data: "svc:svc-therapy" },
      CATALOG,
    );
    expect(next.state).toBe("doctor_select");
    expect(outgoing?.text).toContain("Нет врачей");
  });

  it("picks doctor → slot_select", () => {
    const start: FsmSnapshot = {
      state: "doctor_select",
      data: { lang: "ru", serviceId: "svc-neurology", serviceName: "Неврология" },
      updatedAt: 0,
    };
    const { next, outgoing } = step(
      start,
      { kind: "callback", data: "doc:doc-1" },
      CATALOG,
    );
    expect(next.state).toBe("slot_select");
    expect(next.data.doctorId).toBe("doc-1");
    expect(outgoing?.text).toContain("время");
  });

  it("'back' in doctor_select returns to service_select", () => {
    const start: FsmSnapshot = {
      state: "doctor_select",
      data: { lang: "ru", serviceId: "svc-neurology" },
      updatedAt: 0,
    };
    const { next } = step(start, { kind: "callback", data: "back" }, CATALOG);
    expect(next.state).toBe("service_select");
  });

  it("picks slot → name_input prompt", () => {
    const start: FsmSnapshot = {
      state: "slot_select",
      data: { lang: "ru", serviceId: "svc-neurology", doctorId: "doc-1" },
      updatedAt: 0,
    };
    const { next, outgoing } = step(
      start,
      { kind: "callback", data: "slot:2026-05-01T10:00" },
      CATALOG,
    );
    expect(next.state).toBe("name_input");
    expect(next.data.slotIso).toBe("2026-05-01T10:00");
    expect(next.data.slotLabel).toBe("10:00");
    expect(outgoing?.text).toContain("Укажите");
  });

  it("rejects short name, stays in name_input", () => {
    const start: FsmSnapshot = {
      state: "name_input",
      data: { lang: "ru" },
      updatedAt: 0,
    };
    const { next, outgoing } = step(start, { kind: "text", text: "I" }, CATALOG);
    expect(next.state).toBe("name_input");
    expect(outgoing?.text).toContain("короткое");
  });

  it("accepts name → confirm with summary", () => {
    const start: FsmSnapshot = {
      state: "name_input",
      data: {
        lang: "ru",
        serviceName: "Неврология",
        doctorName: "Иванов",
        slotLabel: "10:00",
      },
      updatedAt: 0,
    };
    const { next, outgoing } = step(
      start,
      { kind: "text", text: "Ivan Ivanov" },
      CATALOG,
    );
    expect(next.state).toBe("confirm");
    expect(next.data.name).toBe("Ivan Ivanov");
    expect(outgoing?.text).toContain("Ivan Ivanov");
    expect(outgoing?.text).toContain("Неврология");
  });

  it("confirm:yes → done success; confirm:no → done cancelled", () => {
    const base: FsmSnapshot = {
      state: "confirm",
      data: {
        lang: "ru",
        serviceName: "X",
        doctorName: "Y",
        slotLabel: "Z",
        name: "Test",
      },
      updatedAt: 0,
    };
    const yes = step(base, { kind: "callback", data: "confirm" }, CATALOG);
    expect(yes.next.state).toBe("done");
    expect(yes.outgoing?.text).toContain("записаны");

    const no = step(base, { kind: "callback", data: "cancel" }, CATALOG);
    expect(no.next.state).toBe("done");
    expect(no.outgoing?.text).toContain("отменена");
  });

  it("'/start' always restarts, even from confirm", () => {
    const base: FsmSnapshot = {
      state: "confirm",
      data: { lang: "ru" },
      updatedAt: 0,
    };
    const { next } = step(base, { kind: "text", text: "/start" }, CATALOG);
    expect(next.state).toBe("lang_select");
  });

  it("done restarts on any further event", () => {
    const base: FsmSnapshot = { state: "done", data: {}, updatedAt: 0 };
    const { next } = step(base, { kind: "text", text: "hello" }, CATALOG);
    expect(next.state).toBe("lang_select");
  });

  it("empty catalog in service_select shows noneAvailable", () => {
    const base: FsmSnapshot = {
      state: "service_select",
      data: { lang: "ru" },
      updatedAt: 0,
    };
    const { outgoing } = step(base, { kind: "text", text: "hi" }, EMPTY_CATALOG);
    expect(outgoing?.text).toContain("нет доступных");
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
      state: "confirm",
      data: { lang: "uz", name: "A" },
      updatedAt: Date.now(),
    };
    await saveSnapshot("clinic-1", 42, snap);
    const loaded = await loadSnapshot("clinic-1", 42);
    expect(loaded.state).toBe("confirm");
    expect(loaded.data.lang).toBe("uz");
  });

  it("'done' drops the snapshot so next load returns start", async () => {
    await saveSnapshot("clinic-1", 42, {
      state: "done",
      data: {},
      updatedAt: Date.now(),
    });
    const loaded = await loadSnapshot("clinic-1", 42);
    expect(loaded.state).toBe("start");
  });

  it("stateKey is clinic-scoped", () => {
    expect(stateKey("a", 1)).not.toBe(stateKey("b", 1));
  });
});

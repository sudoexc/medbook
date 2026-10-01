/**
 * One active template per automatic message, and an editor that binds
 * templates to the events the dispatcher really fires.
 *
 *   TG-22  saving a template switches its slot rivals off; the widget's
 *          switch acts on the whole event; a widget row created next to an
 *          active template starts off;
 *   TG-25  the event catalog matches the dispatcher (enum + offset /
 *          audience), the update schema no longer rewrites `trigger` to
 *          MANUAL on every PATCH, the editor's events have labels in both
 *          languages.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import { ALLOWED_KEYS_BY_TRIGGER } from "@/server/notifications/template";
import {
  TEMPLATE_EVENTS,
  eventOfTemplate,
  templateSlot,
} from "@/server/notifications/template-events";
import { retireSlotRivals, type TemplateSlotDb } from "@/server/notifications/template-slot";
import { CreateTemplateSchema, UpdateTemplateSchema } from "@/server/schemas/notification";

type Row = Record<string, unknown>;

const store = vi.hoisted(() => ({ templates: [] as Array<Record<string, unknown>> }));

function memDb(): TemplateSlotDb {
  const match = (t: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as Row)) {
        return ((v as { in: unknown[] }).in).includes(t[k]);
      }
      if (v && typeof v === "object" && "not" in (v as Row)) return t[k] !== (v as Row).not;
      return t[k] === v;
    });
  return {
    notificationTemplate: {
      findUnique: async ({ where }) => store.templates.find((t) => t.id === where.id) ?? null,
      findMany: async ({ where }) => store.templates.filter((t) => match(t, where)),
      updateMany: async ({ where, data }) => {
        const hit = store.templates.filter((t) => match(t, where));
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      },
    },
  };
}

function tpl(id: string, over: Row): Row {
  return { id, clinicId: "c1", key: id, trigger: "MANUAL", triggerConfig: null, isActive: true, ...over };
}

beforeEach(() => {
  store.templates = [];
});

describe("templateSlot / eventOfTemplate (TG-22, TG-25)", () => {
  it("identifies a template by what the dispatcher matches on, not its key", () => {
    expect(templateSlot({ key: "reminder.24h", trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 } })).toBe(
      "APPOINTMENT_BEFORE:-1440",
    );
    expect(templateSlot({ key: "x", trigger: "APPOINTMENT_CANCELLED", triggerConfig: { audience: "staff" } })).toBe(
      "APPOINTMENT_CANCELLED:staff",
    );
    expect(templateSlot({ key: "x", trigger: "APPOINTMENT_CANCELLED", triggerConfig: {} })).toBe(
      "APPOINTMENT_CANCELLED:any",
    );
    // Slug fallbacks the dispatcher honours.
    expect(templateSlot({ key: "appointment.thank-you", trigger: "MANUAL", triggerConfig: null })).toBe(
      "APPOINTMENT_COMPLETED",
    );
    expect(templateSlot({ key: "reminder.feedback", trigger: "APPOINTMENT_COMPLETED", triggerConfig: null })).toBe(
      "APPOINTMENT_COMPLETED",
    );
    // Broadcast texts and worker templates: any number may be active.
    expect(templateSlot({ key: "promo", trigger: "MANUAL", triggerConfig: null })).toBeNull();
    expect(templateSlot({ key: "medication.reminder", trigger: "CRON", triggerConfig: null })).toBeNull();
  });

  it("maps a stored template back to its catalog event; a custom offset has none", () => {
    expect(
      eventOfTemplate({ key: "reminder.24h", trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 } })?.id,
    ).toBe("appointment.reminder-24h");
    expect(
      eventOfTemplate({ key: "r", trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -600 } }),
    ).toBeNull();
  });

  it("gives every catalog event a placeholder set and a label and timing in ru and uz", () => {
    const n = (m: unknown) => (m as { notifications: { triggers: Record<string, Record<string, string>> } }).notifications.triggers;
    for (const e of TEMPLATE_EVENTS) {
      expect(ALLOWED_KEYS_BY_TRIGGER[e.placeholders], e.id).toBeDefined();
      for (const msgs of [ru, uz]) {
        expect(n(msgs).events[e.label], `${e.id} label`).toBeTruthy();
        expect(n(msgs).timing[e.timing], `${e.id} timing`).toBeTruthy();
      }
    }
  });
});

describe("retireSlotRivals (TG-22)", () => {
  it("saving the widget's 24h reminder switches the onboarding one off", async () => {
    store.templates = [
      tpl("onboarding", { key: "reminder.24h", trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 } }),
      tpl("widget", { key: "appointment.reminder-24h", trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 } }),
      tpl("three", { trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -180 } }),
      tpl("other-clinic", { clinicId: "c2", trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 } }),
    ];
    expect(await retireSlotRivals(memDb(), "widget")).toEqual(["onboarding"]);
    const active = store.templates.filter((t) => t.isActive).map((t) => t.id);
    expect(active).toEqual(["widget", "three", "other-clinic"]);
  });

  it("leaves rivals alone for a switched-off template or a broadcast text", async () => {
    store.templates = [
      tpl("a", { trigger: "APPOINTMENT_RESCHEDULED", isActive: false }),
      tpl("b", { trigger: "APPOINTMENT_RESCHEDULED" }),
      tpl("promo1", {}),
      tpl("promo2", {}),
    ];
    expect(await retireSlotRivals(memDb(), "a")).toEqual([]);
    expect(await retireSlotRivals(memDb(), "promo1")).toEqual([]);
    expect(store.templates.filter((t) => t.isActive).map((t) => t.id)).toEqual(["b", "promo1", "promo2"]);
  });
});

describe("template schemas (TG-25)", () => {
  it("a PATCH no longer comes back with trigger MANUAL", () => {
    expect(UpdateTemplateSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it("a template can be created for any catalog event", () => {
    for (const e of TEMPLATE_EVENTS) {
      const r = CreateTemplateSchema.safeParse({
        key: e.id,
        nameRu: "n",
        nameUz: "n",
        channel: "TG",
        category: "REMINDER",
        bodyRu: "b",
        bodyUz: "b",
        trigger: e.trigger,
        triggerConfig: e.triggerConfig,
      });
      expect(r.success, e.id).toBe(true);
    }
    const manual = CreateTemplateSchema.parse({
      key: "promo",
      nameRu: "n",
      nameUz: "n",
      channel: "TG",
      category: "MARKETING",
      bodyRu: "b",
      bodyUz: "b",
    });
    expect(manual.trigger).toBe("MANUAL");
  });
});

// ── the «Авто-сообщения» widget ────────────────────────────────────────────

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
const live = vi.hoisted(() => ({ key: null as string | null }));
vi.mock("@/server/notifications/triggers", () => ({
  findActiveTemplateFor: vi.fn(async () => (live.key ? { templateId: live.key, key: live.key } : null)),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationTemplate: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        store.templates.filter((t) => {
          if (t.clinicId !== where.clinicId) return false;
          if (where.isActive !== undefined && t.isActive !== where.isActive) return false;
          const keys = (where.key as { in?: string[] } | undefined)?.in;
          return keys ? keys.includes(t.key as string) : true;
        }),
      ),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        for (const d of data) store.templates.push({ id: d.key, ...d });
        return { count: data.length };
      }),
    },
  },
}));

describe("auto-messages widget (TG-22)", () => {
  it("a widget row created next to an active 24h template starts switched off", async () => {
    const { ensureAutoMessageTemplates } = await import("@/server/notifications/auto-messages");
    store.templates = [
      tpl("reminder.24h", { key: "reminder.24h", trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 } }),
    ];
    await ensureAutoMessageTemplates("c1");
    const byKey = new Map(store.templates.map((t) => [t.key, t]));
    expect(byKey.get("appointment.reminder-24h")?.isActive).toBe(false);
    // Nothing else holds «Спасибо за визит» or the greeting: those start on.
    expect(byKey.get("appointment.thank-you")?.isActive).toBe(true);
    expect(byKey.get("patient.welcome")?.isActive).toBe(true);
  });

  it("shows and edits the template the dispatcher really sends", async () => {
    const { autoMessageTemplateKey } = await import("@/server/notifications/auto-messages");
    live.key = "reminder.24h";
    expect(await autoMessageTemplateKey("c1", "reminder")).toBe("reminder.24h");
    live.key = null;
    expect(await autoMessageTemplateKey("c1", "reminder")).toBe("appointment.reminder-24h");
    expect(await autoMessageTemplateKey("c1", "welcome")).toBe("patient.welcome");
  });

  it("switched off, no template of the event keeps sending; on, exactly one does", async () => {
    const { applyAutoMessageSwitch } = await import("@/server/notifications/auto-messages");
    const both = () => [
      tpl("seed", { key: "reminder.feedback", trigger: "APPOINTMENT_COMPLETED" }),
      tpl("widget", { key: "appointment.thank-you", trigger: "APPOINTMENT_COMPLETED" }),
    ];
    store.templates = both();
    store.templates[1]!.isActive = false;
    await applyAutoMessageSwitch(memDb(), "widget", false);
    expect(store.templates.filter((t) => t.isActive)).toEqual([]);

    store.templates = both();
    await applyAutoMessageSwitch(memDb(), "widget", true);
    expect(store.templates.filter((t) => t.isActive).map((t) => t.id)).toEqual(["widget"]);
  });
});

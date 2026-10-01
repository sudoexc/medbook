/**
 * The events a template can be bound to, as the dispatcher really looks them
 * up (audit TG-22, TG-25). Client-safe: no server imports.
 *
 * The dispatcher (`whereForTrigger` in triggers.ts) finds a template by its
 * `trigger` enum plus `triggerConfig` (the band's `offsetMin`, the
 * cancellation `audience`), never by `key`. The template editor used to offer
 * only a key, so every template it created was MANUAL and never fired, and
 * the «Триггеры» panel matched templates by key and called events that do go
 * out «нужен шаблон». This catalog is the one list both read.
 *
 * A *slot* is «which automatic message this template is»: at most one active
 * template per slot and clinic. Two active rows in one slot (the onboarding
 * `reminder.24h` and the widget's `appointment.reminder-24h`, both -1440) made
 * the dispatcher pick one at random, so the widget's switch and text could
 * have no effect. Saving a template now switches its slot rivals off
 * (`retireSlotRivals`), and the pick order is fixed (`TEMPLATE_PICK_ORDER`).
 */

export type TemplateEventId =
  | "appointment.created"
  | "appointment.reminder-5d"
  | "appointment.reminder-3d"
  | "appointment.reminder-24h"
  | "appointment.reminder-3h"
  | "appointment.cancelled.by-staff"
  | "appointment.cancelled.by-patient"
  | "appointment.rescheduled"
  | "appointment.running-late"
  | "appointment.no-show"
  | "appointment.thank-you"
  | "birthday"
  | "case.repeat-due";

export type TemplateEvent = {
  id: TemplateEventId;
  /** `notifications.triggers.events.<label>` and `.timing.<timing>`. */
  label: string;
  timing: string;
  trigger:
    | "APPOINTMENT_CREATED"
    | "APPOINTMENT_BEFORE"
    | "APPOINTMENT_CANCELLED"
    | "APPOINTMENT_RESCHEDULED"
    | "APPOINTMENT_RUNNING_LATE"
    | "APPOINTMENT_MISSED"
    | "APPOINTMENT_COMPLETED"
    | "PATIENT_BIRTHDAY"
    | "CASE_REPEAT_DUE";
  triggerConfig: Record<string, unknown> | null;
  /** Key of `ALLOWED_KEYS_BY_TRIGGER` whose placeholders the body may use. */
  placeholders: string;
};

/** Every event the dispatcher fires on its own, in the panel's order. */
export const TEMPLATE_EVENTS: readonly TemplateEvent[] = [
  {
    id: "appointment.created",
    label: "created",
    timing: "immediate",
    trigger: "APPOINTMENT_CREATED",
    triggerConfig: null,
    placeholders: "appointment.created",
  },
  {
    id: "appointment.reminder-5d",
    label: "reminder5d",
    timing: "before5d",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -7200 },
    placeholders: "appointment.reminder-24h",
  },
  {
    id: "appointment.reminder-3d",
    label: "reminder3d",
    timing: "before3d",
    trigger: "APPOINTMENT_BEFORE",
    // The band that asks to confirm: dropped for a confirmed visit.
    triggerConfig: { offsetMin: -4320, skipIfConfirmed: true },
    placeholders: "appointment.reminder-24h",
  },
  {
    id: "appointment.reminder-24h",
    label: "reminder24h",
    timing: "before24h",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -1440 },
    placeholders: "appointment.reminder-24h",
  },
  {
    id: "appointment.reminder-3h",
    label: "reminder3h",
    timing: "before3h",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -180 },
    placeholders: "appointment.reminder-24h",
  },
  {
    id: "appointment.cancelled.by-staff",
    label: "cancelledByStaff",
    timing: "immediate",
    trigger: "APPOINTMENT_CANCELLED",
    triggerConfig: { audience: "staff" },
    placeholders: "appointment.cancelled",
  },
  {
    id: "appointment.cancelled.by-patient",
    label: "cancelledByPatient",
    timing: "immediate",
    trigger: "APPOINTMENT_CANCELLED",
    triggerConfig: { audience: "patient" },
    placeholders: "appointment.cancelled",
  },
  {
    id: "appointment.rescheduled",
    label: "rescheduled",
    timing: "immediate",
    trigger: "APPOINTMENT_RESCHEDULED",
    triggerConfig: null,
    placeholders: "appointment.created",
  },
  {
    id: "appointment.running-late",
    label: "runningLate",
    timing: "late",
    trigger: "APPOINTMENT_RUNNING_LATE",
    triggerConfig: null,
    placeholders: "appointment.created",
  },
  {
    id: "appointment.no-show",
    label: "noShow",
    timing: "noShow",
    trigger: "APPOINTMENT_MISSED",
    triggerConfig: null,
    placeholders: "no-show",
  },
  {
    id: "appointment.thank-you",
    label: "thankYou",
    timing: "thankYou",
    trigger: "APPOINTMENT_COMPLETED",
    triggerConfig: null,
    placeholders: "appointment.thank-you",
  },
  {
    id: "birthday",
    label: "birthday",
    timing: "birthday",
    trigger: "PATIENT_BIRTHDAY",
    triggerConfig: null,
    placeholders: "birthday",
  },
  {
    id: "case.repeat-due",
    label: "caseRepeat",
    timing: "caseRepeat",
    trigger: "CASE_REPEAT_DUE",
    triggerConfig: { daysBefore: 2 },
    placeholders: "case.repeat-due",
  },
];

/**
 * Which template wins when one slot still holds several (rows saved before
 * the rivals were switched off): the one an admin touched last. Every reader
 * that picks «the» template of a slot uses this order, so the dispatcher,
 * the daily passes and the widget agree.
 */
export const TEMPLATE_PICK_ORDER = [
  { updatedAt: "desc" as const },
  { id: "asc" as const },
];

type SlotShape = {
  trigger: string;
  triggerConfig: unknown;
  key: string;
};

function cfgOf(triggerConfig: unknown): Record<string, unknown> {
  return triggerConfig && typeof triggerConfig === "object" && !Array.isArray(triggerConfig)
    ? (triggerConfig as Record<string, unknown>)
    : {};
}

/** Triggers with exactly one message per event. */
const ONE_PER_EVENT = new Set([
  "APPOINTMENT_CREATED",
  "APPOINTMENT_RESCHEDULED",
  "APPOINTMENT_RUNNING_LATE",
  "APPOINTMENT_MISSED",
  "APPOINTMENT_COMPLETED",
  "PATIENT_BIRTHDAY",
  "CASE_REPEAT_DUE",
]);

/**
 * The slot a template occupies, or null when any number may be active
 * (MANUAL broadcast texts, worker templates found by their unique key).
 * Mirrors `whereForTrigger`, slug fallbacks included: a MANUAL row keyed
 * `appointment.thank-you` is picked for completed visits too.
 */
export function templateSlot(tpl: SlotShape): string | null {
  const cfg = cfgOf(tpl.triggerConfig);
  switch (tpl.trigger) {
    case "APPOINTMENT_BEFORE": {
      const off = cfg.offsetMin;
      return typeof off === "number" && Number.isFinite(off)
        ? `APPOINTMENT_BEFORE:${Math.round(off)}`
        : null;
    }
    case "APPOINTMENT_CANCELLED": {
      const audience =
        cfg.audience === "staff" || cfg.audience === "patient" ? cfg.audience : "any";
      return `APPOINTMENT_CANCELLED:${audience}`;
    }
    default:
      if (ONE_PER_EVENT.has(tpl.trigger)) return tpl.trigger;
  }
  switch (tpl.key) {
    case "appointment.thank-you":
      return "APPOINTMENT_COMPLETED";
    case "appointment.rescheduled":
      return "APPOINTMENT_RESCHEDULED";
    case "appointment.cancelled":
      return "APPOINTMENT_CANCELLED:any";
    default:
      return null;
  }
}

/** The catalog event a template is bound to, or null (manual, custom time). */
export function eventOfTemplate(tpl: SlotShape): TemplateEvent | null {
  const slot = templateSlot(tpl);
  if (!slot) return null;
  return TEMPLATE_EVENTS.find((e) => templateSlot({ ...e, key: "" }) === slot) ?? null;
}

export function templateEventById(id: string): TemplateEvent | null {
  return TEMPLATE_EVENTS.find((e) => e.id === id) ?? null;
}

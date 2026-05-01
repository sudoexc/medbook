/**
 * Helpers for the Phase 8b/c notification template + rules editor.
 *
 * This module is the *bridge* between:
 *   - the persistent NotificationTemplate row (DB enum + triggerConfig Json)
 *   - the "logical" TriggerKey strings used by the placeholder whitelist in
 *     `src/server/notifications/template.ts` (ALLOWED_KEYS_BY_TRIGGER).
 *
 * The triggers.ts file is intentionally not modified (it's the stable
 * idempotent core), so this module recomputes the same trigger mapping
 * read-only for the editor and for the dynamic-rules pass in the scheduler.
 */
import { ALLOWED_KEYS_BY_TRIGGER } from "./template";

export type LogicalTriggerKey =
  | "appointment.created"
  | "appointment.reminder-24h"
  | "appointment.reminder-2h"
  | "appointment.cancelled"
  | "birthday"
  | "no-show"
  | "payment.due"
  | "manual";

export type TriggerConfigShape = {
  /**
   * Negative integer minutes — how long before the appointment to fire.
   * Only meaningful for `APPOINTMENT_BEFORE` templates. Other triggers
   * ignore the value.
   */
  offsetMin?: number | null;
  /**
   * Channels to use, in order of preference. If unset, the legacy single
   * `template.channel` column is used (TG → SMS fallback by default).
   */
  channels?: Array<"TG" | "SMS"> | null;
  /**
   * If set to `false`, the materializer skips the template even though
   * `template.isActive=true`. We keep this separate so an admin can
   * temporarily disable a single trigger without blowing away the row.
   * The current scheduler honors `template.isActive`; the UI writes both
   * for safety.
   */
  enabled?: boolean | null;
  /**
   * For PATIENT_INACTIVE_DAYS templates — kept here to round-trip seed data
   * through the editor without dropping unknown keys.
   */
  days?: number | null;
};

/**
 * Map (trigger enum, triggerConfig.offsetMin, key) → the logical key used
 * by ALLOWED_KEYS_BY_TRIGGER. Returns "manual" as the safe fallback.
 */
export function logicalTriggerKey(
  trigger: string,
  triggerConfig: unknown,
  key: string,
): LogicalTriggerKey {
  // Slug-based fallbacks — match the same convention as
  // `whereForTrigger` in triggers.ts.
  if (key === "appointment.cancelled") return "appointment.cancelled";
  if (key === "payment.due") return "payment.due";

  const cfg =
    triggerConfig && typeof triggerConfig === "object"
      ? (triggerConfig as TriggerConfigShape)
      : {};

  switch (trigger) {
    case "APPOINTMENT_CREATED":
      return "appointment.created";
    case "APPOINTMENT_BEFORE": {
      const off = typeof cfg.offsetMin === "number" ? cfg.offsetMin : null;
      // Anything in the [-180, -60] band → 2h slot; otherwise 24h slot.
      if (off !== null && off > -180 && off <= -60) {
        return "appointment.reminder-2h";
      }
      return "appointment.reminder-24h";
    }
    case "APPOINTMENT_MISSED":
      return "no-show";
    case "PATIENT_BIRTHDAY":
      return "birthday";
    default:
      return "manual";
  }
}

/**
 * Return the placeholder whitelist for a logical trigger. `manual` returns
 * the union of every other whitelist (so manual templates can use any
 * known placeholder).
 */
export function allowedKeysFor(logical: LogicalTriggerKey): string[] {
  if (logical === "manual") {
    const all = new Set<string>();
    for (const arr of Object.values(ALLOWED_KEYS_BY_TRIGGER)) {
      for (const k of arr) all.add(k);
    }
    return [...all];
  }
  return ALLOWED_KEYS_BY_TRIGGER[logical] ?? [];
}

/**
 * Resolve the channel(s) the materializer should use for a template, in
 * preference order. Defaulting rule:
 *   - if `triggerConfig.channels` is a non-empty array → use it as-is
 *   - else fall back to single `template.channel`
 *   - if patient has no telegramId, demote TG to the end
 */
export function resolveChannels(
  templateChannel: string,
  triggerConfig: unknown,
  patient: { telegramId: string | null },
): Array<"TG" | "SMS" | "EMAIL" | "CALL" | "VISIT"> {
  const cfg =
    triggerConfig && typeof triggerConfig === "object"
      ? (triggerConfig as TriggerConfigShape)
      : {};
  const fromConfig = Array.isArray(cfg.channels) ? cfg.channels : null;

  let chosen: Array<"TG" | "SMS" | "EMAIL" | "CALL" | "VISIT">;
  if (fromConfig && fromConfig.length > 0) {
    chosen = [...fromConfig];
  } else {
    chosen = [templateChannel as "TG" | "SMS" | "EMAIL" | "CALL" | "VISIT"];
  }

  // If the patient has no telegramId, prefer SMS over TG by reordering.
  if (!patient.telegramId) {
    chosen.sort((a, b) => {
      if (a === "TG" && b !== "TG") return 1;
      if (b === "TG" && a !== "TG") return -1;
      return 0;
    });
  }
  return chosen;
}

/**
 * Return whether the template is operationally enabled. The UI may set
 * `triggerConfig.enabled=false` to temporarily disable a row without
 * toggling `isActive`. The materializer should AND both flags.
 */
export function isTriggerEnabled(
  isActive: boolean,
  triggerConfig: unknown,
): boolean {
  if (!isActive) return false;
  const cfg =
    triggerConfig && typeof triggerConfig === "object"
      ? (triggerConfig as TriggerConfigShape)
      : {};
  return cfg.enabled !== false;
}

/**
 * Read offsetMin from triggerConfig with a safe fallback. Returns the
 * resolved value in minutes (negative integer for "before" triggers).
 */
export function resolveOffsetMin(
  triggerConfig: unknown,
  fallbackMinutes: number,
): number {
  const cfg =
    triggerConfig && typeof triggerConfig === "object"
      ? (triggerConfig as TriggerConfigShape)
      : {};
  if (typeof cfg.offsetMin === "number" && Number.isFinite(cfg.offsetMin)) {
    return Math.round(cfg.offsetMin);
  }
  return fallbackMinutes;
}

/**
 * Validate a triggerConfig payload coming from the editor. Returns a
 * cleaned object suitable for Prisma persistence.
 *
 * Rules:
 *   - offsetMin is clamped to the [-72*60, -30] minute range (i.e. 0.5h to 72h
 *     before the event); UI provides 0.5h step.
 *   - channels is restricted to ["TG","SMS"]; duplicates are de-duped.
 *   - enabled is coerced to boolean; default true.
 *
 * Unknown keys are preserved so the editor can round-trip future fields
 * without deletion.
 */
export function sanitizeTriggerConfig(
  raw: unknown,
  opts: { kind: "before" | "other" },
): Record<string, unknown> {
  const incoming =
    raw && typeof raw === "object"
      ? ({ ...(raw as Record<string, unknown>) })
      : {};
  if (opts.kind === "before") {
    const off =
      typeof incoming.offsetMin === "number"
        ? Math.round(incoming.offsetMin)
        : null;
    if (off !== null) {
      // clamp to [-72*60, -30] minutes
      const clamped = Math.max(-72 * 60, Math.min(-30, off));
      incoming.offsetMin = clamped;
    } else if (typeof incoming.offsetMin === "string") {
      const parsed = parseInt(incoming.offsetMin, 10);
      if (Number.isFinite(parsed)) {
        incoming.offsetMin = Math.max(-72 * 60, Math.min(-30, parsed));
      } else {
        delete incoming.offsetMin;
      }
    }
  }

  if (Array.isArray(incoming.channels)) {
    const allowed: Array<"TG" | "SMS"> = [];
    const seen = new Set<string>();
    for (const c of incoming.channels) {
      if (typeof c !== "string") continue;
      if (c !== "TG" && c !== "SMS") continue;
      if (seen.has(c)) continue;
      seen.add(c);
      allowed.push(c);
    }
    if (allowed.length === 0) {
      delete incoming.channels;
    } else {
      incoming.channels = allowed;
    }
  } else if ("channels" in incoming) {
    delete incoming.channels;
  }

  if ("enabled" in incoming) {
    incoming.enabled = Boolean(incoming.enabled);
  }

  return incoming;
}

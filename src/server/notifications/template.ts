/**
 * Notification template engine.
 *
 * Supports `{{path.to.value}}` placeholder substitution with HTML-escape
 * (defence-in-depth — TG/SMS aren't HTML, but escape keeps accidental
 * injection safe if the body ever gets rendered as HTML in the UI preview).
 *
 * Placeholder format: `{{a.b.c}}` — whitespace around the expression is
 * tolerated. Missing keys are rendered as empty string (no crash) and
 * reported via `renderWithReport`.
 *
 * See docs/TZ.md §6.9.5 and progress log Phase 3a.
 */

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export type TemplateContext = Record<string, unknown>;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function get(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Substitute `{{path}}` with context values. All values are HTML-escaped.
 *
 * @param template Body string with `{{foo.bar}}` placeholders.
 * @param context  Nested object whose leaves are the placeholder values.
 */
export function render(template: string, context: TemplateContext): string {
  return template.replace(PLACEHOLDER_RE, (_full, key: string) => {
    const raw = get(context, key);
    return escapeHtml(stringify(raw));
  });
}

export type RenderReport = {
  output: string;
  missing: string[];
  placeholders: string[];
};

/**
 * Same as `render`, but also returns a report of which placeholders were
 * missing from the context (undefined or null). Useful for "template lint"
 * in the editor preview.
 */
export function renderWithReport(
  template: string,
  context: TemplateContext
): RenderReport {
  const placeholders = new Set<string>();
  const missing = new Set<string>();
  const output = template.replace(PLACEHOLDER_RE, (_full, key: string) => {
    placeholders.add(key);
    const raw = get(context, key);
    if (raw === undefined || raw === null) missing.add(key);
    return escapeHtml(stringify(raw));
  });
  return {
    output,
    placeholders: [...placeholders],
    missing: [...missing],
  };
}

/**
 * Extract placeholder keys from a template (without rendering).
 */
export function extractPlaceholders(template: string): string[] {
  const seen = new Set<string>();
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen];
}

/**
 * Validate a template against a whitelist of allowed keys. Returns the
 * subset of placeholders that are NOT in the whitelist.
 */
export function validate(template: string, allowedKeys: string[]): {
  ok: boolean;
  unknown: string[];
  placeholders: string[];
} {
  const placeholders = extractPlaceholders(template);
  const allow = new Set(allowedKeys);
  const unknown = placeholders.filter((p) => !allow.has(p));
  return { ok: unknown.length === 0, unknown, placeholders };
}

/**
 * Canonical whitelist of context keys by trigger. This is the single
 * source of truth for the template editor's placeholder-hint dropdown and
 * for the server-side validator.
 *
 * Keep in sync with `buildContext` in `triggers.ts`.
 */
export const ALLOWED_KEYS_BY_TRIGGER: Record<string, string[]> = {
  "appointment.created": [
    "patient.name",
    "patient.phone",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "appointment.service",
    "appointment.cabinet",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  "appointment.reminder-24h": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "appointment.service",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  "appointment.reminder-5h": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "appointment.service",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  "appointment.reminder-2h": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  "appointment.cancelled": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
  ],
  birthday: [
    "patient.name",
    "patient.firstName",
    "clinic.name",
    "clinic.phone",
  ],
  "no-show": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
  ],
  "payment.due": [
    "patient.name",
    "patient.firstName",
    "payment.amount",
    "payment.currency",
    "appointment.date",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
  ],
  "case.repeat-due": [
    "patient.name",
    "patient.firstName",
    "case.daysLeft",
    "case.deadline",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  // Phase 14 — Revenue Engines, Wave 2.
  // Whitelist kept minimal: subject + body templates only need patient name
  // and clinic identification. Specific lapse details (segment, days since
  // last visit) stay server-side — they're segmentation criteria, not
  // patient-facing copy.
  "patient.reactivation": [
    "patient.name",
    "patient.firstName",
    "clinic.name",
    "clinic.phone",
    "clinic.address",
  ],
  // Phase 16 Wave 2 — Patient Experience.
  // Pre-visit questionnaire: tells the patient when their appointment is +
  // who they're seeing, plus a deeplink (rendered server-side as the body
  // text — `appointment.url` placeholder is not a context key today; the
  // template just hard-codes the path so we keep the whitelist simple).
  "appointment.pre-visit-questionnaire": [
    "patient.name",
    "patient.firstName",
    "appointment.date",
    "appointment.time",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
  ],
  // Post-visit NPS request: just the doctor name + clinic — short copy with
  // a deeplink to the rating form.
  "appointment.nps-request": [
    "patient.name",
    "patient.firstName",
    "appointment.doctor",
    "clinic.name",
    "clinic.phone",
  ],
  // Phase 16 Wave 3 — Medication reminder push.
  // Worker fills `drug.name`, `drug.dosage`, `time` (HH:mm clinic-TZ) and
  // `deeplink` (Mini App `/my/medications` URL). `clinic.name` is included
  // for templates that want a sender prefix — usable but optional.
  "medication.reminder": [
    "patient.name",
    "patient.firstName",
    "drug.name",
    "drug.dosage",
    "time",
    "deeplink",
    "clinic.name",
  ],
  // Refer-a-friend reward earned: notifies the referrer that their referred
  // friend completed a visit and a discount has been minted on their next
  // booking. `friend.name` carries the referred patient's first name (or
  // full name if a single-token alias). `percent` is the snapshot integer
  // (e.g. 15 for 15%).
  "referral.reward-earned": [
    "patient.name",
    "patient.firstName",
    "friend.name",
    "percent",
    "clinic.name",
  ],
};

export const TRIGGER_KEYS = Object.keys(ALLOWED_KEYS_BY_TRIGGER);

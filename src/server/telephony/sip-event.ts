/**
 * The SIP webhook's input rules (audit CM-01), kept out of the route module
 * so they can be tested on their own.
 *
 *   - `timestamp` is an ISO 8601 instant WITH a time zone (`Z` or `+05:00`)
 *     or unix SECONDS (a number or a digit string, fractions allowed).
 *     `z.coerce.date()` read a number as milliseconds, so the unix seconds
 *     most PBXes send landed in January 1970, and an ISO string without a
 *     zone was read in the server's zone (UTC in production), five hours off
 *     the clinic clock. A millisecond value is refused rather than guessed.
 *   - The secret travels only in the `x-sip-secret` header and is compared
 *     in constant time over fixed-length digests: a `?secret=` query string
 *     ends up in nginx access logs, and the old loop returned early on a
 *     length mismatch, which told an attacker the secret's length.
 *   - `operatorId` from the PBX is usually an internal extension («101»),
 *     not a CRM user id. The clinic's SIP connection may map extensions to
 *     users (`config.extensions = { "101": "<userId>" }`); whatever the PBX
 *     sends is then accepted only if it names an active user of this clinic.
 *     An unknown operator leaves the call without one instead of failing the
 *     insert on the foreign key and losing the event.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/** Largest value read as unix seconds: year 5138. Anything above is ms. */
const MAX_UNIX_SECONDS = 1e11;

/** ISO 8601 date-time that states its zone. */
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

export function parseProviderTimestamp(value: unknown): Date | null {
  if (typeof value === "number") {
    return fromUnixSeconds(value);
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(raw)) return fromUnixSeconds(Number(raw));
  if (!ISO_WITH_ZONE.test(raw)) return null;
  const ms = Date.parse(raw.replace(" ", "T"));
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function fromUnixSeconds(n: number): Date | null {
  if (!Number.isFinite(n) || n <= 0 || n >= MAX_UNIX_SECONDS) return null;
  return new Date(Math.round(n * 1000));
}

const ProviderTimestamp = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const parsed = parseProviderTimestamp(value);
    if (!parsed) {
      ctx.addIssue({
        code: "custom",
        message:
          "timestamp must be ISO 8601 with a time zone or unix seconds",
      });
      return z.NEVER;
    }
    return parsed;
  });

export const SipEventKind = z.enum(["ringing", "answered", "hangup", "missed"]);

export const SipEventSchema = z.object({
  kind: SipEventKind,
  callId: z.string().trim().min(1).max(200),
  from: z.string().trim().min(1).max(64),
  to: z.string().trim().min(1).max(64),
  timestamp: ProviderTimestamp,
  operatorId: z.string().trim().max(200).optional().nullable(),
  // Played back from the call card: http(s) only, never `javascript:`.
  recordingUrl: z
    .string()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), {
      message: "recordingUrl must be http(s)",
    })
    .optional()
    .nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type SipEvent = z.infer<typeof SipEventSchema>;

/** Constant-time secret check that does not reveal the secret's length. */
export function sipSecretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * The extension map of the clinic's SIP connection
 * (`config.extensions`), string values only.
 */
export function readExtensionMap(config: unknown): Record<string, string> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const raw = (config as Record<string, unknown>).extensions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [ext, userId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof userId === "string" && userId.length > 0) out[ext] = userId;
  }
  return out;
}

/**
 * The user id an event's `operatorId` stands for, before it is checked
 * against the clinic's users: the mapped user for a known extension,
 * otherwise the value itself (a PBX configured with CRM user ids).
 */
export function operatorCandidate(
  operatorId: string | null | undefined,
  extensions: Record<string, string>,
): string | null {
  const raw = operatorId?.trim();
  if (!raw) return null;
  return Object.prototype.hasOwnProperty.call(extensions, raw)
    ? extensions[raw]!
    : raw;
}

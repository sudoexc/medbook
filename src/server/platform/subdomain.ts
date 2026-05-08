/**
 * Phase 19 Wave 4 — custom-subdomain validator.
 *
 * Pure helpers, no DB access — uniqueness is enforced by the
 * `Clinic.customSubdomain @unique` index plus a pre-flight `findUnique`
 * lookup in the PATCH route. The regex matches the spec verbatim:
 *
 *   ^[a-z0-9-]{3,32}$ — kebab-case, ASCII only, no leading/trailing dash.
 *
 * Reserved labels are blocked because they collide with infrastructure
 * subdomains; adding to the list later is a deploy-only change.
 */
import { z } from "zod";

export const SUBDOMAIN_REGEX = /^[a-z0-9-]{3,32}$/;

export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "admin",
  "platform",
  "auth",
  "login",
  "signup",
  "dashboard",
  "neurofax",
  "medbook",
  "static",
  "assets",
  "cdn",
  "mail",
  "ftp",
  "ns",
  "ns1",
  "ns2",
  "mx",
  "smtp",
  "test",
  "staging",
  "dev",
  "demo",
]);

export type SubdomainValidationError =
  | "format"
  | "reserved"
  | "leading-trailing-dash"
  | "double-dash";

export function validateSubdomain(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: SubdomainValidationError } {
  const value = raw.trim().toLowerCase();
  if (!SUBDOMAIN_REGEX.test(value)) return { ok: false, reason: "format" };
  if (value.startsWith("-") || value.endsWith("-")) {
    return { ok: false, reason: "leading-trailing-dash" };
  }
  if (value.includes("--")) return { ok: false, reason: "double-dash" };
  if (RESERVED_SUBDOMAINS.has(value)) return { ok: false, reason: "reserved" };
  return { ok: true, value };
}

/**
 * Zod refinement wrapper — used by the branding PATCH body schema. Returns
 * the normalised (trimmed + lowercased) value via `transform`.
 */
export const SubdomainZ = z
  .string()
  .min(3)
  .max(32)
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => SUBDOMAIN_REGEX.test(v), { message: "invalid_format" })
  .refine((v) => !v.startsWith("-") && !v.endsWith("-"), {
    message: "leading_trailing_dash",
  })
  .refine((v) => !v.includes("--"), { message: "double_dash" })
  .refine((v) => !RESERVED_SUBDOMAINS.has(v), { message: "reserved" });

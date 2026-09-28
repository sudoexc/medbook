/**
 * Who may read and write the clinical side of a medical case (audit PT-11).
 *
 * The front desk and the call center work with cases every day: they open
 * one while booking, attach visits to it, fix its title, change the leading
 * doctor, close it. What they must not do is edit the diagnosis or the SOAP
 * draft (a receptionist's PATCH used to overwrite what the doctor wrote,
 * with no trace in the medical history), and they have no need to read
 * them either: the «Медицина» tab has always been hidden from them, only
 * the API still answered.
 *
 * So the case endpoints keep serving these roles, minus the clinical
 * fields: reads drop them, and a write that carries them is refused with a
 * reason the screen can explain. The complaint (reception takes it at
 * booking) and the case notes stay shared.
 */
import type { TenantContext } from "@/lib/tenant-context";

/** Case columns only clinical roles read and write. */
export const CASE_CLINICAL_FIELDS = [
  "diagnosisText",
  "diagnosisCode",
  "soapDraft",
] as const;

export type CaseClinicalField = (typeof CASE_CLINICAL_FIELDS)[number];

const CLINICAL_READ_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "NURSE",
]);

const CLINICAL_WRITE_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
]);

function roleOf(ctx: TenantContext): string | null {
  if (ctx.kind === "TENANT") return ctx.role;
  if (ctx.kind === "SUPER_ADMIN") return "SUPER_ADMIN";
  // SYSTEM / unscoped code paths act for the clinic itself.
  return null;
}

export function canReadCaseClinical(ctx: TenantContext): boolean {
  const role = roleOf(ctx);
  return role === null || CLINICAL_READ_ROLES.has(role);
}

export function canWriteCaseClinical(ctx: TenantContext): boolean {
  const role = roleOf(ctx);
  return role === null || CLINICAL_WRITE_ROLES.has(role);
}

/** The clinical fields a write body actually sets (undefined = untouched). */
export function clinicalFieldsIn(body: Record<string, unknown>): CaseClinicalField[] {
  return CASE_CLINICAL_FIELDS.filter((f) => body[f] !== undefined);
}

/**
 * A case row without its clinical side, for roles that do not read it:
 * the clinical columns and the prescription list are left out (not nulled,
 * so a screen cannot mistake them for «no diagnosis»).
 */
export function withoutCaseClinical<T extends Record<string, unknown>>(
  row: T,
): Omit<T, CaseClinicalField | "prescriptions"> {
  const out: Record<string, unknown> = { ...row };
  for (const f of CASE_CLINICAL_FIELDS) delete out[f];
  delete out.prescriptions;
  return out as Omit<T, CaseClinicalField | "prescriptions">;
}

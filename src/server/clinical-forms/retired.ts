/**
 * The answer of a create route while issuing clinical forms is switched off
 * (audit CD-07, see `@/lib/clinical-forms-issuing`). 410 rather than 404:
 * the route exists and its list, print and cancel siblings still work.
 */
import { err } from "@/server/http";

export type RetiredForm = "e-prescription" | "sick-leave" | "lab-order" | "referral";

export function formRetired(form: RetiredForm): Response {
  return err("Gone", 410, { reason: "form_retired", form });
}

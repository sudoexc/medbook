/**
 * «Создать карточку» deep link into the patients page (audit CM-02).
 *
 * The call center's «Создать карточку» links to
 * `/crm/patients?new=true&phone=<caller>` and the topbar's «Создать
 * пациента» to `/crm/patients?new=true`, but the page never read either
 * parameter: the operator landed on the plain list, mid-call, and hunted for
 * the button. The page now opens the new-patient dialog from them, with the
 * caller's number filled in, and drops them from the URL so a reload or a
 * second click behaves the same way.
 */

type ParamsLike = { get(name: string): string | null; toString(): string };

export const NEW_PATIENT_PARAM = "new";
export const NEW_PATIENT_PHONE_PARAM = "phone";

/** Same cap as the dialog's phone field. */
const PHONE_MAX = 40;

/** The dialog to open, or null when the URL asks for none. */
export function readNewPatientIntent(
  params: ParamsLike | null | undefined,
): { phone: string } | null {
  if (!params || params.get(NEW_PATIENT_PARAM) !== "true") return null;
  const phone = (params.get(NEW_PATIENT_PHONE_PARAM) ?? "").trim().slice(0, PHONE_MAX);
  return { phone };
}

/** The query string without the deep-link parameters (filters stay). */
export function withoutNewPatientParams(params: ParamsLike): string {
  const next = new URLSearchParams(params.toString());
  next.delete(NEW_PATIENT_PARAM);
  next.delete(NEW_PATIENT_PHONE_PARAM);
  return next.toString();
}

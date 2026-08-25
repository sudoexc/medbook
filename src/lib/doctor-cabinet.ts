/**
 * The doctor-cabinet kill switch, in one place.
 *
 * Two layouts guard this surface from opposite ends: `/[locale]/doctor`
 * bounces to CRM when the cabinet is off, and `/[locale]/crm` bounces a
 * DOCTOR to their own cabinet. Each one read its own idea of "is the cabinet
 * available", so flipping the switch off put a doctor in an infinite redirect
 * loop between them (ERR_TOO_MANY_REDIRECTS) — the kill switch locked out
 * exactly the users it was meant to protect.
 *
 * Both sides now ask this function, so the two guards cannot disagree.
 */
export function isDoctorCabinetEnabled(): boolean {
  return process.env.DOCTOR_CABINET_ENABLED === "1";
}

/**
 * Should a signed-in DOCTOR hitting /crm be sent to their own cabinet?
 *
 * Only when the cabinet is actually reachable. With the switch off the doctor
 * stays in CRM: it is read-mostly for their role, but a degraded surface beats
 * a browser error page.
 */
export function shouldRedirectDoctorToCabinet(role: string | undefined): boolean {
  return role === "DOCTOR" && isDoctorCabinetEnabled();
}

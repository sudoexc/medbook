/**
 * What the rail's «Создать пациента» tells the operator when the API says
 * no (audit G6-14). The toast used to show the raw answer: «ValidationError»
 * for a mistyped number, «Forbidden» for a nurse, «Link failed: 403». Pure,
 * so the mapping is tested without the page; the keys live under
 * `tgInbox.rail.createErrors`.
 */
export type CreatePatientErrorKey = "invalidPhone" | "invalid" | "forbidden" | "failed";

export function createPatientErrorKey(
  status: number,
  body: unknown,
): CreatePatientErrorKey {
  const reason =
    body && typeof body === "object" ? (body as { reason?: unknown }).reason : undefined;
  if (status === 400) return reason === "invalid_phone" ? "invalidPhone" : "invalid";
  if (status === 401 || status === 403) return "forbidden";
  return "failed";
}

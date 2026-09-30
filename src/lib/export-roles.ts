/**
 * Who may export patients / appointments / payments as CSV (audit AN-27).
 *
 * One list for the export API (`/api/crm/exports`, its status and download
 * routes) and the «Экспорт» buttons. The buttons used to render for every
 * role while the API let only ADMIN in: a receptionist pressed «Экспорт»,
 * read «Экспорт поставлен в очередь», and nothing ever arrived (the API had
 * answered 403). SUPER_ADMIN passes every role gate (`createApiHandler`).
 *
 * Client-safe: no server imports.
 */
export const EXPORT_ROLES = ["ADMIN"] as const;

export function canExport(role: string | null | undefined): boolean {
  if (!role) return false;
  return role === "SUPER_ADMIN" || (EXPORT_ROLES as readonly string[]).includes(role);
}

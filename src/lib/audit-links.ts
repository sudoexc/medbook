/**
 * Links into «Настройки → Журнал аудита» (audit G1-10). Client-safe.
 *
 * The patient's link opens the events about the card (its own rows and
 * every row whose meta names it) and pre-selects the same patient on the
 * «Просмотры карточек» tab, so who changed and who read the chart are one
 * click apart.
 */
export function patientAuditHref(locale: string, patientId: string): string {
  const id = encodeURIComponent(patientId);
  return `/${locale}/crm/settings/audit?e_patientId=${id}&pv_patientId=${id}`;
}

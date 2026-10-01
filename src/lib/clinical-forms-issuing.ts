/**
 * Audit CD-07 decision (docs/api/clinical-forms.md): the CRM no longer
 * issues new e-prescriptions, sick-leave certificates, lab orders or
 * referrals.
 *
 * The doctor took those buttons off the visit screen on 15.07 (commit
 * 1622b12) and nothing else offered them, yet the backend kept accepting
 * new forms, a worker kept sweeping for referral PDFs every 30 seconds and
 * the doctor's «Подпись» setting kept promising to sign documents nobody
 * could create. The issuing paths also carry known defects (numbering per
 * UTC day, an Rx line without a dose dropped silently, referral statuses
 * that never move, no inbox for incoming referrals). So, while this is off:
 *   - POST on the four create routes answers 410 `form_retired`;
 *   - the referral PDF worker is not started;
 *   - the «Подпись» tab in the doctor's settings is hidden;
 *   - forms issued earlier stay findable, printable and cancellable in the
 *     patient card (Документы → «Выданные рецепты и больничные»), and their
 *     public QR check keeps answering, «АННУЛИРОВАН» after a cancellation.
 *
 * Switching it back on is a product decision, and not enough by itself:
 * the defects above and the entry points are listed in the doc.
 */
export const CLINICAL_FORMS_ISSUING: boolean = false;

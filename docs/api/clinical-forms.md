# Clinical forms: e-prescriptions, sick leave, lab orders, referrals

## Decision (audit CD-07, 2026-10-01)

Issuing new forms from the CRM is **switched off**
(`CLINICAL_FORMS_ISSUING = false` in `src/lib/clinical-forms-issuing.ts`).

Why: the doctor removed the «Анализы / Рецепт / Больничный / Направление»
buttons from the visit screen on 15.07 (commit 1622b12) and no other screen
offered them, but the backend kept accepting new forms, the referral PDF
worker kept polling every 30 s, and the doctor's «Подпись» setting promised a
signature that appeared on nothing. The issuing paths also carry known
defects, listed below.

While switched off:

- `POST /api/crm/e-prescriptions`, `/sick-leaves`, `/lab-orders`, `/referrals`
  answer **410** `{ reason: "form_retired" }`.
- The `referral-document` worker is not started.
- The «Подпись» tab in the doctor's settings is hidden.
- The unmounted dialogs and their create hooks were removed (restore them
  from git, commit 1622b12 and earlier, if the forms come back).
- Forms issued earlier stay usable: patient card → «Документы» →
  «Выданные рецепты и больничные» lists them with **Печать** (reprint) and,
  for ADMIN, **Аннулировать** with a reason. The public QR check
  (`/api/verify/recipe/…`, `/api/verify/sick-leave/…`) then shows the form as
  cancelled. List, detail, print and cancel routes are unchanged.

## Before switching it back on

1. Numbering: `RX-/SL-YYYYMMDD-NNNN` counts per UTC day (00:00 to 05:00 in
   Tashkent lands on the previous day) and a concurrent issue hits the UNIQUE
   constraint as a 500.
2. The e-prescription dialog silently dropped lines without a dose or a
   frequency.
3. `Referral.status` never leaves `PENDING`, there is no `[id]` route and no
   inbox for incoming referrals; lab order status transitions need review.
4. Decide where the entry points live: not on the visit screen the doctor
   approved without them.
5. Flip the switch (worker and signature tab follow it), restore the dialogs.

/**
 * A switched-off clinic locks its staff out (audit SEC-10).
 *
 * `Clinic.active` was a toggle in /admin that nothing read: the login
 * checked only `User.active`, so staff of a clinic the platform owner had
 * switched off kept signing in and working. It is now read at the three
 * doors: the login pre-flight (a clear «клиника отключена» instead of
 * «неверный пароль»), the credentials sign-in itself, and the staff session
 * guard that every `auth()` runs (an open session ends within the guard's
 * 10-second cache).
 *
 * SUPER_ADMIN has no home clinic and is never locked out this way, not even
 * while visiting a switched-off clinic: the platform owner may enter one on
 * purpose, after the «Клиника выключена» warning and with `breakGlass`
 * (owner request 09.10.2026, docs/design/OWNER-ACCOUNT.md §2). The role
 * check holds whatever clinic is passed in.
 */
export function clinicLocksOut(user: {
  role: string;
  clinicId: string | null;
  clinicActive: boolean | null | undefined;
}): boolean {
  return (
    user.role !== "SUPER_ADMIN" &&
    user.clinicId !== null &&
    user.clinicActive === false
  );
}

/**
 * /login/2fa — second-factor prompt for the login flow.
 *
 * The user lands here after /login determined their account has TOTP
 * enabled (via the /api/crm/auth/totp-required precheck). The form
 * carries the email + password forward via sessionStorage; if that's
 * absent (e.g. direct nav), we redirect back to /login. The component
 * is a thin client because next-auth's signIn must run in the browser.
 */
import { Suspense } from "react";

import { TwoFaForm } from "./_components/two-fa-form";

export default function Login2faPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Suspense
        fallback={<div className="h-10 w-10 animate-pulse rounded-full bg-muted" />}
      >
        <TwoFaForm />
      </Suspense>
    </main>
  );
}

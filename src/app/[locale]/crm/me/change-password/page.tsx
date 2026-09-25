import { auth } from "@/lib/auth";
import { homeForRole } from "@/lib/post-login-redirect";
import { changePasswordView } from "@/server/auth/password-change";
import { ChangePasswordClient } from "./_components/change-password-client";

// Also rendered as /doctor/me/change-password: the CRM layout bounces doctors
// into their cabinet, so the cabinet serves this same page itself (DC-02).
export default async function ChangePasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  // The proxy only lets a signed-in user reach this page. Without a session
  // (URL typed by hand on a stale tab) show the form anyway: the API call
  // will 401 and the page won't break.
  const view = changePasswordView(session?.user);
  const homeHref = session?.user
    ? homeForRole(session.user.role, locale)
    : `/${locale}/crm`;
  return (
    <ChangePasswordClient
      forced={view.forced}
      requireCurrent={view.requireCurrent}
      homeHref={homeHref}
    />
  );
}

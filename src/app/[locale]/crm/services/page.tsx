import { redirect } from "@/i18n/navigation";

import { auth } from "@/lib/auth";
import { ServicesSettingsClient } from "../settings/services/_components/services-settings-client";

/**
 * The services editor, linked from the admin-only /crm/settings overview but
 * living outside the settings layout and its ADMIN check (audit ST-10). The
 * API refuses every write from other roles, so without the same check here
 * the front desk opened a full editor whose every save failed.
 */
export default async function ServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user) redirect({ href: "/login", locale });
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    redirect({ href: "/crm", locale });
  }
  return <ServicesSettingsClient />;
}

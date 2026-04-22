import { redirect } from "next/navigation";

/**
 * /crm/settings → redirect to the first section (clinic). Layout already
 * guards for ADMIN role; locale prefix is preserved by middleware.
 */
export default async function SettingsIndexPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  redirect(`/${locale}/crm/settings/clinic`);
}

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import AnalyticsClient from "./analytics-client";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const session = await auth();
  const { locale } = await params;
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== "ADMIN") redirect(`/${locale}/dashboard`);
  return <AnalyticsClient />;
}

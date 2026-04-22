import { IntegrationsPageClient } from "./_components/integrations-page-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function IntegrationsPage({ params }: PageProps) {
  const { id } = await params;
  return <IntegrationsPageClient clinicId={id} />;
}

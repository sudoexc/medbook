/**
 * Phase 16 Wave 2 — Pre-visit questionnaire deeplink target.
 *
 * Mounted at `/c/[slug]/my/pre-visit/[appointmentId]`. The 24h-before TG
 * push fires with this URL; the patient lands here, fills the form, and
 * we POST to `/api/miniapp/pre-visit/[appointmentId]`.
 */
import { PreVisitScreen } from "../../_components/pre-visit-screen";

export default async function PreVisitPage({
  params,
}: {
  params: Promise<{ slug: string; appointmentId: string }>;
}) {
  const { appointmentId } = await params;
  return <PreVisitScreen appointmentId={appointmentId} />;
}

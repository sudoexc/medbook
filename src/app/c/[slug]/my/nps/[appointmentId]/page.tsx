/**
 * Phase 16 Wave 2 — Post-visit NPS deeplink target.
 *
 * Mounted at `/c/[slug]/my/nps/[appointmentId]`. The +4h post-visit TG push
 * fires with this URL; the patient lands here, picks 1–10 + optional
 * comment, we POST to `/api/miniapp/nps/[appointmentId]`. Already-submitted
 * visits surface a "thank you" card instead of an editable form.
 */
import { NpsScreen } from "../../_components/nps-screen";

export default async function NpsPage({
  params,
}: {
  params: Promise<{ slug: string; appointmentId: string }>;
}) {
  const { appointmentId } = await params;
  return <NpsScreen appointmentId={appointmentId} />;
}

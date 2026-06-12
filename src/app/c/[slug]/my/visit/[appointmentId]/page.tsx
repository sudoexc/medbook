/**
 * Wave 3c — «Что сказал врач» deeplink target.
 *
 * Mounted at `/c/[slug]/my/visit/[appointmentId]`. Reached from the home
 * hero ("Заключение готово") and the past-appointment detail dialog.
 */
import { VisitSummaryScreen } from "../../_components/visit-summary-screen";

export default async function VisitSummaryPage({
  params,
}: {
  params: Promise<{ slug: string; appointmentId: string }>;
}) {
  const { appointmentId } = await params;
  return <VisitSummaryScreen appointmentId={appointmentId} />;
}

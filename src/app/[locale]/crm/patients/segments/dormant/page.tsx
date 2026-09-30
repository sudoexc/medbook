import { getFeatureFlagsForCurrentSession } from "@/server/platform/current-flags";

import { PatientSegmentView } from "../_components/segment-view";

/**
 * The plan decides whether «Перезвонить» may open the Call Center, which
 * 404s without it (audit UX-09), the way the Action Center page resolves it.
 */
export default async function DormantPatientsSegmentPage() {
  const flags = await getFeatureFlagsForCurrentSession();
  return (
    <PatientSegmentView segment="dormant" hasCallCenter={flags.hasCallCenter} />
  );
}

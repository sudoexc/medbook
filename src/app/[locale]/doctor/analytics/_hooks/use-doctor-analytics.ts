/**
 * Phase G8 — doctor analytics dashboard hook.
 *
 * Wraps `GET /api/crm/doctors/me/analytics` with React-Query. The endpoint
 * is intentionally one shot — every KPI tile on the dashboard reads from
 * the same response.
 */
import { useQuery } from "@tanstack/react-query";

export type DoctorAnalyticsRange = {
  from: string;
  to: string;
};

// Rx / sick-leave / lab-order KPIs were removed together with the visit-screen
// buttons that produced them — a doctor can't issue those anymore, so the
// tiles would sit at zero forever and read as a bug (see the route header).
export type DoctorAnalyticsKpis = {
  completedAppointments: number;
  finalizedNotes: number;
  protocolApplied: number;
  protocolAppliedPct: number;
  cdsOverrides: number;
  labResultsReviewed: number;
};

export type DoctorAnalyticsDaily = {
  date: string;
  appointments: number;
  notes: number;
  overrides: number;
};

export type DoctorAnalyticsResponse = {
  range: DoctorAnalyticsRange;
  kpis: DoctorAnalyticsKpis;
  daily: DoctorAnalyticsDaily[];
};

async function fetchDoctorAnalytics(
  from: string | null,
  to: string | null,
): Promise<DoctorAnalyticsResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const url = qs
    ? `/api/crm/doctors/me/analytics?${qs}`
    : "/api/crm/doctors/me/analytics";
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // swallow
    }
    throw new Error(`(${res.status}) ${detail}`);
  }
  return (await res.json()) as DoctorAnalyticsResponse;
}

export function useDoctorAnalytics(args: {
  from?: string | null;
  to?: string | null;
}) {
  const from = args.from ?? null;
  const to = args.to ?? null;
  return useQuery({
    queryKey: ["doctor", "analytics", { from, to }],
    queryFn: () => fetchDoctorAnalytics(from, to),
    staleTime: 30_000,
  });
}

/**
 * Shared types for the analytics page. Extracted so that the chart module
 * (which pulls in recharts) and the lightweight page client can both import
 * without forcing the heavy dep into the page client bundle.
 */
import type { PatientJourney } from "@/server/analytics/patient-journey";

export type Period = "week" | "month" | "quarter";

export interface AnalyticsResponse {
  period: Period | "custom";
  from: string;
  to: string;
  doctorOnly: boolean;
  /**
   * Whether the clinic records payments in the CRM (Clinic.
   * paymentsTrackedSince). False: the money tiles say so instead of showing
   * the few payments someone happened to enter.
   */
  paymentsTracked: boolean;
  revenueDaily: Array<{ date: string; amount: number }>;
  appointmentsByStatus: Array<{ status: string; count: number }>;
  noShowDaily: Array<{
    date: string;
    /** Resolved visits of the day (COMPLETED + NO_SHOW): the denominator. */
    total: number;
    noShow: number;
    rate: number;
  }>;
  topDoctors: Array<{
    doctorId: string;
    name: string;
    nameUz: string | null;
    revenue: number;
    count: number;
  }>;
  topServices: Array<{
    serviceId: string;
    name: string;
    nameUz: string | null;
    count: number;
  }>;
  sources: Array<{ source: string; count: number }>;
  ltvBuckets: Array<{ bucket: string; count: number }>;
  /**
   * Average Patient.ltv over the clinic's patients, from the server
   * (src/server/analytics/ltv-summary.ts); null when nobody has paid
   * anything. Not sent to a doctor: patient LTV includes colleagues' visits.
   */
  ltv: { averageTiins: number | null; patients: number };
  /** Booked against scheduled minutes (src/server/analytics/clinic-load.ts). */
  clinicLoad: {
    daily: Array<{
      date: string;
      bookedMin: number;
      workingMin: number;
      /** Percent; null when nobody works that day. */
      load: number | null;
    }>;
    bookedMin: number;
    workingMin: number;
    loadPct: number | null;
    previous: { bookedMin: number; workingMin: number; loadPct: number | null };
  };
  /**
   * Against the previous window of equal length, computed on the server
   * (src/server/analytics/period-compare.ts); null: no chip.
   */
  deltas: {
    revenuePct: number | null;
    noShowPp: number | null;
    loadPp: number | null;
  };
}

// ── Phase 8a — conversion funnel KPIs ────────────────────────────────────────

export interface FunnelDailyPoint {
  date: string;
  total: number;
  converted: number;
  rate: number;
}

export interface FunnelSummary {
  total: number;
  converted: number;
  rate: number;
  daily: FunnelDailyPoint[];
}

export interface NoShowRankRow {
  rate: number;
  noShow: number;
  completed: number;
  total: number;
  name: string;
  nameUz: string | null;
}

export interface DoctorNoShowRow extends NoShowRankRow {
  doctorId: string;
}

export interface ServiceNoShowRow extends NoShowRankRow {
  serviceId: string;
}

export interface WaitTimeRow {
  doctorId: string;
  name: string;
  nameUz: string | null;
  avgWaitSec: number;
  samples: number;
}

// ── Patient journey («Путь пациента») ───────────────────────────────────────

/** /api/crm/analytics/journey (src/server/analytics/patient-journey.ts). */
export interface JourneyAnalyticsResponse {
  period: Period | "custom";
  from: string;
  to: string;
  doctorOnly: boolean;
  journey: PatientJourney;
}

export interface FunnelsResponse {
  period: Period | "custom";
  from: string;
  to: string;
  doctorOnly: boolean;
  windowDays: number;
  tg: FunnelSummary;
  call: FunnelSummary;
  noShowByDoctor: DoctorNoShowRow[];
  noShowByService: ServiceNoShowRow[];
  waitTime: WaitTimeRow[];
  /** Always null until we add a MiniAppEvent table — see funnels.ts header. */
  miniAppFunnel: null;
}

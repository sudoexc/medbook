/**
 * Shared types for the analytics page. Extracted so that the chart module
 * (which pulls in recharts) and the lightweight page client can both import
 * without forcing the heavy dep into the page client bundle.
 */

export type Period = "week" | "month" | "quarter";

export interface AnalyticsResponse {
  period: Period | "custom";
  from: string;
  to: string;
  doctorOnly: boolean;
  revenueDaily: Array<{ date: string; amount: number }>;
  appointmentsByStatus: Array<{ status: string; count: number }>;
  noShowDaily: Array<{
    date: string;
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

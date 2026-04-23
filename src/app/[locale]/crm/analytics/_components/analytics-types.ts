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

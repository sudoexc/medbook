"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { Users, Clock, Activity, Banknote } from "lucide-react";
import { useDoctors } from "@/components/providers/doctors-provider";
import { PatientFlowChart } from "@/components/charts/patient-flow-chart";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { ServiceDistributionChart } from "@/components/charts/service-distribution-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { WorkloadHeatmap } from "@/components/charts/workload-heatmap";
import { formatRevenue } from "@/lib/revenue";
import type { Locale } from "@/types";

interface AnalyticsData {
  hourlyFlow: { hour: number; count: number }[];
  dailyRevenue: { date: string; revenue: number }[];
  dailyPatients: { date: string; count: number }[];
  dailyAvgDuration: { date: string; avg: number }[];
  serviceDistribution: { service: string; count: number; revenue: number }[];
  heatmap: { date: string; count: number }[];
  summary: {
    totalAppointments: number;
    uniquePatients: number;
    avgDuration: number;
    totalRevenue: number;
    revenueByDoctor: { doctorId: string; name: string; revenue: number; count: number }[];
  };
}

const labels = {
  ru: {
    title: "Аналитика",
    patientFlow: "Поток пациентов по часам",
    revenue: "Выручка",
    services: "Распределение по услугам",
    patientsPerDay: "Пациентов в день",
    avgDuration: "Среднее время приёма",
    workload: "Нагрузка за 12 недель",
    totalAppts: "Приёмов",
    uniquePatients: "Уникальных пациентов",
    avgTime: "Ср. время приёма",
    totalRevenue: "Выручка",
    sum: "сум",
    min: "мин",
    byDoctor: "По врачам",
    doctor: "Врач",
    count: "Приёмов",
    revenueCol: "Выручка",
    allDoctors: "Все врачи",
    days: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  },
  uz: {
    title: "Tahlillar",
    patientFlow: "Soatlik bemor oqimi",
    revenue: "Daromad",
    services: "Xizmatlar taqsimoti",
    patientsPerDay: "Kuniga bemorlar",
    avgDuration: "O'rtacha qabul vaqti",
    workload: "12 haftalik ish yuklamasi",
    totalAppts: "Qabullar",
    uniquePatients: "Noyob bemorlar",
    avgTime: "O'rtacha vaqt",
    totalRevenue: "Daromad",
    sum: "so'm",
    min: "daq",
    byDoctor: "Shifokorlar bo'yicha",
    doctor: "Shifokor",
    count: "Qabullar",
    revenueCol: "Daromad",
    allDoctors: "Barcha shifokorlar",
    days: ["Du", "Se", "Chor", "Pay", "Ju", "Sha", "Ya"],
  },
};

export default function AnalyticsClient() {
  const locale = useLocale() as Locale;
  const t = labels[locale];
  const { data: session } = useSession();
  const doctors = useDoctors();

  const [period, setPeriod] = useState(30);
  const [doctorId, setDoctorId] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);

  const isAdmin = session?.user?.role === "ADMIN";

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams({ period: String(period) });
    if (doctorId) params.set("doctorId", doctorId);
    const res = await fetch(`/api/analytics?${params}`);
    if (res.ok) setData(await res.json());
  }, [period, doctorId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const periodOptions = [
    { value: 7, label: locale === "ru" ? "7 дней" : "7 kun" },
    { value: 30, label: locale === "ru" ? "30 дней" : "30 kun" },
    { value: 90, label: locale === "ru" ? "90 дней" : "90 kun" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">{t.title}</h1>
        <div className="flex gap-3">
          {isAdmin && (
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm"
            >
              <option value="">{t.allDoctors}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name[locale]}</option>
              ))}
            </select>
          )}
          <div className="flex gap-1">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  period === opt.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label={t.totalAppts} value={data.summary.totalAppointments} color="text-blue-600 bg-blue-50" />
        <StatCard icon={Activity} label={t.uniquePatients} value={data.summary.uniquePatients} color="text-purple-600 bg-purple-50" />
        <StatCard icon={Clock} label={t.avgTime} value={`${data.summary.avgDuration} ${t.min}`} color="text-green-600 bg-green-50" />
        <StatCard icon={Banknote} label={t.totalRevenue} value={`${formatRevenue(data.summary.totalRevenue)} ${t.sum}`} color="text-amber-600 bg-amber-50" />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PatientFlowChart data={data.hourlyFlow} label={t.patientFlow} />
        <RevenueChart data={data.dailyRevenue} label={t.revenue} currencyLabel={t.sum} />
        <ServiceDistributionChart data={data.serviceDistribution} label={t.services} />
        <TrendChart
          data={data.dailyPatients.map((d) => ({ date: d.date, value: d.count }))}
          label={t.patientsPerDay}
          color="#8b5cf6"
        />
        <TrendChart
          data={data.dailyAvgDuration.map((d) => ({ date: d.date, value: d.avg }))}
          label={t.avgDuration}
          color="#f97316"
          unit={t.min}
        />
        <WorkloadHeatmap data={data.heatmap} label={t.workload} dayLabels={t.days} />
      </div>

      {/* By doctor table */}
      {data.summary.revenueByDoctor.length > 0 && (
        <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-border/40 px-6 py-4">
            <h2 className="text-lg font-semibold">{t.byDoctor}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-secondary/30">
                  <th className="px-6 py-3 text-left font-semibold">{t.doctor}</th>
                  <th className="px-6 py-3 text-left font-semibold">{t.count}</th>
                  <th className="px-6 py-3 text-left font-semibold">{t.revenueCol}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.summary.revenueByDoctor
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((doc) => (
                    <tr key={doc.doctorId} className="hover:bg-secondary/20">
                      <td className="px-6 py-4 font-medium">{doc.name}</td>
                      <td className="px-6 py-4">{doc.count}</td>
                      <td className="px-6 py-4 tabular-nums">{formatRevenue(doc.revenue)} {t.sum}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}

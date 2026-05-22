import { AnalyticsDashboard } from "./_components/analytics-dashboard";

export default function DoctorAnalyticsPage() {
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Моя статистика</h1>
          <p className="text-sm text-muted-foreground">
            Клинические KPI за выбранный период: приёмы, назначения, override-аудит CDS.
          </p>
        </div>
      </div>
      <AnalyticsDashboard />
    </div>
  );
}

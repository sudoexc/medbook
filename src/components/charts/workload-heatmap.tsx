"use client";

interface Props {
  data: { date: string; count: number }[];
  label: string;
  dayLabels: string[];
}

function getIntensity(count: number): string {
  if (count === 0) return "bg-secondary/50";
  if (count <= 2) return "bg-green-100";
  if (count <= 5) return "bg-green-300";
  if (count <= 8) return "bg-green-500";
  return "bg-green-700";
}

export function WorkloadHeatmap({ data, label, dayLabels }: Props) {
  // Group by week
  const weeks: { date: string; count: number; day: number }[][] = [];
  let currentWeek: { date: string; count: number; day: number }[] = [];

  for (const entry of data) {
    const d = new Date(entry.date);
    const day = d.getDay(); // 0=Sun, 1=Mon...
    if (day === 1 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push({ ...entry, day });
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  return (
    <div className="rounded-2xl border border-border/40 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-semibold mb-4">{label}</h3>
      <div className="flex gap-1">
        {/* Day labels */}
        <div className="flex flex-col gap-1 mr-1">
          {dayLabels.map((d, i) => (
            <div key={i} className="h-4 w-6 text-[10px] text-muted-foreground flex items-center">
              {i % 2 === 0 ? d : ""}
            </div>
          ))}
        </div>
        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
              const cell = week.find((c) => c.day === dayNum);
              return (
                <div
                  key={dayNum}
                  className={`h-4 w-4 rounded-sm ${cell ? getIntensity(cell.count) : "bg-secondary/20"}`}
                  title={cell ? `${cell.date}: ${cell.count}` : ""}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
        <span>0</span>
        <div className="flex gap-0.5">
          <div className="h-3 w-3 rounded-sm bg-secondary/50" />
          <div className="h-3 w-3 rounded-sm bg-green-100" />
          <div className="h-3 w-3 rounded-sm bg-green-300" />
          <div className="h-3 w-3 rounded-sm bg-green-500" />
          <div className="h-3 w-3 rounded-sm bg-green-700" />
        </div>
        <span>10+</span>
      </div>
    </div>
  );
}

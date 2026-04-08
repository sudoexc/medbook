"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface Props {
  data: { service: string; count: number; revenue: number }[];
  label: string;
}

const COLORS = ["#1B4F7A", "#4DBFBF", "#2E86AB", "#a855f7", "#f97316", "#ec4899", "#06b6d4", "#6366f1"];

export function ServiceDistributionChart({ data, label }: Props) {
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="rounded-2xl border border-border/40 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-semibold mb-4">{label}</h3>
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="h-48 w-48 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="service"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                strokeWidth={2}
                stroke="#fff"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 13 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2 w-full">
          {data.slice(0, 8).map((item, i) => (
            <div key={item.service} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="truncate max-w-[180px]">{item.service}</span>
              </div>
              <span className="text-muted-foreground tabular-nums">
                {item.count} ({total > 0 ? Math.round((item.count / total) * 100) : 0}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

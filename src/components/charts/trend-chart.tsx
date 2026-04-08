"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface Props {
  data: { date: string; value: number }[];
  label: string;
  color?: string;
  unit?: string;
}

export function TrendChart({ data, label, color = "#3b82f6", unit = "" }: Props) {
  return (
    <div className="rounded-2xl border border-border/40 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-semibold mb-4">{label}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(d) => {
                const date = new Date(d);
                return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
              }}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 13 }}
              formatter={(val) => [`${val}${unit ? ` ${unit}` : ""}`, ""]}
              labelFormatter={(d) => new Date(d).toLocaleDateString("ru-RU")}
            />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

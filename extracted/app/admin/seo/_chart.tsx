"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; impressions: number; clicks: number };

export function SeoTrendChart({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted py-12 text-center italic">
        No data points yet — chart will populate as snapshots accumulate.
      </p>
    );
  }
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={(d: string) => d.slice(5)}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            labelFormatter={(d) => `Date: ${d}`}
          />
          <Line
            type="monotone"
            dataKey="impressions"
            stroke="#3232ff"
            strokeWidth={2}
            dot={false}
            name="Impressions"
          />
          <Line
            type="monotone"
            dataKey="clicks"
            stroke="#cde35d"
            strokeWidth={2}
            dot={false}
            name="Clicks"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

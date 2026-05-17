"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type WeeklyRow = { week: string; count: number };
type TrendPoint = { date: string; clicks: number; impressions: number };

export function WeeklyPublishedChart({ rows }: { rows: WeeklyRow[] }) {
  return (
    <div data-testid="weekly-chart" style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            dataKey="week"
            stroke="rgba(255,255,255,0.45)"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => String(v).slice(5)}
          />
          <YAxis stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "rgba(20,20,40,0.95)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 8,
              color: "white",
            }}
          />
          <Bar dataKey="count" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({
  points,
  label = "GSC",
}: {
  points: TrendPoint[];
  label?: string;
}) {
  return (
    <div data-testid={`trend-${label.toLowerCase()}`} style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            dataKey="date"
            stroke="rgba(255,255,255,0.45)"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => String(v).slice(5)}
          />
          <YAxis stroke="rgba(255,255,255,0.45)" tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: "rgba(20,20,40,0.95)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 8,
              color: "white",
            }}
          />
          <Line type="monotone" dataKey="impressions" stroke="#c4b5fd" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="clicks" stroke="#34d399" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

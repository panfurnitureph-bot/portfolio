"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { peso } from "@/lib/format";

type Slice = { key: string; name: string; value: number; color: string };

// Lazy-loaded donut (recharts) — kept out of the main bundle via next/dynamic.
export default function DonutChart({ data }: { data: Slice[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={46} outerRadius={68} paddingAngle={2} stroke="none">
          {data.map((d) => <Cell key={d.key} fill={d.color} />)}
        </Pie>
        <Tooltip formatter={(v: unknown) => peso(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e7e2d6", fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

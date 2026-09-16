"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { peso } from "@/lib/format";

const OLIVE = "#5b5026";
const GOLD = "#c9a85c";
const pesoK = (n: number) => (Math.abs(n) >= 1000 ? `₱${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : peso(n));

// Lazy-loaded sales trend area chart (recharts) — out of the main bundle.
export default function SalesTrendChart({ data, bucketTarget }: { data: { label: string; sales: number }[]; bucketTarget: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
        <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={OLIVE} stopOpacity={0.35} /><stop offset="100%" stopColor={OLIVE} stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7e2d6" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a8472" }} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={{ fontSize: 11, fill: "#8a8472" }} tickLine={false} axisLine={false} tickFormatter={(v) => pesoK(Number(v))} width={56} />
        <Tooltip formatter={(v: unknown) => peso(Number(v))} labelStyle={{ color: "#2a2519" }} contentStyle={{ borderRadius: 12, border: "1px solid #e7e2d6", fontSize: 12 }} />
        <ReferenceLine y={bucketTarget} stroke={GOLD} strokeDasharray="5 4" strokeWidth={1.5} />
        <Area type="monotone" dataKey="sales" stroke={OLIVE} strokeWidth={2.5} fill="url(#salesFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

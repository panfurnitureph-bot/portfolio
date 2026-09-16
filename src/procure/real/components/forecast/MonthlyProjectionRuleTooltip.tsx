import React, { useMemo } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface Props {
  row: Record<string, unknown>;
  manualMonthlyProjection: number | null | undefined;
  children: React.ReactNode;
}

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtNum = (v: number): string => {
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toString();
};

export const MonthlyProjectionRuleTooltip: React.FC<Props> = ({
  row,
  manualMonthlyProjection,
  children,
}) => {
  const hasManualOverride = manualMonthlyProjection != null && Number(manualMonthlyProjection) !== 0;

  // Kung walang manual override → walang tooltip
  if (!hasManualOverride) {
    return <>{children}</>;
  }

  // Manual Override lang ang may tooltip
  const manualValue = fmtNum(num(manualMonthlyProjection));

  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <span className="inline-block w-full">{children}</span>
      </HoverCardTrigger>
      <HoverCardContent 
        align="center" 
        side="top" 
        sideOffset={6} 
        className="p-0 w-auto max-w-sm border-0 shadow-lg"
      >
        <div
          className="rounded-md px-3 py-2.5 text-xs leading-snug border"
          style={{
            background: "hsl(38 92% 95%)",
            borderColor: "hsl(38 92% 70%)",
            color: "hsl(28 80% 25%)",
          }}
        >
          <div className="font-semibold mb-1" style={{ color: "hsl(28 80% 20%)" }}>
            ✎ Manual override applied
          </div>
          <div className="mb-1">Manual value set in Monthly Projection</div>
          <div className="font-mono text-[11px]">
            Value: <strong>{manualValue}</strong>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

export default MonthlyProjectionRuleTooltip;

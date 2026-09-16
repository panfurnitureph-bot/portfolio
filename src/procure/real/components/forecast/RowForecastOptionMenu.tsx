import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, X, Loader2 } from "lucide-react";
import { externalSupabase } from "@/integrations/supabase/externalClient";
import { toast } from "sonner";

type OptionDetails = {
  description: string;
  monthlyProjection: string;
  salesDiff: string;
};

/** Parse option_description text. Supports JSON {description,monthlyProjection,salesDiff} or plain text. */
function parseStoredDetails(raw: string | null | undefined, fallback: OptionDetails): OptionDetails {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        description: typeof parsed.description === "string" ? parsed.description : fallback.description,
        monthlyProjection:
          typeof parsed.monthlyProjection === "string" ? parsed.monthlyProjection : fallback.monthlyProjection,
        salesDiff: typeof parsed.salesDiff === "string" ? parsed.salesDiff : fallback.salesDiff,
      };
    } catch {
      /* fall through */
    }
  }
  // Plain text → treat as description override
  return { ...fallback, description: trimmed };
}

/** Per-option color tokens (hex) used for the badge & menu indicator. */
export const FORECAST_OPTION_COLORS: Record<number, string> = {
  0: "#4F46E5", // Indigo — Baseline (option 1 with tweaked proj_month_3)
  1: "#185FA5", // Blue  — Forecast Blend
  2: "#534AB7", // Purple — Net Velocity Blend
  3: "#0F6E56", // Teal — Gross Velocity Trend
  4: "#854F0B", // Amber — Current Month Trend
};

export const FORECAST_OPTION_LABELS: Record<number, string> = {
  0: "Baseline",
  1: "Blended",
  2: "Net Rate",
  3: "Gross Rate",
  4: "Current Month",
};

/** Per-option description + formulas surfaced in the hover tooltip. */
export const FORECAST_OPTION_DETAILS: Record<
  number,
  { description: string; monthlyProjection: string; salesDiff: string }
> = {
  1: {
    description:
      "Blends last two months' average sales with the projected run-rate from current sales velocity over the remaining days of the month. Best balance between recent history and current trend.",
    monthlyProjection:
      "ROUNDUP( AVERAGE( last_2months_avg, sales_velocity × remaining_days ), 0 )",
    salesDiff: "(actual_sale_of_month − sales_month_1) / sales_month_1",
  },
  2: {
    description:
      "Projects the full month using net sales velocity (sales after returns) extrapolated across all days in the month. Use when returns are significant.",
    monthlyProjection: "ROUNDUP( net_sales_velocity × days_in_month, 0 )",
    salesDiff: "(actual_sale_of_month − sales_month_1) / sales_month_1",
  },
  3: {
    description:
      "Projects the full month using gross sales velocity (before returns) extrapolated across all days in the month. Most aggressive projection.",
    monthlyProjection: "ROUNDUP( gross_sales_velocity × days_in_month, 0 )",
    salesDiff: "(actual_sale_of_month − sales_month_1) / sales_month_1",
  },
  4: {
    description:
      "Pure run-rate forecast based only on current month's actual sales pace. Ignores history — most reactive to current trend.",
    monthlyProjection:
      "ROUNDUP( (actual_sale_of_month / elapsed_days) × days_in_month, 0 )",
    salesDiff: "(actual_sale_of_month − sales_month_1) / sales_month_1",
  },
  0: {
    description:
      "Baseline — same as Forecast Blend except proj_month_3 uses CEILING((monthly_projection + proj_month_2) / 2) instead of (proj_month_1 + proj_month_2) / 2.",
    monthlyProjection:
      "ROUNDUP( AVERAGE( last_2months_avg, sales_velocity × remaining_days ), 0 )",
    salesDiff: "(actual_sale_of_month − sales_month_1) / sales_month_1",
  },
};

/** Small circular numbered badge displayed next to the SKU. */
export function ForecastOptionBadge({
  option,
  size = 16,
}: {
  option: number;
  size?: number;
}) {
  const opt = option >= 0 && option <= 4 ? option : 1;
  const bg = FORECAST_OPTION_COLORS[opt];
  // Option 0 = Baseline → render "D" to visually distinguish it
  // from the numbered options.
  const label = opt === 0 ? "D" : String(opt);
  return (
    <span
      aria-label={`Forecast option ${opt}`}
      title={`Option ${opt}: ${FORECAST_OPTION_LABELS[opt]}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        fontSize: opt === 0 ? 10 : 9,
        fontWeight: opt === 0 ? 700 : 500,
        lineHeight: 1,
        marginLeft: 0,
        verticalAlign: "middle",
        userSelect: "none",
      }}
    >
      {label}
    </span>
  );
}

interface RowForecastOptionMenuProps {
  x: number;
  y: number;
  currentOption: number;
  onSelect: (option: number) => void;
  onClose: () => void;
}

/** Right-click context menu for selecting a row's forecast option. */
export function RowForecastOptionMenu({
  x,
  y,
  currentOption,
  onSelect,
  onClose,
}: RowForecastOptionMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  // Fetch any saved overrides for descriptions/formulas
  const queryKey = ["forecast_option_config_inline_editor"];
  const { data: configs = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await externalSupabase
        .from("forecast_option_config" as never)
        .select("option_number, option_description");
      if (error) {
        return [] as Array<{ option_number: number; option_description: string | null }>;
      }
      return (data ?? []) as unknown as Array<{ option_number: number; option_description: string | null }>;
    },
    staleTime: 60_000,
  });

  const overridesByNumber = useMemo(() => {
    const m = new Map<number, OptionDetails>();
    for (const c of configs) {
      m.set(
        c.option_number,
        parseStoredDetails(c.option_description, FORECAST_OPTION_DETAILS[c.option_number]),
      );
    }
    return m;
  }, [configs]);

  const getDetails = (opt: number): OptionDetails =>
    overridesByNumber.get(opt) ?? FORECAST_OPTION_DETAILS[opt];

  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editProj, setEditProj] = useState("");
  const [editDiff, setEditDiff] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (cardRef.current?.contains(t)) return;
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing) setEditing(false);
        else onClose();
      }
    };
    document.addEventListener("mousedown", handleDocClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDocClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, editing]);

  // Clamp inside viewport
  const menuWidth = 220;
  const menuHeight = 200;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  const [hovered, setHovered] = useState<number | null>(null);
  const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  // Compute hover-card position: prefer right of menu, fall back to left if overflow.
  const cardWidth = editing ? 380 : 320;
  const cardHeightEst = editing ? 360 : 220;
  let cardLeft = left + menuWidth + 8;
  if (cardLeft + cardWidth > window.innerWidth - 8) {
    cardLeft = Math.max(8, left - cardWidth - 8);
  }
  const hoveredEl = hovered ? itemRefs.current[hovered] : null;
  const hoveredRect = hoveredEl?.getBoundingClientRect();
  let cardTop = hoveredRect ? hoveredRect.top : top;
  if (cardTop + cardHeightEst > window.innerHeight - 8) {
    cardTop = Math.max(8, window.innerHeight - cardHeightEst - 8);
  }

  const hoveredDetails: OptionDetails | null = hovered ? getDetails(hovered) : null;

  const startEdit = () => {
    if (!hovered || !hoveredDetails) return;
    setEditDesc(hoveredDetails.description);
    setEditProj(hoveredDetails.monthlyProjection);
    setEditDiff(hoveredDetails.salesDiff);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (saving) return;
    setEditing(false);
  };

  const saveEdit = async () => {
    if (!hovered) return;
    setSaving(true);
    try {
      const payload = {
        option_number: hovered,
        option_description: JSON.stringify({
          description: editDesc.trim(),
          monthlyProjection: editProj.trim(),
          salesDiff: editDiff.trim(),
        }),
      };
      const { error } = await externalSupabase
        .from("forecast_option_config" as never)
        .upsert(payload as never, { onConflict: "option_number" });
      if (error) throw error;
      toast.success(`Forecast Option ${hovered} description updated`);
      queryClient.invalidateQueries({ queryKey });
      setEditing(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const node = (
    <>
      <div
        ref={ref}
        role="menu"
        style={{
          position: "fixed",
          left,
          top,
          zIndex: 9999,
          minWidth: menuWidth,
          background: "hsl(var(--popover))",
          color: "hsl(var(--popover-foreground))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          padding: "6px 0",
          fontSize: 12,
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          style={{
            padding: "4px 12px 6px",
            fontSize: 11,
            color: "hsl(var(--muted-foreground))",
            textTransform: "none",
            fontWeight: 500,
          }}
        >
          Forecast option
        </div>
        {[0, 1, 2, 3, 4].map((opt) => {
          const active = opt === currentOption;
          return (
            <button
              key={opt}
              ref={(el) => {
                itemRefs.current[opt] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => {
                onSelect(opt);
                onClose();
              }}
              onMouseEnter={(e) => {
                setHovered(opt);
                if (!active) (e.currentTarget as HTMLButtonElement).style.background = "hsl(var(--accent) / 0.5)";
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
              onFocus={() => setHovered(opt)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "6px 12px",
                border: "none",
                background: active ? "hsl(var(--accent))" : "transparent",
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 12,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  border: `2px solid ${FORECAST_OPTION_COLORS[opt]}`,
                  background: active ? FORECAST_OPTION_COLORS[opt] : "transparent",
                  flexShrink: 0,
                }}
              />
              <ForecastOptionBadge option={opt} />
              <span>{FORECAST_OPTION_LABELS[opt]}</span>
            </button>
          );
        })}
      </div>

      {hovered && hoveredDetails && (
        <div
          ref={cardRef}
          role={editing ? "dialog" : "tooltip"}
          style={{
            position: "fixed",
            left: cardLeft,
            top: cardTop,
            zIndex: 10000,
            width: cardWidth,
            background: "hsl(var(--popover))",
            color: "hsl(var(--popover-foreground))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
            padding: 12,
            fontSize: 12,
            // Allow interaction when editing; otherwise click-through is unnecessary but harmless.
            pointerEvents: "auto",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: FORECAST_OPTION_COLORS[hovered],
                flexShrink: 0,
              }}
            />
            <div
              style={{
                flex: 1,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Option {hovered} · {FORECAST_OPTION_LABELS[hovered]}
            </div>
            {!editing ? (
              <button
                type="button"
                title="Edit description / formulas"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit();
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  border: "none",
                  background: "transparent",
                  color: "hsl(var(--muted-foreground))",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background = "hsl(var(--accent))")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
                }
              >
                <Pencil size={14} />
              </button>
            ) : (
              <button
                type="button"
                title="Cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelEdit();
                }}
                disabled={saving}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  border: "none",
                  background: "transparent",
                  color: "hsl(var(--muted-foreground))",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {!editing ? (
            <>
              <p
                style={{
                  margin: "0 0 10px 0",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "hsl(var(--foreground))",
                  opacity: 0.9,
                }}
              >
                {hoveredDetails.description}
              </p>
              <div style={{ marginBottom: 8 }}>
                <div style={labelStyle}>Monthly Projection</div>
                <pre style={preStyle}>{hoveredDetails.monthlyProjection}</pre>
              </div>
              <div>
                <div style={labelStyle}>Sales Diff</div>
                <pre style={preStyle}>{hoveredDetails.salesDiff}</pre>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 10 }}>
                <div style={labelStyle}>Description</div>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={4}
                  style={textareaStyle}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={labelStyle}>Monthly Projection Formula</div>
                <textarea
                  value={editProj}
                  onChange={(e) => setEditProj(e.target.value)}
                  rows={2}
                  style={{ ...textareaStyle, fontFamily: monoFont }}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Sales Diff Formula</div>
                <textarea
                  value={editDiff}
                  onChange={(e) => setEditDiff(e.target.value)}
                  rows={2}
                  style={{ ...textareaStyle, fontFamily: monoFont }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelEdit();
                  }}
                  disabled={saving}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 4,
                    background: "transparent",
                    color: "hsl(var(--foreground))",
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    saveEdit();
                  }}
                  disabled={saving}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    border: "1px solid hsl(var(--primary))",
                    borderRadius: 4,
                    background: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );

  return ReactDOM.createPortal(node, document.body);
}

const monoFont =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "hsl(var(--muted-foreground))",
  marginBottom: 4,
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: "6px 8px",
  background: "hsl(var(--muted) / 0.5)",
  border: "1px solid hsl(var(--border))",
  borderRadius: 4,
  fontFamily: monoFont,
  fontSize: 11,
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 4,
  fontSize: 12,
  lineHeight: 1.4,
  resize: "vertical",
  boxSizing: "border-box",
};

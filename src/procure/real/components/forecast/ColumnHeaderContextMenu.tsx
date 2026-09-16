import React, { useCallback, useState } from "react";
import ReactDOM from "react-dom";
import { EyeOff, RotateCcw, FunctionSquare, Eraser, Loader2, Pin, PinOff } from "lucide-react";
import { callAdminOperationsApi } from "@/lib/adminOperationsApi";
import { broadcastForecastColumnClear, type ForecastColumnClearMsg } from "@/lib/forecastBroadcast";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ClearTarget = { table: string; field: string };

type ClearableSpec = {
  /**
   * One or more strict 1:1 clear operations to execute sequentially.
   * Each entry targets exactly ONE real column on ONE real table.
   * No schema changes, no dynamic columns — only existing columns are nulled.
   */
  targets: ClearTarget[];
  /** Plain user-facing label (e.g. "Order Proposal", "Monthly Projection (Apr)"). */
  label: string;
  /** Plain-English confirmation message — NEVER mentions DB tables. */
  confirmText: string;
  toastText: string;
};

// Columns that exist in BOTH forecast_report_manual and forecast_report.
// One click → confirm modal → clears BOTH automatically.
const SHARED_COLUMNS: Record<string, string> = {
  order_proposal_qty: "Order Proposal",
  buyer_notes: "Buyer Notes",
  planner_notes: "Planner Notes",
  analyst_notes: "Analyst Notes",
};

// Columns that live ONLY on forecast_report_manual.
const MANUAL_ONLY_COLUMNS: Record<string, string> = {
  monthly_projection: "Monthly Projection",
};

// Columns that live ONLY on forecast_report.
const REPORT_ONLY_COLUMNS: Record<string, string> = {
  months_worth: "Months Worth",
};

// proj_month_N / supply_month_N → display month (per spec: month_1 = Apr ... month_12 = Mar)
const MONTH_NAME_BY_INDEX: Record<number, string> = {
  1: "Apr", 2: "May", 3: "Jun", 4: "Jul", 5: "Aug", 6: "Sep",
  7: "Oct", 8: "Nov", 9: "Dec", 10: "Jan", 11: "Feb", 12: "Mar",
};

/**
 * Build user-facing confirm copy. Never reveal DB table names.
 */
function buildConfirmText(label: string, multiTarget: boolean): string {
  if (multiTarget) {
    return `Clear ${label}? This will reset manual and system values and cannot be undone.`;
  }
  return `Clear ${label}? This will reset the value and cannot be undone.`;
}

function buildSpec(
  targets: ClearTarget[],
  label: string,
): ClearableSpec {
  return {
    targets,
    label,
    confirmText: buildConfirmText(label, targets.length > 1),
    toastText: `${label} cleared`,
  };
}

/**
 * Returns the SINGLE clear action for a given column key (or null if none).
 * Shared / monthly columns automatically clear ALL relevant tables — no UI scope picker.
 */
function getClearableAction(columnKey: string): ClearableSpec | null {
  const sharedLabel = SHARED_COLUMNS[columnKey];
  if (sharedLabel) {
    return buildSpec(
      [
        { table: "forecast_report_manual", field: columnKey },
        { table: "forecast_report", field: columnKey },
      ],
      sharedLabel,
    );
  }

  const manualLabel = MANUAL_ONLY_COLUMNS[columnKey];
  if (manualLabel) {
    return buildSpec(
      [{ table: "forecast_report_manual", field: columnKey }],
      manualLabel,
    );
  }

  const reportLabel = REPORT_ONLY_COLUMNS[columnKey];
  if (reportLabel) {
    return buildSpec(
      [{ table: "forecast_report", field: columnKey }],
      reportLabel,
    );
  }

  // Per-month projection cell → clear BOTH the system column on forecast_report
  // AND the override column on forecast_report_proj_override (strict 1:1 calls).
  const projMatch = /^proj_month_(\d{1,2})$/.exec(columnKey);
  if (projMatch) {
    const n = Number(projMatch[1]);
    const month = MONTH_NAME_BY_INDEX[n] ?? `Month ${n}`;
    return buildSpec(
      [
        { table: "forecast_report", field: `proj_month_${n}` },
        { table: "forecast_report_proj_override", field: `proj_month_${n}_override` },
      ],
      `Monthly Projection (${month})`,
    );
  }

  // Per-month supply cell → clear BOTH the system column on forecast_report
  // AND the override column on forecast_report_supply_override (strict 1:1 calls).
  const supplyMatch = /^supply_month_(\d{1,2})$/.exec(columnKey);
  if (supplyMatch) {
    const n = Number(supplyMatch[1]);
    const month = MONTH_NAME_BY_INDEX[n] ?? `Month ${n}`;
    return buildSpec(
      [
        { table: "forecast_report", field: `supply_month_${n}` },
        { table: "forecast_report_supply_override", field: `supply_month_${n}_override` },
      ],
      `Supply Plan (${month})`,
    );
  }
  return null;
}


interface ColumnHeaderContextMenuProps {
  /** Screen position */
  x: number;
  y: number;
  /** The column that was right-clicked */
  columnKey: string;
  /** All currently selected column keys (for multi-hide) */
  selectedColumns: Set<string>;
  /** Columns that cannot be hidden */
  requiredColumns: string[];
  /** Close the menu */
  onClose: () => void;
  /** Hide one or more columns */
  onHideColumns: (keys: string[]) => void;
  /** Reset all columns */
  onReset: () => void;
  /** Open the formula editor for the right-clicked column */
  onEditFormula: (columnKey: string) => void;
  /** Whether the right-clicked column is currently frozen */
  isFrozen?: boolean;
  /** Whether the column is required-frozen (can't be unfrozen) */
  isRequiredFrozen?: boolean;
  /** Toggle freeze on the right-clicked column */
  onFreezeToggle?: (key: string) => void;
  /** Called immediately on confirm, BEFORE the API call — apply instant optimistic UI update. */
  onBeforeClear?: (targets: { table: string; field: string }[]) => void | Promise<void>;
  /** Called after API call — background revalidation only. */
  onRefresh?: (info?: { table: string; field: string }) => void | Promise<void>;
}

export const ColumnHeaderContextMenu = React.memo(function ColumnHeaderContextMenu({
  x,
  y,
  columnKey,
  selectedColumns,
  requiredColumns,
  onClose,
  onHideColumns,
  onReset,
  onEditFormula,
  isFrozen = false,
  isRequiredFrozen = false,
  onFreezeToggle,
  onBeforeClear,
  onRefresh,
}: ColumnHeaderContextMenuProps) {
  const isRequired = requiredColumns.includes(columnKey);
  const clearAction = getClearableAction(columnKey);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const hideableSelected = Array.from(selectedColumns).filter(
    (k) => !requiredColumns.includes(k)
  );
  const multiSelected = hideableSelected.length > 1;

  const handleHideSingle = useCallback(() => {
    if (!isRequired) onHideColumns([columnKey]);
    onClose();
  }, [columnKey, isRequired, onHideColumns, onClose]);

  const handleHideMultiple = useCallback(() => {
    if (hideableSelected.length > 0) onHideColumns(hideableSelected);
    onClose();
  }, [hideableSelected, onHideColumns, onClose]);

  const handleReset = useCallback(() => {
    onReset();
    onClose();
  }, [onReset, onClose]);

  const handleEditFormula = useCallback(() => {
    onEditFormula(columnKey);
    onClose();
  }, [onEditFormula, columnKey, onClose]);

  const handleFreezeToggle = useCallback(() => {
    if (!isRequiredFrozen && onFreezeToggle) {
      onFreezeToggle(columnKey);
      onClose();
    }
  }, [isRequiredFrozen, onFreezeToggle, columnKey, onClose]);

  /** Single click → confirmation modal. No scope picker. */
  const handleClearClick = useCallback(() => {
    if (!clearAction) return;
    setConfirmOpen(true);
  }, [clearAction]);

  const performClear = useCallback(async () => {
    if (!clearAction || isClearing) return;
    const { targets, label, toastText } = clearAction;
    setIsClearing(true);
    try {
      // Instant optimistic update FIRST — UI reverts before API responds.
      await Promise.resolve(onBeforeClear?.(targets));
      // Strict 1:1 — one call per (table, field). No grouped SQL updates.
      for (const t of targets) {
        await callAdminOperationsApi("forecast_clear_column", {
          table: t.table,
          field: t.field,
        });
      }
      // Tell every other connected client to refetch the cleared table so the
      // change is instant for them too (per-cell edits already broadcast; a
      // whole-column clear needs this one signal since it spans all SKUs).
      for (const t of targets) {
        broadcastForecastColumnClear({ table: t.table as ForecastColumnClearMsg["table"], field: t.field });
      }
      // Background revalidation after server confirms.
      for (const t of targets) {
        await Promise.resolve(onRefresh?.({ table: t.table, field: t.field }));
      }
      toast.success(toastText);
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      toast.error(`Failed to clear ${label}`);
    } finally {
      setIsClearing(false);
    }
  }, [clearAction, isClearing, onBeforeClear, onClose, onRefresh]);

  // Clamp position so menu doesn't overflow viewport
  const menuWidth = 240;
  const extra = (multiSelected ? 30 : 0) + (clearAction ? 36 : 0) + 36;
  const menuHeight = 100 + 36 + extra;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  return ReactDOM.createPortal(
    <>
      {!confirmOpen && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 10000 }}
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
        />
      )}
      <div
        className="fixed bg-popover border border-border rounded-md shadow-xl py-1 min-w-[220px] text-sm"
        style={{ top, left, zIndex: 10001 }}
      >
        <button
          onClick={handleEditFormula}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2"
        >
          <FunctionSquare className="h-3.5 w-3.5" />
          Edit Formula
        </button>

        <button
          onClick={handleFreezeToggle}
          disabled={isRequiredFrozen}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isFrozen ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          {isFrozen ? "Unfreeze Column" : "Freeze Column"}
          {isRequiredFrozen && (
            <span className="ml-auto text-[9px] text-muted-foreground">Required</span>
          )}
        </button>

        <div className="my-1 h-px bg-border" />

        <button
          onClick={handleHideSingle}
          disabled={isRequired}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <EyeOff className="h-3.5 w-3.5" />
          Hide column
          {isRequired && (
            <span className="ml-auto text-[9px] text-muted-foreground">Required</span>
          )}
        </button>

        {multiSelected && (
          <button
            onClick={handleHideMultiple}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2"
          >
            <EyeOff className="h-3.5 w-3.5" />
            Hide {hideableSelected.length} selected columns
          </button>
        )}

        {/* Single unified entry — always "Clear Manual Value" */}
        {clearAction && (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              onClick={handleClearClick}
              style={{ color: "hsl(25 95% 53%)" }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2"
            >
              <Eraser className="h-3.5 w-3.5" />
              Clear Manual Value
            </button>
          </>
        )}

        <div className="my-1 h-px bg-border" />

        <button
          onClick={handleReset}
          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          Reset all columns
        </button>
      </div>

      {/* Direct confirmation dialog — no scope picker, no DB names */}
      {clearAction && (
        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (isClearing) return;
            setConfirmOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Clear Manual Value — {clearAction.label}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {clearAction.confirmText}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  performClear();
                }}
                disabled={isClearing}
                style={{ backgroundColor: "hsl(25 95% 53%)", color: "white" }}
              >
                {isClearing ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Clearing…
                  </>
                ) : (
                  "Confirm"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>,
    document.body
  );
});

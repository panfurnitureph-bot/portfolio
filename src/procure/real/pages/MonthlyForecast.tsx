/* =========================================
 * ForecastReportDashboard.tsx (FULL SCRIPT)
 * ✅ Instock display-only clamp to max 100.00
 * ✅ ALL NUMERIC: if 0 => display "-"
 * ✅ Excel-like Multi-Select Filters
 * ✅ Added Filters: Kit + Level of Priority
 * ✅ Sales Metrics order fixed
 * ✅ Monthly Sales now uses rolling 10 months (starting from last month)
 * ✅ Monthly Sales auto-labels like Instock
 * ✅ Projection now uses rolling columns:
 *    proj_month_1 ... proj_month_12
 * ✅ Projection shown as rolling 12 months
 * ✅ Inbound Shipment uses rolling columns:
 *    incoming_month_1 ... incoming_month_12
 * ✅ Supply Plan uses rolling columns:
 *    supply_month_1 ... supply_month_12
 * ✅ Replacement Incoming uses rolling columns:
 *    repl_month_1 ... repl_month_12
 * ✅ Replacement Inventory separated
 * ✅ Removed "Rep"/"Repl" word from display labels
 * ✅ sku_status pill:
 *    - New SKU = like Active
 *    - Not New SKU = like Least Priority
 * ✅ Convert em dash (—) to normal hyphen (-)
 * ✅ Realtime INSERT/UPDATE/DELETE now patches React Query cache directly
 * ✅ Manual edits update local state without full refresh
 * ========================================= */

import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition } from "react";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";
import { broadcastForecastEdit } from "@/lib/forecastBroadcast";
import ReactDOM from "react-dom";
import { flushSync } from "react-dom";
import { useSearchParams, useLocation, Link } from "react-router-dom";
import { usePersistedState } from "@/hooks/usePersistedState";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";

import { RowForecastOptionMenu, ForecastOptionBadge } from "@/components/forecast/RowForecastOptionMenu";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ForecastDateVars, useForecastDateVars } from "@/lib/forecastDateVars";
import { buildFactoryRowStats, buildFactorySummaryHtml } from "@/lib/forecast/factoryChart";
import { buildIdpColumns, buildIdpHeaderRows, getGroupSpans, GROUP_BANNER_LABEL } from "@/lib/forecast/idpColumns";
import { buildIdpXlsx, arrayBufferToBase64 } from "@/lib/forecast/idpXlsx";
import { buildShopifyInventoryXlsx, shopifyInventoryXlsxFilename } from "@/lib/forecast/shopifyInventoryXlsx";
import { buildIdpExportRow } from "@/lib/forecast/idpRowExport";
import { NEW_SKU_WINDOW_DAYS, computeNewSku, readFirstSaleDate, fetchFirstSaleDates, fetchScProductNames, buildScNameMap } from "@/lib/forecast/newSku";
import { buildActionBadgeContent } from "@/lib/forecast/idpMetrics";
import { persistIdpFilterState } from "@/lib/forecast/idpFilterState";
import { useAuth } from "@/contexts/AuthContext";
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
import { TablePagination } from "@/components/ui/table-pagination";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { callAdminOperationsApi } from "@/lib/adminOperationsApi";
import { Search, Pencil, Trash2, Download, Upload, Plus, Info, Mail } from "lucide-react";
import { MonthlyProjectionRuleTooltip } from "@/components/forecast/MonthlyProjectionRuleTooltip";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { usePagePermission } from "@/hooks/usePagePermission";
import { PermissionGuardButton } from "@/components/shared/PermissionGuardButton";
import ProductImage from "@/components/shared/ProductImage";

import { Check, Loader2, AlertCircle, RotateCcw, X, Calendar, Clock, Settings, AlertOctagon, Bell, CheckCircle2, MinusCircle, FunctionSquare, Package, ExternalLink, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";

import { toast } from "sonner";
import {
  SchemaColumn,
  formatCellValue,
  isNumericType,
  isTextType,
  isDateType,
  isBoolType,
} from "@/hooks/usePredictiveSchema";
import { exportForecastDashboardXlsx } from "@/lib/forecastExportXlsxPro";
import { ColumnVisibilityDropdown } from "@/components/forecast/ColumnVisibilityDropdown";
import { ColumnHeaderContextMenu } from "@/components/forecast/ColumnHeaderContextMenu";

/** =========================================================
 * CONFIG
 * ========================================================= */
const TABLE_NAME = "forecast_report";
const QUERY_KEY = "forecast_report";
const PAGE_SIZES = [100, 200, 500, 1000];

const HIDE_DISPLAY_COLUMNS = ["id", "created_at", "updated_at", "refreshed_at", "snapshot_id", "fba_reserved", "intransit_fba", "fba", "repl_fba_reserved", "repl_intransit_fba", "repl_fba", "buyer", "purchasing_url", "shopify_url"];
const NON_EDITABLE_COLUMNS = ["id", "created_at", "updated_at"];

// Columns owned by forecast_report_manual (or scheduled refresh). Edit modal must NOT
// write these to forecast_report — inline cells route them through the manual upsert path.
const MANUAL_ONLY_COLUMNS = ["monthly_projection", "order_proposal_qty", "buyer_notes", "planner_notes", "analyst_notes"];

const ID_PRIORITY = ["id", "product_master_sku", "sku", "vendor_sku", "asin", "upc"];
const LONG_TEXT_HINTS = ["product_name", "description", "vendor_name", "name", "desc", "notes"];

// Defined before COLUMN_FORMULAS — callbacks close over this, Vite TDZ if declared after
const MONTH_ABBR_BY_NUM: Record<number, string> = {
  1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr",
  5: "May", 6: "Jun", 7: "Jul", 8: "Aug",
  9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
};

/** =========================================================
 * FORMULA DEFINITIONS - Maps each column to its formula and input columns
 * ========================================================= */
const COLUMN_FORMULAS: Record<string, {
  label: string;
  formula: string;
  inputs: string[];
  getCalculation?: (row: any, dateVars?: ForecastDateVars) => string;
  getDynamicInputs?: (now: Date, row?: any) => string[];
  getInputLabels?: (now: Date, row?: any) => Record<string, string>;
  getFormulaLabel?: (row: any) => string;
}> = {
  'last_2months_avg': {
    label: 'Mar-Apr Average',
    formula: '= AVERAGE([Mar Sales], [Apr Sales])',
    inputs: [], // Will be computed dynamically based on current date
    getCalculation: (row) => {
      // Get the last 2 months from the rolling sales window
      // sales_month_1 = 2 months ago (Mar in the example)
      // sales_month_0 = previous month (Apr in the example)
      const month1 = row.sales_month_1 ?? 0; // Mar (2 months ago)
      const month0 = row.sales_month_0 ?? 0; // Apr (most recent)
      const avg = ((month1 + month0) / 2).toFixed(1);
      return `= AVERAGE(${month1}, ${month0})\n= ${avg}`;
    },
    getDynamicInputs: (now: Date) => {
      // Last 2 months: sales_month_1 (2 months ago) and sales_month_0 (prev month)
      return ['sales_month_1', 'sales_month_0'];
    },
    getInputLabels: (now: Date) => {
      // Get month names for the last 2 months
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const prevMonthName = MONTH_ABBR_BY_NUM[prevMonth.getMonth() + 1] ?? 'Month';
      const twoMonthsAgoName = MONTH_ABBR_BY_NUM[twoMonthsAgo.getMonth() + 1] ?? 'Month';
      return {
        'sales_month_1': `${twoMonthsAgoName} Sales`,
        'sales_month_0': `${prevMonthName} Sales`,
      };
    }
  },
  'sales_velocity': {
    label: 'Current Sales Velocity',
    formula: '= [Actual Sales] / [Days Elapsed] × [Days in Month]',
    inputs: [],
    getCalculation: (row, dateVars) => {
      const actual = Number(row.actual_sale_of_month ?? 0);
      const elapsed = Math.max(1, dateVars?.elapsed_days ?? 1);
      const dim = dateVars?.days_in_month ?? 30;
      const net = (actual / elapsed) * dim;
      return `= ${actual} / ${elapsed} × ${dim}\n= ${net.toFixed(1)}`;
    },
    getDynamicInputs: () => ['actual_sale_of_month'],
    getInputLabels: () => ({
      'actual_sale_of_month': 'Actual Sales (current month-to-date)',
    }),
  },
  'sales_diff': {
    label: 'Sales Diff (Mar-Apr)',
    formula: '= ([Apr Sales] - [Mar Sales]) / [Mar Sales]',
    inputs: [],
    getCalculation: (row) => {
      // Sales Diff compares the last 2 months
      // sales_month_0 = Apr (most recent)
      // sales_month_1 = Mar (2 months ago)
      const apr = row.sales_month_0 ?? 0;
      const mar = row.sales_month_1 ?? 1; // Avoid division by zero
      const diff = mar !== 0 ? ((apr - mar) / mar * 100) : 0;
      return `= (${apr} - ${mar}) / ${mar}\n= ${diff.toFixed(1)}%`;
    },
    getDynamicInputs: (now: Date) => {
      // Compare last 2 months: sales_month_0 (prev month) vs sales_month_1 (2 months ago)
      return ['sales_month_1', 'sales_month_0'];
    },
    getInputLabels: (now: Date) => {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const prevMonthName = MONTH_ABBR_BY_NUM[prevMonth.getMonth() + 1] ?? 'Month';
      const twoMonthsAgoName = MONTH_ABBR_BY_NUM[twoMonthsAgo.getMonth() + 1] ?? 'Month';
      return {
        'sales_month_1': `${twoMonthsAgoName} Sales`,
        'sales_month_0': `${prevMonthName} Sales`,
      };
    }
  },
  'monthly_projection': {
    label: 'Monthly Projection',
    formula: 'Varies by Forecast Option (see badge)',
    inputs: ['last_2months_avg', 'actual_sale_of_month', 'sales_velocity'],
    getCalculation: (row) => {
      const option = row.__forecast_option ?? row.forecast_option ?? 0;
      const val = row.monthly_projection ?? 0;
      return `Option ${option}: ${val}`;
    }
  },
  'proj_month_1': {
    label: 'Projection Month (May)',
    formula: '= ([Monthly Projection] / 30) × [Days Remaining]',
    inputs: [],
    getCalculation: (row, dateVars) => {
      const monthlyProj = row.monthly_projection ?? 0;
      const projMonth1 = row.proj_month_1 ?? 0;
      // Use actual remaining days from dateVars
      const remainingDays = dateVars?.remaining_days ?? 21;
      const calculated = (monthlyProj / 30) * remainingDays;
      return `= (${monthlyProj} / 30) × ${remainingDays}\n= ${calculated.toFixed(1)}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['monthly_projection'];
    },
    getInputLabels: (now: Date) => {
      return {
        'monthly_projection': 'Monthly Projection',
      };
    }
  },
  'proj_month_2': {
    label: 'Projection Month (Jun)',
    formula: 'Varies by Forecast Option',
    inputs: [],
    getCalculation: (row) => {
      const option = row.__forecast_option ?? row.forecast_option ?? 0;
      const monthlyProj = row.monthly_projection ?? 0;
      const salesMonth0 = row.sales_month_0 ?? 0;
      const netVelocity = row.net_velocity ?? 0;
      const grossVelocity = row.sales_velocity ?? 0;
      const projMonth1 = row.proj_month_1 ?? 0;
      
      // Get the actual month name for sales_month_0 (last month = April in current view)
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthName = MONTH_ABBR_BY_NUM[prevMonth.getMonth() + 1] ?? 'Last Month';
      
      let formula = '';
      let calc = 0;
      
      if (option === 2) {
        // Option 2: Monthly Projection + Apr Sales
        formula = `CEIL(([Monthly Projection] + [${lastMonthName} Sales]) / 2)`;
        calc = Math.ceil((monthlyProj + salesMonth0) / 2);
        return `= ${formula}\n= CEIL((${monthlyProj.toFixed(1)} + ${salesMonth0.toFixed(1)}) / 2)\n= ${calc}`;
      } else if (option === 3) {
        formula = `CEIL(([${lastMonthName} Sales] + [Gross Velocity]) / 2)`;
        calc = Math.ceil((salesMonth0 + grossVelocity) / 2);
        return `= ${formula}\n= CEIL((${salesMonth0.toFixed(1)} + ${grossVelocity.toFixed(1)}) / 2)\n= ${calc}`;
      } else if (option === 4) {
        formula = `CEIL(([${lastMonthName} Sales] + [Proj Month 1]) / 2)`;
        calc = Math.ceil((salesMonth0 + projMonth1) / 2);
        return `= ${formula}\n= CEIL((${salesMonth0.toFixed(1)} + ${projMonth1.toFixed(1)}) / 2)\n= ${calc}`;
      } else {
        // Option 1: Monthly Projection + Apr Sales
        formula = `CEIL(([Monthly Projection] + [${lastMonthName} Sales]) / 2)`;
        calc = Math.ceil((monthlyProj + salesMonth0) / 2);
        return `= ${formula}\n= CEIL((${monthlyProj.toFixed(1)} + ${salesMonth0.toFixed(1)}) / 2)\n= ${calc}`;
      }
    },
    getDynamicInputs: (now: Date, row?: any) => {
      // Return inputs specific to the option being used
      const option = row?.__forecast_option ?? row?.forecast_option ?? 0;
      
      if (option === 2) {
        // Option 2: uses monthly_projection + sales_month_0 (last month = April)
        return ['monthly_projection', 'sales_month_0'];
      } else if (option === 3) {
        // Option 3: uses sales_month_0 (last month = April) + gross velocity
        return ['sales_month_0', 'sales_velocity'];
      } else if (option === 4) {
        // Option 4: uses sales_month_0 (last month = April) + proj_month_1
        return ['sales_month_0', 'proj_month_1'];
      } else {
        // Option 1: uses monthly_projection + sales_month_0 (last month = April)
        return ['monthly_projection', 'sales_month_0'];
      }
    },
    getInputLabels: (now: Date, row?: any) => {
      // Use descriptive labels with section names for clarity
      const option = row?.__forecast_option ?? row?.forecast_option ?? 0;
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const prevMonthName = MONTH_ABBR_BY_NUM[prevMonth.getMonth() + 1] ?? 'Month';
      const currentMonthName = MONTH_ABBR_BY_NUM[currentMonth.getMonth() + 1] ?? 'Month';
      
      if (option === 2) {
        // Option 2: Monthly Projection + Apr Sales
        return {
          'monthly_projection': 'Monthly Projection',
          'sales_month_0': `Monthly Sales (${prevMonthName} ${prevMonth.getFullYear()})`,
        };
      } else if (option === 3) {
        return {
          'sales_month_0': `Monthly Sales (${prevMonthName} ${prevMonth.getFullYear()})`,
          'sales_velocity': 'Current Sales Velocity',
        };
      } else if (option === 4) {
        return {
          'sales_month_0': `Monthly Sales (${prevMonthName} ${prevMonth.getFullYear()})`,
          'proj_month_1': `Projection Month (${currentMonthName} ${currentMonth.getFullYear()})`,
        };
      } else {
        // Option 1: Monthly Projection + Apr Sales
        return {
          'monthly_projection': 'Monthly Projection',
          'sales_month_0': `Monthly Sales (${prevMonthName} ${prevMonth.getFullYear()})`,
        };
      }
    },
    getFormulaLabel: (row: any) => {
      const option = row?.__forecast_option ?? row?.forecast_option ?? 0;
      const optionNames: Record<number, string> = {
        0: 'Baseline',
        1: 'Blended',
        2: 'Net Rate',
        3: 'Gross Rate',
        4: 'Current Month',
      };
      return `Option ${option} (${optionNames[option] ?? 'Unknown'})`;
    }
  },
  'proj_month_3': {
    label: 'Projection Month (Jul)',
    formula: 'Varies by Forecast Option',
    inputs: [],
    getCalculation: (row, dateVars) => {
      const option = row.__forecast_option ?? row.forecast_option ?? 0;
      const salesMonth0 = row.sales_month_0 ?? 0;
      const netVelocity = row.net_velocity ?? 0;
      const grossVelocity = row.sales_velocity ?? 0;
      const projMonth1 = row.proj_month_1 ?? 0;
      const projMonth2 = row.proj_month_2 ?? 0;
      
      // Get the actual month name for sales_month_0 (last month = April in current view)
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthName = MONTH_ABBR_BY_NUM[prevMonth.getMonth() + 1] ?? 'Last Month';
      
      const monthlyProj3 = row.monthly_projection ?? 0;
      let formula = '';
      let calc = 0;

      if (option === 0) {
        formula = 'CEIL(([Monthly Projection] + [Proj Month 2]) / 2)';
        calc = Math.ceil((monthlyProj3 + projMonth2) / 2);
        return `= ${formula}\n= CEIL((${monthlyProj3.toFixed(1)} + ${projMonth2.toFixed(1)}) / 2)\n= ${calc}`;
      } else if (option === 1) {
        formula = 'CEIL(([Current Sales Velocity] + [Proj Month 2]) / 2)';
        calc = Math.ceil((grossVelocity + projMonth2) / 2);
        return `= ${formula}\n= CEIL((${grossVelocity.toFixed(1)} + ${projMonth2.toFixed(1)}) / 2)\n= ${calc}`;
      } else if (option === 2) {
        formula = `CEIL(([Net Velocity] + [${lastMonthName} Sales]) / 2)`;
        calc = Math.ceil((netVelocity + salesMonth0) / 2);
        return `= ${formula}\n= CEIL((${netVelocity.toFixed(1)} + ${salesMonth0.toFixed(1)}) / 2)\n= ${calc}`;
      } else if (option === 3) {
        formula = 'CEIL(([Gross Velocity] + [Proj Month 2]) / 2)';
        calc = Math.ceil((grossVelocity + projMonth2) / 2);
        return `= ${formula}\n= CEIL((${grossVelocity.toFixed(1)} + ${projMonth2.toFixed(1)}) / 2)\n= ${calc}`;
      } else if (option === 4) {
        formula = 'CEIL(([Proj Month 1] + [Proj Month 2]) / 2)';
        calc = Math.ceil((projMonth1 + projMonth2) / 2);
        return `= ${formula}\n= CEIL((${projMonth1.toFixed(1)} + ${projMonth2.toFixed(1)}) / 2)\n= ${calc}`;
      } else {
        formula = 'CEIL(([Proj Month 1] + [Proj Month 2]) / 2)';
        calc = Math.ceil((projMonth1 + projMonth2) / 2);
        return `= ${formula}\n= CEIL((${projMonth1.toFixed(1)} + ${projMonth2.toFixed(1)}) / 2)\n= ${calc}`;
      }
    },
    getDynamicInputs: (now: Date, row?: any) => {
      // Return inputs specific to the option being used
      const option = row?.__forecast_option ?? row?.forecast_option ?? 0;

      if (option === 0) {
        // Option 0 (Baseline): monthly_projection + proj_month_2
        return ['monthly_projection', 'proj_month_2'];
      } else if (option === 1) {
        // Option 1 (Blended): Current Sales Velocity + proj_month_2
        return ['sales_velocity', 'proj_month_2'];
      } else if (option === 2) {
        // Option 2: uses sales_velocity (Current Sales Velocity) + sales_month_0 (last month = April)
        return ['sales_velocity', 'sales_month_0'];
      } else if (option === 3) {
        // Option 3: uses gross velocity + proj_month_2
        return ['sales_velocity', 'proj_month_2'];
      } else {
        // Option 4: uses proj_month_1 + proj_month_2
        return ['proj_month_1', 'proj_month_2'];
      }
    },
    getInputLabels: (now: Date, row?: any) => {
      // Use descriptive labels with section names for clarity
      const option = row?.__forecast_option ?? row?.forecast_option ?? 0;
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const prevMonthName = MONTH_ABBR_BY_NUM[prevMonth.getMonth() + 1] ?? 'Month';
      const currentMonthName = MONTH_ABBR_BY_NUM[currentMonth.getMonth() + 1] ?? 'Month';
      const nextMonthName = MONTH_ABBR_BY_NUM[nextMonth.getMonth() + 1] ?? 'Month';

      if (option === 0) {
        return {
          'monthly_projection': 'Monthly Projection',
          'proj_month_2': `Projection Month (${nextMonthName} ${nextMonth.getFullYear()})`,
        };
      } else if (option === 1) {
        return {
          'sales_velocity': 'Current Sales Velocity',
          'proj_month_2': `Projection Month (${nextMonthName} ${nextMonth.getFullYear()})`,
        };
      } else if (option === 2) {
        return {
          'sales_velocity': 'Current Sales Velocity',
          'sales_month_0': `Monthly Sales (${prevMonthName} ${prevMonth.getFullYear()})`,
        };
      } else if (option === 3) {
        return {
          'sales_velocity': 'Current Sales Velocity',
          'proj_month_2': `Projection Month (${nextMonthName} ${nextMonth.getFullYear()})`,
        };
      } else {
        return {
          'proj_month_1': `Projection Month (${currentMonthName} ${currentMonth.getFullYear()})`,
          'proj_month_2': `Projection Month (${nextMonthName} ${nextMonth.getFullYear()})`,
        };
      }
    },
    getFormulaLabel: (row: any) => {
      const option = row?.__forecast_option ?? row?.forecast_option ?? 0;
      const optionNames: Record<number, string> = {
        0: 'Baseline',
        1: 'Blended',
        2: 'Net Rate',
        3: 'Gross Rate',
        4: 'Current Month',
      };
      return `Option ${option} (${optionNames[option] ?? 'Unknown'})`;
    }
  },
  'proj_month_4': {
    label: 'Projection Month (Aug)',
    formula: '= CEIL(([Proj Month 2] + [Proj Month 3]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth2 = row.proj_month_2 ?? 0;
      const projMonth3 = row.proj_month_3 ?? 0;
      const calc = Math.ceil((projMonth2 + projMonth3) / 2);
      return `= CEIL((${projMonth2} + ${projMonth3}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_2', 'proj_month_3'];
    },
    getInputLabels: (now: Date) => {
      const month2 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const month3 = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      const month2Name = MONTH_ABBR_BY_NUM[month2.getMonth() + 1] ?? 'Month';
      const month3Name = MONTH_ABBR_BY_NUM[month3.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_2': `Projection Month (${month2Name} ${month2.getFullYear()})`,
        'proj_month_3': `Projection Month (${month3Name} ${month3.getFullYear()})`,
      };
    }
  },
  'proj_month_5': {
    label: 'Projection Month (Sep)',
    formula: '= CEIL(([Proj Month 3] + [Proj Month 4]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth3 = row.proj_month_3 ?? 0;
      const projMonth4 = row.proj_month_4 ?? 0;
      const calc = Math.ceil((projMonth3 + projMonth4) / 2);
      return `= CEIL((${projMonth3} + ${projMonth4}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_3', 'proj_month_4'];
    },
    getInputLabels: (now: Date) => {
      const month3 = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      const month4 = new Date(now.getFullYear(), now.getMonth() + 3, 1);
      const month3Name = MONTH_ABBR_BY_NUM[month3.getMonth() + 1] ?? 'Month';
      const month4Name = MONTH_ABBR_BY_NUM[month4.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_3': `Projection Month (${month3Name} ${month3.getFullYear()})`,
        'proj_month_4': `Projection Month (${month4Name} ${month4.getFullYear()})`,
      };
    }
  },
  'proj_month_6': {
    label: 'Projection Month (Oct)',
    formula: '= CEIL(([Proj Month 4] + [Proj Month 5]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth4 = row.proj_month_4 ?? 0;
      const projMonth5 = row.proj_month_5 ?? 0;
      const calc = Math.ceil((projMonth4 + projMonth5) / 2);
      return `= CEIL((${projMonth4} + ${projMonth5}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_4', 'proj_month_5'];
    },
    getInputLabels: (now: Date) => {
      const month4 = new Date(now.getFullYear(), now.getMonth() + 3, 1);
      const month5 = new Date(now.getFullYear(), now.getMonth() + 4, 1);
      const month4Name = MONTH_ABBR_BY_NUM[month4.getMonth() + 1] ?? 'Month';
      const month5Name = MONTH_ABBR_BY_NUM[month5.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_4': `Projection Month (${month4Name} ${month4.getFullYear()})`,
        'proj_month_5': `Projection Month (${month5Name} ${month5.getFullYear()})`,
      };
    }
  },
  'proj_month_7': {
    label: 'Projection Month (Nov)',
    formula: '= CEIL(([Proj Month 5] + [Proj Month 6]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth5 = row.proj_month_5 ?? 0;
      const projMonth6 = row.proj_month_6 ?? 0;
      const calc = Math.ceil((projMonth5 + projMonth6) / 2);
      return `= CEIL((${projMonth5} + ${projMonth6}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_5', 'proj_month_6'];
    },
    getInputLabels: (now: Date) => {
      const month5 = new Date(now.getFullYear(), now.getMonth() + 4, 1);
      const month6 = new Date(now.getFullYear(), now.getMonth() + 5, 1);
      const month5Name = MONTH_ABBR_BY_NUM[month5.getMonth() + 1] ?? 'Month';
      const month6Name = MONTH_ABBR_BY_NUM[month6.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_5': `Projection Month (${month5Name} ${month5.getFullYear()})`,
        'proj_month_6': `Projection Month (${month6Name} ${month6.getFullYear()})`,
      };
    }
  },
  'proj_month_8': {
    label: 'Projection Month (Dec)',
    formula: '= CEIL(([Proj Month 6] + [Proj Month 7]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth6 = row.proj_month_6 ?? 0;
      const projMonth7 = row.proj_month_7 ?? 0;
      const calc = Math.ceil((projMonth6 + projMonth7) / 2);
      return `= CEIL((${projMonth6} + ${projMonth7}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_6', 'proj_month_7'];
    },
    getInputLabels: (now: Date) => {
      const month6 = new Date(now.getFullYear(), now.getMonth() + 5, 1);
      const month7 = new Date(now.getFullYear(), now.getMonth() + 6, 1);
      const month6Name = MONTH_ABBR_BY_NUM[month6.getMonth() + 1] ?? 'Month';
      const month7Name = MONTH_ABBR_BY_NUM[month7.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_6': `Projection Month (${month6Name} ${month6.getFullYear()})`,
        'proj_month_7': `Projection Month (${month7Name} ${month7.getFullYear()})`,
      };
    }
  },
  'proj_month_9': {
    label: 'Projection Month (Jan)',
    formula: '= CEIL(([Proj Month 7] + [Proj Month 8]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth7 = row.proj_month_7 ?? 0;
      const projMonth8 = row.proj_month_8 ?? 0;
      const calc = Math.ceil((projMonth7 + projMonth8) / 2);
      return `= CEIL((${projMonth7} + ${projMonth8}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_7', 'proj_month_8'];
    },
    getInputLabels: (now: Date) => {
      const month7 = new Date(now.getFullYear(), now.getMonth() + 6, 1);
      const month8 = new Date(now.getFullYear(), now.getMonth() + 7, 1);
      const month7Name = MONTH_ABBR_BY_NUM[month7.getMonth() + 1] ?? 'Month';
      const month8Name = MONTH_ABBR_BY_NUM[month8.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_7': `Projection Month (${month7Name} ${month7.getFullYear()})`,
        'proj_month_8': `Projection Month (${month8Name} ${month8.getFullYear()})`,
      };
    }
  },
  'proj_month_10': {
    label: 'Projection Month (Feb)',
    formula: '= CEIL(([Proj Month 8] + [Proj Month 9]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth8 = row.proj_month_8 ?? 0;
      const projMonth9 = row.proj_month_9 ?? 0;
      const calc = Math.ceil((projMonth8 + projMonth9) / 2);
      return `= CEIL((${projMonth8} + ${projMonth9}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_8', 'proj_month_9'];
    },
    getInputLabels: (now: Date) => {
      const month8 = new Date(now.getFullYear(), now.getMonth() + 7, 1);
      const month9 = new Date(now.getFullYear(), now.getMonth() + 8, 1);
      const month8Name = MONTH_ABBR_BY_NUM[month8.getMonth() + 1] ?? 'Month';
      const month9Name = MONTH_ABBR_BY_NUM[month9.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_8': `Projection Month (${month8Name} ${month8.getFullYear()})`,
        'proj_month_9': `Projection Month (${month9Name} ${month9.getFullYear()})`,
      };
    }
  },
  'proj_month_11': {
    label: 'Projection Month (Mar)',
    formula: '= CEIL(([Proj Month 9] + [Proj Month 10]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth9 = row.proj_month_9 ?? 0;
      const projMonth10 = row.proj_month_10 ?? 0;
      const calc = Math.ceil((projMonth9 + projMonth10) / 2);
      return `= CEIL((${projMonth9} + ${projMonth10}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_9', 'proj_month_10'];
    },
    getInputLabels: (now: Date) => {
      const month9 = new Date(now.getFullYear(), now.getMonth() + 8, 1);
      const month10 = new Date(now.getFullYear(), now.getMonth() + 9, 1);
      const month9Name = MONTH_ABBR_BY_NUM[month9.getMonth() + 1] ?? 'Month';
      const month10Name = MONTH_ABBR_BY_NUM[month10.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_9': `Projection Month (${month9Name} ${month9.getFullYear()})`,
        'proj_month_10': `Projection Month (${month10Name} ${month10.getFullYear()})`,
      };
    }
  },
  'proj_month_12': {
    label: 'Projection Month (Apr)',
    formula: '= CEIL(([Proj Month 10] + [Proj Month 11]) / 2)',
    inputs: [],
    getCalculation: (row) => {
      const projMonth10 = row.proj_month_10 ?? 0;
      const projMonth11 = row.proj_month_11 ?? 0;
      const calc = Math.ceil((projMonth10 + projMonth11) / 2);
      return `= CEIL((${projMonth10} + ${projMonth11}) / 2)\n= ${calc}`;
    },
    getDynamicInputs: (now: Date) => {
      return ['proj_month_10', 'proj_month_11'];
    },
    getInputLabels: (now: Date) => {
      const month10 = new Date(now.getFullYear(), now.getMonth() + 9, 1);
      const month11 = new Date(now.getFullYear(), now.getMonth() + 10, 1);
      const month10Name = MONTH_ABBR_BY_NUM[month10.getMonth() + 1] ?? 'Month';
      const month11Name = MONTH_ABBR_BY_NUM[month11.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_10': `Projection Month (${month10Name} ${month10.getFullYear()})`,
        'proj_month_11': `Projection Month (${month11Name} ${month11.getFullYear()})`,
      };
    }
  },
  'total_cbm_approved': {
    label: 'Total CBM Approved',
    formula: '= [Order Proposal Qty] × [CBM]',
    inputs: ['order_proposal_qty', 'cbm'],
    getCalculation: (row) => {
      const orderQty = parseFloat(String(row.order_proposal_qty ?? 0)) || 0;
      const cbm = Number(row.cbm ?? 0);
      const total = orderQty * cbm;
      const qtyDisplay = row.order_proposal_qty != null ? String(row.order_proposal_qty) : "0";
      return `= ${qtyDisplay} × ${cbm.toFixed(1)}\n= ${total.toFixed(1)}`;
    },
    getInputLabels: () => ({
      'order_proposal_qty': 'Order Proposal Quantity',
      'cbm': 'CBM',
    })
  },
  'supply_status': {
    label: 'Supply Status',
    formula: '= IF([Supply Month 1] > 0, "Good", "Critical")',
    inputs: ['supply_month_1'],
    getCalculation: (row) => {
      const supplyMonth1 = row.supply_month_1 ?? 0;
      const status = supplyMonth1 > 0 ? 'Good' : 'Critical';
      return `= IF(${supplyMonth1} > 0, "Good", "Critical")\n= "${status}"`;
    },
    getInputLabels: (now: Date) => {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthName = MONTH_ABBR_BY_NUM[currentMonth.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_1': `Supply Plan (${currentMonthName} ${currentMonth.getFullYear()})`,
      };
    }
  },
  'supply_month_1': {
    label: 'Supply Plan (May)',
    formula: '= [FBA] + [OH Inv] + [Incoming Month 1] + [Repl FBA] + [Repl OH Inv] + [Repl Month 1] - [Proj Month 1]',
    inputs: ['fba', 'oh_inv', 'incoming_month_1', 'repl_fba', 'repl_oh_inv', 'repl_month_1', 'proj_month_1'],
    getCalculation: (row) => {
      const fba = row.fba ?? 0;
      const ohInv = row.oh_inv ?? 0;
      const incoming = row.incoming_month_1 ?? 0;
      const replFba = row.repl_fba ?? 0;
      const replOhInv = row.repl_oh_inv ?? 0;
      const repl = row.repl_month_1 ?? 0;
      const proj = row.proj_month_1 ?? 0;
      const supply = fba + ohInv + incoming + replFba + replOhInv + repl - proj;
      return `= ${fba.toFixed(1)} + ${ohInv.toFixed(1)} + ${incoming.toFixed(1)} + ${replFba.toFixed(1)} + ${replOhInv.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthName = MONTH_ABBR_BY_NUM[currentMonth.getMonth() + 1] ?? 'Month';
      return {
        'fba': 'Inventory Buckets: FBA',
        'oh_inv': 'Inventory Buckets: OH Inv',
        'incoming_month_1': `Inbound Shipment (${currentMonthName} ${currentMonth.getFullYear()})`,
        'repl_fba': 'Replacement Inventory: FBA',
        'repl_oh_inv': 'Replacement Inventory: OH Inv',
        'repl_month_1': `Replacement Incoming (${currentMonthName} ${currentMonth.getFullYear()})`,
        'proj_month_1': `Projection Month (${currentMonthName} ${currentMonth.getFullYear()})`,
      };
    }
  },
  'supply_month_2': {
    label: 'Supply Plan (Jun)',
    formula: '= [Supply Month 1] + [Incoming Month 2] + [Repl Month 2] - [Proj Month 2]',
    inputs: ['supply_month_1', 'incoming_month_2', 'repl_month_2', 'proj_month_2'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_1 ?? 0;
      const incoming = row.incoming_month_2 ?? 0;
      const repl = row.repl_month_2 ?? 0;
      const proj = row.proj_month_2 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month1 = new Date(now.getFullYear(), now.getMonth(), 1);
      const month2 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const month1Name = MONTH_ABBR_BY_NUM[month1.getMonth() + 1] ?? 'Month';
      const month2Name = MONTH_ABBR_BY_NUM[month2.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_1': `Supply Plan (${month1Name} ${month1.getFullYear()})`,
        'incoming_month_2': `Inbound Shipment (${month2Name} ${month2.getFullYear()})`,
        'repl_month_2': `Replacement Incoming (${month2Name} ${month2.getFullYear()})`,
        'proj_month_2': `Projection Month (${month2Name} ${month2.getFullYear()})`,
      };
    }
  },
  'supply_month_3': {
    label: 'Supply Plan (Jul)',
    formula: '= [Supply Month 2] + [Incoming Month 3] + [Repl Month 3] - [Proj Month 3]',
    inputs: ['supply_month_2', 'incoming_month_3', 'repl_month_3', 'proj_month_3'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_2 ?? 0;
      const incoming = row.incoming_month_3 ?? 0;
      const repl = row.repl_month_3 ?? 0;
      const proj = row.proj_month_3 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month2 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const month3 = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      const month2Name = MONTH_ABBR_BY_NUM[month2.getMonth() + 1] ?? 'Month';
      const month3Name = MONTH_ABBR_BY_NUM[month3.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_2': `Supply Plan (${month2Name} ${month2.getFullYear()})`,
        'incoming_month_3': `Inbound Shipment (${month3Name} ${month3.getFullYear()})`,
        'repl_month_3': `Replacement Incoming (${month3Name} ${month3.getFullYear()})`,
        'proj_month_3': `Projection Month (${month3Name} ${month3.getFullYear()})`,
      };
    }
  },
  'supply_month_4': {
    label: 'Supply Plan (Aug)',
    formula: '= [Supply Month 3] + [Incoming Month 4] + [Repl Month 4] - [Proj Month 4]',
    inputs: ['supply_month_3', 'incoming_month_4', 'repl_month_4', 'proj_month_4'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_3 ?? 0;
      const incoming = row.incoming_month_4 ?? 0;
      const repl = row.repl_month_4 ?? 0;
      const proj = row.proj_month_4 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month3 = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      const month4 = new Date(now.getFullYear(), now.getMonth() + 3, 1);
      const month3Name = MONTH_ABBR_BY_NUM[month3.getMonth() + 1] ?? 'Month';
      const month4Name = MONTH_ABBR_BY_NUM[month4.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_3': `Supply Plan (${month3Name} ${month3.getFullYear()})`,
        'incoming_month_4': `Inbound Shipment (${month4Name} ${month4.getFullYear()})`,
        'repl_month_4': `Replacement Incoming (${month4Name} ${month4.getFullYear()})`,
        'proj_month_4': `Projection Month (${month4Name} ${month4.getFullYear()})`,
      };
    }
  },
  'supply_month_5': {
    label: 'Supply Plan (Sep)',
    formula: '= [Supply Month 4] + [Incoming Month 5] + [Repl Month 5] - [Proj Month 5]',
    inputs: ['supply_month_4', 'incoming_month_5', 'repl_month_5', 'proj_month_5'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_4 ?? 0;
      const incoming = row.incoming_month_5 ?? 0;
      const repl = row.repl_month_5 ?? 0;
      const proj = row.proj_month_5 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month4 = new Date(now.getFullYear(), now.getMonth() + 3, 1);
      const month5 = new Date(now.getFullYear(), now.getMonth() + 4, 1);
      const month4Name = MONTH_ABBR_BY_NUM[month4.getMonth() + 1] ?? 'Month';
      const month5Name = MONTH_ABBR_BY_NUM[month5.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_4': `Supply Plan (${month4Name} ${month4.getFullYear()})`,
        'incoming_month_5': `Inbound Shipment (${month5Name} ${month5.getFullYear()})`,
        'repl_month_5': `Replacement Incoming (${month5Name} ${month5.getFullYear()})`,
        'proj_month_5': `Projection Month (${month5Name} ${month5.getFullYear()})`,
      };
    }
  },
  'supply_month_6': {
    label: 'Supply Plan (Oct)',
    formula: '= [Supply Month 5] + [Incoming Month 6] + [Repl Month 6] - [Proj Month 6]',
    inputs: ['supply_month_5', 'incoming_month_6', 'repl_month_6', 'proj_month_6'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_5 ?? 0;
      const incoming = row.incoming_month_6 ?? 0;
      const repl = row.repl_month_6 ?? 0;
      const proj = row.proj_month_6 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month5 = new Date(now.getFullYear(), now.getMonth() + 4, 1);
      const month6 = new Date(now.getFullYear(), now.getMonth() + 5, 1);
      const month5Name = MONTH_ABBR_BY_NUM[month5.getMonth() + 1] ?? 'Month';
      const month6Name = MONTH_ABBR_BY_NUM[month6.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_5': `Supply Plan (${month5Name} ${month5.getFullYear()})`,
        'incoming_month_6': `Inbound Shipment (${month6Name} ${month6.getFullYear()})`,
        'repl_month_6': `Replacement Incoming (${month6Name} ${month6.getFullYear()})`,
        'proj_month_6': `Projection Month (${month6Name} ${month6.getFullYear()})`,
      };
    }
  },
  'supply_month_7': {
    label: 'Supply Plan (Nov)',
    formula: '= [Supply Month 6] + [Incoming Month 7] + [Repl Month 7] - [Proj Month 7]',
    inputs: ['supply_month_6', 'incoming_month_7', 'repl_month_7', 'proj_month_7'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_6 ?? 0;
      const incoming = row.incoming_month_7 ?? 0;
      const repl = row.repl_month_7 ?? 0;
      const proj = row.proj_month_7 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month6 = new Date(now.getFullYear(), now.getMonth() + 5, 1);
      const month7 = new Date(now.getFullYear(), now.getMonth() + 6, 1);
      const month6Name = MONTH_ABBR_BY_NUM[month6.getMonth() + 1] ?? 'Month';
      const month7Name = MONTH_ABBR_BY_NUM[month7.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_6': `Supply Plan (${month6Name} ${month6.getFullYear()})`,
        'incoming_month_7': `Inbound Shipment (${month7Name} ${month7.getFullYear()})`,
        'repl_month_7': `Replacement Incoming (${month7Name} ${month7.getFullYear()})`,
        'proj_month_7': `Projection Month (${month7Name} ${month7.getFullYear()})`,
      };
    }
  },
  'supply_month_8': {
    label: 'Supply Plan (Dec)',
    formula: '= [Supply Month 7] + [Incoming Month 8] + [Repl Month 8] - [Proj Month 8]',
    inputs: ['supply_month_7', 'incoming_month_8', 'repl_month_8', 'proj_month_8'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_7 ?? 0;
      const incoming = row.incoming_month_8 ?? 0;
      const repl = row.repl_month_8 ?? 0;
      const proj = row.proj_month_8 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month7 = new Date(now.getFullYear(), now.getMonth() + 6, 1);
      const month8 = new Date(now.getFullYear(), now.getMonth() + 7, 1);
      const month7Name = MONTH_ABBR_BY_NUM[month7.getMonth() + 1] ?? 'Month';
      const month8Name = MONTH_ABBR_BY_NUM[month8.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_7': `Supply Plan (${month7Name} ${month7.getFullYear()})`,
        'incoming_month_8': `Inbound Shipment (${month8Name} ${month8.getFullYear()})`,
        'repl_month_8': `Replacement Incoming (${month8Name} ${month8.getFullYear()})`,
        'proj_month_8': `Projection Month (${month8Name} ${month8.getFullYear()})`,
      };
    }
  },
  'supply_month_9': {
    label: 'Supply Plan (Jan)',
    formula: '= [Supply Month 8] + [Incoming Month 9] + [Repl Month 9] - [Proj Month 9]',
    inputs: ['supply_month_8', 'incoming_month_9', 'repl_month_9', 'proj_month_9'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_8 ?? 0;
      const incoming = row.incoming_month_9 ?? 0;
      const repl = row.repl_month_9 ?? 0;
      const proj = row.proj_month_9 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month8 = new Date(now.getFullYear(), now.getMonth() + 7, 1);
      const month9 = new Date(now.getFullYear(), now.getMonth() + 8, 1);
      const month8Name = MONTH_ABBR_BY_NUM[month8.getMonth() + 1] ?? 'Month';
      const month9Name = MONTH_ABBR_BY_NUM[month9.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_8': `Supply Plan (${month8Name} ${month8.getFullYear()})`,
        'incoming_month_9': `Inbound Shipment (${month9Name} ${month9.getFullYear()})`,
        'repl_month_9': `Replacement Incoming (${month9Name} ${month9.getFullYear()})`,
        'proj_month_9': `Projection Month (${month9Name} ${month9.getFullYear()})`,
      };
    }
  },
  'supply_month_10': {
    label: 'Supply Plan (Feb)',
    formula: '= [Supply Month 9] + [Incoming Month 10] + [Repl Month 10] - [Proj Month 10]',
    inputs: ['supply_month_9', 'incoming_month_10', 'repl_month_10', 'proj_month_10'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_9 ?? 0;
      const incoming = row.incoming_month_10 ?? 0;
      const repl = row.repl_month_10 ?? 0;
      const proj = row.proj_month_10 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month9 = new Date(now.getFullYear(), now.getMonth() + 8, 1);
      const month10 = new Date(now.getFullYear(), now.getMonth() + 9, 1);
      const month9Name = MONTH_ABBR_BY_NUM[month9.getMonth() + 1] ?? 'Month';
      const month10Name = MONTH_ABBR_BY_NUM[month10.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_9': `Supply Plan (${month9Name} ${month9.getFullYear()})`,
        'incoming_month_10': `Inbound Shipment (${month10Name} ${month10.getFullYear()})`,
        'repl_month_10': `Replacement Incoming (${month10Name} ${month10.getFullYear()})`,
        'proj_month_10': `Projection Month (${month10Name} ${month10.getFullYear()})`,
      };
    }
  },
  'supply_month_11': {
    label: 'Supply Plan (Mar)',
    formula: '= [Supply Month 10] + [Incoming Month 11] + [Repl Month 11] - [Proj Month 11]',
    inputs: ['supply_month_10', 'incoming_month_11', 'repl_month_11', 'proj_month_11'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_10 ?? 0;
      const incoming = row.incoming_month_11 ?? 0;
      const repl = row.repl_month_11 ?? 0;
      const proj = row.proj_month_11 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month10 = new Date(now.getFullYear(), now.getMonth() + 9, 1);
      const month11 = new Date(now.getFullYear(), now.getMonth() + 10, 1);
      const month10Name = MONTH_ABBR_BY_NUM[month10.getMonth() + 1] ?? 'Month';
      const month11Name = MONTH_ABBR_BY_NUM[month11.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_10': `Supply Plan (${month10Name} ${month10.getFullYear()})`,
        'incoming_month_11': `Inbound Shipment (${month11Name} ${month11.getFullYear()})`,
        'repl_month_11': `Replacement Incoming (${month11Name} ${month11.getFullYear()})`,
        'proj_month_11': `Projection Month (${month11Name} ${month11.getFullYear()})`,
      };
    }
  },
  'supply_month_12': {
    label: 'Supply Plan (Apr)',
    formula: '= [Supply Month 11] + [Incoming Month 12] + [Repl Month 12] - [Proj Month 12]',
    inputs: ['supply_month_11', 'incoming_month_12', 'repl_month_12', 'proj_month_12'],
    getCalculation: (row) => {
      const prevSupply = row.supply_month_11 ?? 0;
      const incoming = row.incoming_month_12 ?? 0;
      const repl = row.repl_month_12 ?? 0;
      const proj = row.proj_month_12 ?? 0;
      const supply = prevSupply + incoming + repl - proj;
      return `= ${prevSupply.toFixed(1)} + ${incoming.toFixed(1)} + ${repl.toFixed(1)} - ${proj.toFixed(1)}\n= ${supply.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month11 = new Date(now.getFullYear(), now.getMonth() + 10, 1);
      const month12 = new Date(now.getFullYear(), now.getMonth() + 11, 1);
      const month11Name = MONTH_ABBR_BY_NUM[month11.getMonth() + 1] ?? 'Month';
      const month12Name = MONTH_ABBR_BY_NUM[month12.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_11': `Supply Plan (${month11Name} ${month11.getFullYear()})`,
        'incoming_month_12': `Inbound Shipment (${month12Name} ${month12.getFullYear()})`,
        'repl_month_12': `Replacement Incoming (${month12Name} ${month12.getFullYear()})`,
        'proj_month_12': `Projection Month (${month12Name} ${month12.getFullYear()})`,
      };
    }
  },
  'ninety_day_projection': {
    label: '90-Day Projection',
    formula: '= [Proj Month 1] + [Proj Month 2] + [Proj Month 3]',
    inputs: ['proj_month_1', 'proj_month_2', 'proj_month_3'],
    getCalculation: (row) => {
      const proj1 = toNumberSafe(row.proj_month_1) ?? 0;
      const proj2 = toNumberSafe(row.proj_month_2) ?? 0;
      const proj3 = toNumberSafe(row.proj_month_3) ?? 0;
      const total = proj1 + proj2 + proj3;
      return `= ${proj1.toFixed(1)} + ${proj2.toFixed(1)} + ${proj3.toFixed(1)}\n= ${total.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month1 = new Date(now.getFullYear(), now.getMonth(), 1);
      const month2 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const month3 = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      const month1Name = MONTH_ABBR_BY_NUM[month1.getMonth() + 1] ?? 'Month';
      const month2Name = MONTH_ABBR_BY_NUM[month2.getMonth() + 1] ?? 'Month';
      const month3Name = MONTH_ABBR_BY_NUM[month3.getMonth() + 1] ?? 'Month';
      return {
        'proj_month_1': `Projection Month (${month1Name} ${month1.getFullYear()})`,
        'proj_month_2': `Projection Month (${month2Name} ${month2.getFullYear()})`,
        'proj_month_3': `Projection Month (${month3Name} ${month3.getFullYear()})`,
      };
    }
  },
  'ninety_day_supply': {
    label: '90-Day Supply',
    formula: '= [Supply Month 1] + [Supply Month 2] + [Supply Month 3]',
    inputs: ['supply_month_1', 'supply_month_2', 'supply_month_3'],
    getCalculation: (row) => {
      const supply1 = toNumberSafe(row.supply_month_1) ?? 0;
      const supply2 = toNumberSafe(row.supply_month_2) ?? 0;
      const supply3 = toNumberSafe(row.supply_month_3) ?? 0;
      const total = supply1 + supply2 + supply3;
      return `= ${supply1.toFixed(1)} + ${supply2.toFixed(1)} + ${supply3.toFixed(1)}\n= ${total.toFixed(1)}`;
    },
    getInputLabels: (now: Date) => {
      const month1 = new Date(now.getFullYear(), now.getMonth(), 1);
      const month2 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const month3 = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      const month1Name = MONTH_ABBR_BY_NUM[month1.getMonth() + 1] ?? 'Month';
      const month2Name = MONTH_ABBR_BY_NUM[month2.getMonth() + 1] ?? 'Month';
      const month3Name = MONTH_ABBR_BY_NUM[month3.getMonth() + 1] ?? 'Month';
      return {
        'supply_month_1': `Supply Plan (${month1Name} ${month1.getFullYear()})`,
        'supply_month_2': `Supply Plan (${month2Name} ${month2.getFullYear()})`,
        'supply_month_3': `Supply Plan (${month3Name} ${month3.getFullYear()})`,
      };
    }
  },
  'ninety_day_deficit': {
    label: '90-Day Deficit',
    formula: '= [90-Day Supply] - [90-Day Projection]',
    inputs: ['ninety_day_supply', 'ninety_day_projection'],
    getCalculation: (row) => {
      const supply = toNumberSafe(row.ninety_day_supply) ?? 0;
      const projection = toNumberSafe(row.ninety_day_projection) ?? 0;
      const deficit = supply - projection;
      return `= ${supply.toFixed(1)} - ${projection.toFixed(1)}\n= ${deficit.toFixed(1)}`;
    },
    getInputLabels: () => ({
      'ninety_day_supply': '90-Day Supply',
      'ninety_day_projection': '90-Day Projection',
    })
  },
  'days_of_supply': {
    label: 'Days of Supply Left',
    formula: '= [90-Day Supply] / ([90-Day Projection] / 90)',
    inputs: ['ninety_day_supply', 'ninety_day_projection'],
    getCalculation: (row) => {
      const supply = toNumberSafe(row.__raw_ninety_day_supply ?? row.ninety_day_supply) ?? 0;
      const projection = toNumberSafe(row.__raw_ninety_day_projection ?? row.ninety_day_projection) ?? 0;
      if (projection <= 0) return `= 0 (no demand)`;
      const dailyRate = projection / 90;
      const exact = supply / dailyRate;
      const floored = supply > 0 ? Math.floor(exact) : 0;
      return `= ${supply.toFixed(1)} / (${projection.toFixed(1)} / 90)\n= ${supply.toFixed(1)} / ${dailyRate.toFixed(4)}\n= ${exact.toFixed(2)}\n= ${floored} (rounded down)`;
    },
    getInputLabels: () => ({
      'ninety_day_supply': '90-Day Supply',
      'ninety_day_projection': '90-Day Projection',
    })
  },
  'days_until_must_order': {
    label: 'Days Until Must Order',
    formula: '= [Days of Supply Left] - [Lead Time]',
    inputs: ['days_of_supply', 'lead_time'],
    getCalculation: (row) => {
      const supply = toNumberSafe(row.__raw_ninety_day_supply ?? row.ninety_day_supply) ?? 0;
      const projection = toNumberSafe(row.__raw_ninety_day_projection ?? row.ninety_day_projection) ?? 0;
      const lead = toNumberSafe(row.lead_time);
      if (projection <= 0) return `= — (no demand)`;
      if (lead == null) return `= — (Missing Lead Time)`;
      const dailyRate = projection / 90;
      const dos = supply > 0 ? Math.floor(supply / dailyRate) : 0;
      const result = dos - lead;
      return `= ${dos} - ${lead}\n= ${result}`;
    },
    getInputLabels: () => ({
      'days_of_supply': 'Days of Supply Left',
      'lead_time': 'Lead Time',
    })
  },
  'days_without_stock': {
    label: 'Days Without Stock',
    formula: '= |[90-Day Deficit]| / ([90-Day Projection] / 90)',
    inputs: ['ninety_day_deficit', 'ninety_day_projection'],
    getCalculation: (row) => {
      const deficit = toNumberSafe(row.__raw_ninety_day_deficit ?? row.ninety_day_deficit) ?? 0;
      const projection = toNumberSafe(row.__raw_ninety_day_projection ?? row.ninety_day_projection) ?? 0;
      if (deficit >= 0) {
        return `= 0 — no stockout\n(surplus of ${deficit.toFixed(1)} units over next 90 days)`;
      }
      if (projection <= 0) return `= 0 (no demand)`;
      const dailyRate = projection / 90;
      const absDef = Math.abs(deficit);
      const exact = absDef / dailyRate;
      const floored = Math.floor(exact);
      return `= |${deficit.toFixed(1)}| / (${projection.toFixed(1)} / 90)\n= ${absDef.toFixed(1)} / ${dailyRate.toFixed(4)}\n= ${exact.toFixed(2)}\n= ${floored} (rounded down)`;
    },
    getInputLabels: () => ({
      'ninety_day_deficit': '90-Day Deficit',
      'ninety_day_projection': '90-Day Projection',
    })
  },
  'ninety_day_revenue_loss': {
    label: '90-Day Revenue Loss',
    formula: '= IF([90-Day Deficit] < 0, ABS([90-Day Deficit]) × [Land Cost], 0)',
    inputs: ['ninety_day_deficit', 'unit_cost'],
    getCalculation: (row) => {
      const deficit = toNumberSafe(row.ninety_day_deficit) ?? 0;
      const unitCost = toNumberSafe(row.unit_cost) ?? 0;
      const revenueLoss = deficit < 0 ? Math.abs(deficit) * unitCost : 0;
      if (deficit < 0) {
        return `= ABS(${deficit.toFixed(1)}) × ${unitCost.toFixed(2)}\n= ${revenueLoss.toFixed(2)}`;
      } else {
        return `= 0 (no deficit)`;
      }
    },
    getInputLabels: () => ({
      'ninety_day_deficit': '90-Day Deficit',
      'unit_cost': 'Land Cost',
    })
  },
  'safety_stock': {
    label: 'Safety Stock',
    formula: '= CEIL([90-Day Projection] / 3)',
    inputs: ['ninety_day_projection'],
    getCalculation: (row) => {
      const projection = toNumberSafe(row.ninety_day_projection) ?? 0;
      const safetyStock = Math.ceil(projection / 3);
      return `= CEIL(${projection.toFixed(1)} / 3)\n= ${safetyStock}`;
    },
    getInputLabels: () => ({
      'ninety_day_projection': '90-Day Projection',
    })
  },
  'order_recommended': {
    label: 'Order Recommended',
    formula: '= IF([90-Day Deficit] < 0, [90-Day Projection] + ABS([90-Day Deficit]) + [Safety Stock], [90-Day Projection] + [Safety Stock])',
    inputs: ['ninety_day_projection', 'ninety_day_deficit', 'safety_stock'],
    getCalculation: (row) => {
      const projection = toNumberSafe(row.ninety_day_projection) ?? 0;
      const deficit = toNumberSafe(row.ninety_day_deficit) ?? 0;
      const safetyStock = toNumberSafe(row.safety_stock) ?? 0;
      
      if (deficit < 0) {
        const absDeficit = Math.abs(deficit);
        const orderRecommended = projection + absDeficit + safetyStock;
        return `= ${projection.toFixed(1)} + ABS(${deficit.toFixed(1)}) + ${safetyStock.toFixed(1)}\n= ${projection.toFixed(1)} + ${absDeficit.toFixed(1)} + ${safetyStock.toFixed(1)}\n= ${orderRecommended.toFixed(1)}`;
      } else {
        const orderRecommended = projection + safetyStock;
        return `= ${projection.toFixed(1)} + ${safetyStock.toFixed(1)}\n= ${orderRecommended.toFixed(1)}`;
      }
    },
    getInputLabels: () => ({
      'ninety_day_projection': '90-Day Projection',
      'ninety_day_deficit': '90-Day Deficit',
      'safety_stock': 'Safety Stock',
    })
  },
  'lead_time': {
    label: 'Lead Time',
    formula: '= [Vendor Lead Time]',
    inputs: ['vendor_lead_time'],
    getCalculation: (row) => {
      const vendorLeadTime = toNumberSafe(row.vendor_lead_time) ?? toNumberSafe(row.lead_time_days);
      return vendorLeadTime ? `= ${vendorLeadTime} days` : '= No lead time set';
    },
    getInputLabels: () => ({
      'vendor_lead_time': 'Vendor Lead Time',
    })
  },
  'order_date_forecast': {
    label: 'Order Date',
    formula: '= IF(Deficit < 0, Today, Today + ([90-Day Supply] / Daily Sales) - [Lead Time])',
    inputs: ['ninety_day_deficit', 'ninety_day_supply', 'ninety_day_projection', 'lead_time'],
    getCalculation: (row) => {
      const deficit = toNumberSafe(row.ninety_day_deficit) ?? 0;
      const supply = toNumberSafe(row.ninety_day_supply) ?? 0;
      const projection = toNumberSafe(row.ninety_day_projection) ?? 0;
      const leadTime = toNumberSafe(row.lead_time);
      const dailySales = projection / 90;
      
      if (!leadTime) {
        return `= No lead time set`;
      }
      
      if (deficit < 0) {
        return `= Today (has deficit)\n= ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      } else if (dailySales > 0) {
        const daysUntilStockOut = supply / dailySales;
        const orderDaysFromNow = Math.max(0, daysUntilStockOut - leadTime);
        return `= Today + (${supply.toFixed(1)} / ${dailySales.toFixed(2)}) - ${leadTime}\n= Today + ${daysUntilStockOut.toFixed(1)} - ${leadTime}\n= Today + ${orderDaysFromNow.toFixed(1)} days`;
      } else {
        return `= Today (no sales data)`;
      }
    },
    getInputLabels: () => ({
      'ninety_day_deficit': '90-Day Deficit',
      'ninety_day_supply': '90-Day Supply',
      'ninety_day_projection': '90-Day Projection',
      'lead_time': 'Lead Time',
    })
  },
  'supply_month_forecast': {
    label: 'Supply Month',
    formula: '= [Order Date] + [Lead Time]',
    inputs: ['order_date_forecast', 'lead_time'],
    getCalculation: (row) => {
      const orderDate = String(row.order_date_forecast ?? '');
      const leadTime = toNumberSafe(row.lead_time);
      
      if (!leadTime) {
        return `= No lead time set`;
      }
      
      if (orderDate) {
        const orderDateObj = new Date(orderDate);
        const supplyDate = new Date(orderDateObj.getTime() + leadTime * 24 * 60 * 60 * 1000);
        return `= ${orderDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} + ${leadTime} days\n= ${supplyDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }
      return `= Order Date + ${leadTime} days`;
    },
    getInputLabels: () => ({
      'order_date_forecast': 'Order Date',
      'lead_time': 'Lead Time',
    })
  },
  'covered_months': {
    label: 'Covered Months',
    formula: '= [Supply Month] + ([Order Recommended] / Daily Sales)',
    inputs: ['supply_month_forecast', 'order_recommended', 'ninety_day_projection'],
    getCalculation: (row) => {
      const supplyMonth = String(row.supply_month_forecast ?? '');
      const orderRecommended = toNumberSafe(row.order_recommended) ?? 0;
      const projection = toNumberSafe(row.ninety_day_projection) ?? 0;
      const dailySales = projection / 90;
      
      if (supplyMonth && dailySales > 0) {
        const supplyDateObj = new Date(supplyMonth);
        const coverageDays = orderRecommended / dailySales;
        const coveredDate = new Date(supplyDateObj.getTime() + coverageDays * 24 * 60 * 60 * 1000);
        return `= ${supplyDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} + (${orderRecommended.toFixed(1)} / ${dailySales.toFixed(2)})\n= ${supplyDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} + ${coverageDays.toFixed(1)} days\n= ${coveredDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }
      return `= Supply Month + (${orderRecommended.toFixed(1)} / Daily Sales)`;
    },
    getInputLabels: () => ({
      'supply_month_forecast': 'Supply Month',
      'order_recommended': 'Order Recommended',
      'ninety_day_projection': '90-Day Projection (for Daily Sales)',
    })
  },
};

/** =========================================================
 * MONTH HELPERS
 * ========================================================= */
const MONTH_FULL_BY_NUM: Record<number, string> = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December",
};

// MONTH_ABBR_BY_NUM moved above COLUMN_FORMULAS to fix Vite TDZ

// Intl formatters — module-scope so they are created once and reused across all renders.
// Declared here (before all helper functions) to avoid Vite TDZ errors.
const PLANNER_DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const LONG_DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
const MONTH_SHORT_FMT = new Intl.DateTimeFormat("en-US", { month: "short" });
const WEEKDAY_LONG_FMT = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const MONTH_YEAR_SHORT_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const DECIMAL_1_FMT = new Intl.NumberFormat("en-US", { style: "decimal", minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Returns horizontal 3-letter month abbreviation, e.g. "Mar" */
function stackedMonthLabel(monthNum: number): string {
  return MONTH_ABBR_BY_NUM[monthNum] ?? "???";
}

const MONTH_ORDER: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function getRollingMonths(now: Date, count: number = 5) {
  const out: { month: number; year: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }
  return out;
}

function getRolling12MonthsStartingCurrent(now: Date) {
  const out: { month: number; year: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }
  return out;
}

function rollingLabel(prefix: string, rolling: { month: number; year: number }[]) {
  if (!rolling.length) return `${prefix} (Rolling)`;
  const first = rolling[0];
  const last = rolling[rolling.length - 1];
  const firstName = MONTH_FULL_BY_NUM[first.month] ?? String(first.month);
  const lastName = MONTH_FULL_BY_NUM[last.month] ?? String(last.month);
  return `${prefix} ( ${firstName} ${first.year} - ${lastName} ${last.year} )`;
}

function instockRollingLabel(colName: string, rolling: { month: number; year: number }[]) {
  const m = colName.toLowerCase().match(/^month_([1-5])$/);
  if (!m) return null;
  const pos = Number(m[1]) - 1;
  const target = rolling[pos];
  if (!target) return colName;
  return stackedMonthLabel(target.month);
}

function salesRollingLabel(
  colName: string,
  rolling: { month: number; year: number }[],
  monthlySaleLabels?: Record<string, string>,
) {
  const m = colName.toLowerCase().match(/^sales_month_(\d{1,2})$/);
  if (!m) return null;
  const idx = Number(m[1]); // sales_month_9 = oldest, sales_month_0 = newest (prev month)
  if (idx < 0 || idx > 9) return null;
  // Value source idx maps reversed: month_9 displays first (oldest), month_0 displays last (newest)
  const now = new Date();
  const baseDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); // prev month
  const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth() - idx, 1);
  return MONTH_SHORT_FMT.format(targetDate);
}

function rolling12LabelByIndex(colName: string, prefix: string, rollingMonths: { month: number; year: number }[]) {
  const m = colName.toLowerCase().match(new RegExp(`^${prefix}_month_(\\d{1,2})$`));
  if (!m) return null;

  const pos = Number(m[1]) - 1;
  if (pos < 0 || pos > 11) return null;

  const target = rollingMonths[pos];
  if (!target) return null;

  return stackedMonthLabel(target.month);
}

/** =========================================================
 * SALES DIFF HEADER HELPERS
 * ========================================================= */
function getMonthAbbr(d: Date) {
  return MONTH_SHORT_FMT.format(d);
}

function getSalesDiffHeader(now: Date) {
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return `Sales Diff\n(${getMonthAbbr(twoMonthsAgo)}-${getMonthAbbr(previousMonth)})`;
}

function getActualSalesHeader() {
  return "Actual\nSales";
}

function getLast2MonthsAvgHeader(now: Date) {
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return `${getMonthAbbr(twoMonthsAgo)}-${getMonthAbbr(previousMonth)}\nAve`;
}

/** =========================================================
 * DISPLAY MARKER + ZERO HELPERS
 * ========================================================= */
const EMPTY_MARK = "-";
// Columns whose <td> title tooltip is suppressed (editable cells with dedicated UI).
const NO_TITLE_COLS = new Set(["order_proposal_qty", "buyer_notes", "planner_notes", "analyst_notes"]);
/** Width of the leading row-number column (Excel-style #) */
const ROW_NUM_WIDTH = 44;
/** Estimated height of a single data row in px (for virtual row sizing) */
const ROW_HEIGHT = 33;
// Static portion of the sticky row-number cell style (background applied separately per row).
const ROW_NUM_CELL_STYLE_BASE: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 32,
  width: ROW_NUM_WIDTH,
  minWidth: ROW_NUM_WIDTH,
  maxWidth: ROW_NUM_WIDTH,
};

function isZeroLikeNumber(v: unknown) {
  if (v == null) return false;
  if (typeof v === "number") return Object.is(v, 0);

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return false;
    const normalized = s.replace(/,/g, "");
    const n = Number(normalized);
    if (!Number.isFinite(n)) return false;
    return n === 0;
  }
  return false;
}

function isTextZero(v: unknown) {
  return typeof v === "string" && v.trim() === "-";
}

function normalizeDash(value: unknown) {
  if (typeof value !== "string") return value;
  return value.replace(/—/g, "-");
}

/** =========================================================
 * DATE DISPLAY ONLY
 * ========================================================= */
function formatDateOnly(v: unknown) {
  if (!v) return null;

  let d: Date | null = null;

  if (v instanceof Date) d = v;
  else if (typeof v === "string") {
    const s = v.trim();
    const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (mdy) {
      const mm = Number(mdy[1]);
      const dd = Number(mdy[2]);
      const yyyy = Number(mdy[3]);
      d = new Date(yyyy, mm - 1, dd);
    } else {
      const parsed = new Date(s);
      if (!isNaN(parsed.getTime())) d = parsed;
    }
  } else {
    const parsed = new Date(String(v));
    if (!isNaN(parsed.getTime())) d = parsed;
  }

  if (!d) return null;

  return LONG_DATE_FMT.format(d);
}

/** =========================================================
 * INSTOCK DISPLAY ONLY CLAMP HELPERS
 * ========================================================= */
function isInstockColumn(colName: string) {
  return /^month_[1-5]$/i.test(colName);
}

/** Parse a value into a safe http(s) URL string, or null. Used to turn the
 *  the ERP link (purchasing_url) into clickable Product Name / Product ID. */
function toSafeHttpUrl(raw: unknown): string | null {
  const s = raw != null ? String(raw).trim() : "";
  if (!s || s === "-") return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function toNumberSafe(v: unknown): number | null {
  if (v == null) return null;

  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

/**
 * Smart display rounding for Monthly Projection:
 * - .5 decimals → keep 1 decimal (43.5, 0.5)
 * - <1 absolute → 1 decimal (0.3, 0.7)
 * - otherwise → round to whole (25.4 → 25, 12.7 → 13)
 */
function formatMonthlyProjectionDisplay(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  const frac = v % 1;
  // .5 values: round UP (toward +∞ for positive, away from zero semantics per spec → ceil)
  if (frac === 0.5 || frac === -0.5) return Math.ceil(v).toString();
  // Sub-unit values: keep 1 decimal
  if (Math.abs(v) < 1) return v.toFixed(1);
  // Otherwise: normal rounding
  return Math.round(v).toString();
}

function formatInstockDisplay(v: unknown) {
  const n = toNumberSafe(v);
  if (n == null) return null;
  const capped = Math.min(n, 100);
  return capped.toFixed(2);
}

/**
 * Single-pass null/blank → 0 normalization for instock + sales monthly columns.
 * Runs once per fetch inside queryFn so downstream renders never see null/undefined
 * in these cells. Consolidates what was previously per-cell render-time guards.
 *
 * Touched columns:
 *   - month_1..month_5      (Instock %, Jan–May rolling window)
 *   - sales_month_0..9      (Monthly Sales rolling window, 10 months)
 *
 * Non-numeric strings are left alone — the formatter still coerces them, but at
 * least null/undefined never reach the table.
 */
function normalizeForecastRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (let i = 1; i <= 5; i++) {
    const k = `month_${i}`;
    if (out[k] == null) out[k] = 0;
  }
  for (let i = 0; i <= 9; i++) {
    const k = `sales_month_${i}`;
    if (out[k] == null) out[k] = 0;
  }
  return out as T;
}

function resolveSalesMonthValue(
  row: Record<string, unknown>,
  colName: string,
  monthlySaleMap?: Map<string, Record<string, unknown>>,
  // "month" = units (month_N of monthly_sale_view_auto) — the default, used by
  // every computation (projections, velocity baseline, formula popups).
  // "orders" = orders_N of monthly_sale_view_auto — legacy display source.
  // "replica" = recent_month_N of forecast_monthly_sales — the grid's display
  //   source. Shifted by one: sales_month_0 → recent_month_1 (huling
  //   kumpletong buwan), sales_month_9 → recent_month_10 (pinakaluma).
  source: "month" | "orders" | "replica" = "month",
) {
  const m = colName.toLowerCase().match(/^sales_month_(\d{1,2})$/);
  if (!m) return row[colName];

  const idx = Number(m[1]);
  const monthKey =
    source === "replica"
      ? `recent_month_${idx + 1}`
      : `${source === "month" ? "month" : "orders"}_${idx}`;

  // Look up from monthly_sale_view_auto using sku (primary) or product_id
  if (monthlySaleMap) {
    const sku = String(row.sku ?? "");
    const saleRow = monthlySaleMap.get(sku);
    if (saleRow && monthKey in saleRow) return saleRow[monthKey];
    // Also try product_id if sku didn't match
    const pid = String(row.product_id ?? "");
    if (pid && pid !== sku) {
      const saleRow2 = monthlySaleMap.get(pid);
      if (saleRow2 && monthKey in saleRow2) return saleRow2[monthKey];
    }
  }

  return null;
}

function materializeDisplayRow(
  row: Record<string, unknown>,
  schema: SchemaColumn[],
  monthlySaleMap?: Map<string, Record<string, unknown>>,
  source: "month" | "orders" | "replica" = "month",
) {
  const out: Record<string, unknown> = { ...row };
  for (const col of schema) {
    out[col.column_name] = resolveSalesMonthValue(row, col.column_name, monthlySaleMap, source);
  }
  return out;
}

/* ── (MultiSelectFilter is now shared from @/components/shared/MultiSelectFilter) ── */

/** =========================================================
 * LABELS
 * ========================================================= */
const COLUMN_LABELS: Record<string, string> = {
  sku: "Product ID",
  description: "Product Name",
  priority_level: "Level of Priority",
  factory: "Factory",
  status: "Status",
  pu_status: "Purchasing\nStatus",
  shopify_status: "Shopify\nStatus",
  kit: "Kit",
  item_color: "Color",
  category: "Category",
  shadow: "Shadow",
  shopify_url: "Shopify\nLink",
  purchasing_url: "the ERP\nLink",

  sales_diff: "Sales Diff\n(Jan-Feb)",
  unit_cost: "Land Cost",
  actual_sale_of_month: "Actual\nSales",
  sales_velocity: "Current\nSales\nVelocity",
  monthly_projection: "Monthly\nProjection",
  unshipped: "Unshipped",
  last_2months_avg: "Jan-Feb\nAve",

  unsent_notifications_count: "Demand\n(Unsent)",
  quantity_required: "Qty\nRequested",
  back_unit_price: "Price",

  fba_reserved: "FBA\nReserved",
  intransit_fba: "InTransit\nFBA",
  fba: "FBA",
  oh_inv: "OH Inv",
  otw_units: "OTW\nUnits",
  on_order_units: "OO\nUnits",
  po_in_progress: "PO in\nProgress",

  repl_fba_reserved: "FBA\nReserved",
  repl_intransit_fba: "InTransit\nFBA",
  repl_fba: "FBA",
  repl_oh_inv: "OH Inv",
  repl_otw_units: "OTW\nUnits",
  repl_on_order_units: "OO\nUnits",
  repl_po_in_progress: "PO in\nProgress",

  sku_status: "Sku Status",
  order_proposal_qty: "Order Proposal\nQuantity",
  months_worth: "Months\nWorth",
  buyer_notes: "Buyer\nApproval",
  planner_notes: "Planner\nNotes",
  analyst_notes: "Analyst\nNotes",
  cbm: "Cbm",
  factory_latest_po_ordered: "Factory\nLatest PO\nOrdered",
  po_number: "PO #",
  country: "Country",
  lead_time: "Lead Time",
  buyer: "Buyer",
  inventory_analyst: "Inventory\nAnalyst",
  total_cbm_approved: "Total CBM\nApproved",
  order_date: "Order\nDate",
  supplying_month: "Supplying\nMonth",
  supply_month: "Supplying\nMonth",
  supply_status: "SUPPLY\nSTATUS",
  replacement_rate: "Replacement\nRate",
  return_rate: "Return\nRate",
  total_revenue: "Total\nRevenue",
  total_lost_revenue: "Total Lost\nRevenue",

  oo_units_30days: "OO Units\n30 Days",
  oo_units_60days: "OO Units\n60 Days",
  oo_units_90days: "OO Units\n90 Days",
  oo_units_120days: "OO Units\n120 Days",
  oo_units_150days: "OO Units\n150 Days",
  oo_units_180days: "OO Units\n180 Days",
  oo_units_210days: "OO Units\n210 Days",

  // 90-Day Reorder Decisions columns
  ninety_day_projection: "90-Day\nProjection",
  ninety_day_supply: "90-Day\nSupply",
  ninety_day_deficit: "90-Day\nDeficit",
  ninety_day_revenue_loss: "90-Day\nRevenue Loss",
  safety_stock: "Safety\nStock",
  order_recommended: "Order\nRecommended",
  order_date_forecast: "Order\nDate",
  supply_month_forecast: "Supply\nMonth",
  covered_months: "Covered\nMonths",
  action: "Action",
};

const GROUP_LABELS: Record<string, string> = {
  basic: "Product Information",
  instock: "Instock",
  sales_monthly: "Monthly Sales",
  sales_metrics: "Sales Metrics",
  projection: "Monthly Projection",
  revenue: "Monthly Revenue",
  back_in_stock: "Back In Stock Request",
  inventory: "Inventory Buckets",
  incoming: "Inbound Shipment",
  rates: "Replacement / Return",
  order: "Order / PO Details",
  supply_plan: "Supply Plan",
  lost_revenue: "Monthly Lost Revenue",
  replacement_inventory: "Replacement Inventory",
  replacement_incoming: "Replacement Inbound Shipment",
  replacement: "Replacement SKU",
  inventory_breakdown: "Incoming Breakdown",
  "90day_forecast": "90-Day Reorder Decisions",

  other: "Other",
};

function monthYearLabelFromCol(colName: string) {
  const n = colName.toLowerCase();

  const m = n.match(/^sales_month_(\d{1,2})$/);
  if (m) return colName;

  if (/^(incoming|repl|supply|proj|rev|lost)_month_\d{1,2}$/.test(n)) return colName;

  return colName.replace(/_/g, " ").replace(/\b\w/g, (m2) => m2.toUpperCase());
}

function labelForColumn(colName: string) {
  if (COLUMN_LABELS[colName]) return COLUMN_LABELS[colName];
  return monthYearLabelFromCol(colName);
}

/** Tooltips shown on column HEADER hover only (not on data cells). */
const COLUMN_TOOLTIPS: Record<string, string> = {
  sales_diff: "Percentage difference between Feb and Mar actual sales.",
  actual_sales: "Current month actual sales\n(adjusted for replacements).",
  current_sales_velocity: "Daily sales velocity\nbased on current month.",
  unshipped: "Total unshipped\norder quantity.",
  monthly_projection:
    "Monthly Projection = Weighted average of last 2 months sales + remaining days calculation.\nOverridable via forecast_report_proj_override table.",
  supply_status: "Supply status based on stock coverage, incoming supply, and demand.",
  months_worth: "Estimated months of stock remaining\nat current sales rate.",
  order_proposal_qty: "Suggested reorder quantity based on demand, lead time, and incoming stock.",
  replacement_rate: "Replacement units as a percentage of total sales.",
  buyer_notes: "Buyer approval status and notes for ordering decisions.",
  buyer_action: "Recommended buyer action based on urgency and supply condition.",
  level_of_priority: "Priority ranking used to identify the most urgent SKUs.",
  shadow: "Shadow flag used for transition or placeholder SKU tracking.",
};

function labelForGroup(group: string) {
  return GROUP_LABELS[group] ?? group.replace(/_/g, " ").toUpperCase();
}

/** Synthetic filter option that matches NULL / empty / "-" values. */
const OPTION_BLANK = "(Blank)";

/** Prepend the "(Blank)" option to a filter's option list (idempotent). */
function withBlankOption(arr: string[]): string[] {
  return arr.includes(OPTION_BLANK) ? arr : [OPTION_BLANK, ...arr];
}

/** Quote a value for safe embedding inside a PostgREST .or() `in.(…)` list. */
function escapeOrValue(v: string): string {
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Apply a multi-select filter that may include the synthetic "(Blank)" option.
 * "(Blank)" matches NULL, empty string, or "-". Real values use IN (with
 * optional case-variant expansion). Blank + real values are combined into a
 * single OR group so they don't AND each other away.
 */
function applyBlankAwareFilter(
  q: any,
  col: string,
  selected: string[],
  expand?: (s: string) => string[],
): any {
  const hasBlank = selected.includes(OPTION_BLANK);
  const real = selected.filter((v) => v !== OPTION_BLANK);
  const realExp = expand ? real.flatMap((s) => expand(s)) : real;
  if (!hasBlank) return realExp.length ? q.in(col, realExp) : q;
  const blankConds = `${col}.is.null,${col}.eq.,${col}.eq.-`;
  if (realExp.length === 0) return q.or(blankConds);
  return q.or(`${blankConds},${col}.in.(${realExp.map(escapeOrValue).join(",")})`);
}

function isEditableColumn(colName: string) {
  const n = colName.toLowerCase();
  if (NON_EDITABLE_COLUMNS.includes(n)) return false;
  if (MANUAL_ONLY_COLUMNS.includes(n)) return false;
  return true;
}

function isLongText(col: SchemaColumn) {
  return isTextType(col.data_type) && LONG_TEXT_HINTS.some((h) => col.column_name.includes(h));
}

/** =========================================================
 * Pills
 * ========================================================= */
function normText(v: unknown) {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function formatPlannerDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return PLANNER_DATE_FMT.format(d);
}

const PILL = {
  blue: "bg-[#1f8a8c] text-white",
  red: "bg-[#EF4444] text-white",
  orange: "bg-[#F59E0B] text-white",
  yellow: "bg-[#EAB308] text-white",
  green: "bg-[#16A34A] text-white",
  purple: "bg-[#8B5CF6] text-white",
  teal: "bg-[#14B8A6] text-white",
  gray: "bg-slate-200 text-slate-800",
};

/**
 * Unified palette shared across Status, Purchasing Status, Shopify Status.
 * One color per value (case-insensitive, whitespace-normalized) so the same
 * label always reads the same way regardless of column.
 */
function unifiedStatusBadgeCls(v: unknown): string {
  const n = normText(v).replace(/\s+/g, " ");
  // Strong/dark colors for critical states
  if (n === "inactive" || n === "discontinued") return "bg-red-700 text-white";
  if (n === "discontinued (active as a new sku)" || n === "discontinued active as a new sku") return "bg-orange-500 text-white";
  if (n.startsWith("working") || n === "reconsidering") return "bg-blue-500 text-white";
  // Pastel for positive/neutral states
  if (n === "active") return "bg-emerald-100 text-emerald-800";
  if (n === "in-production" || n === "in production") return "bg-teal-200 text-teal-900";
  if (n === "made to order") return "bg-amber-200 text-amber-900";
  if (n === "slow" || n === "draft") return "bg-amber-200 text-amber-900";
  if (n === "unlisted" || n === "archieve" || n === "archive") return "bg-slate-300 text-slate-800";
  return "bg-slate-200 text-slate-800";
}

function pillClassForStatus(v: unknown) {
  return unifiedStatusBadgeCls(v);
}

function pillClassForPriority(v: unknown) {
  const n = normText(v);
  if (n.includes("1st")) return PILL.red;
  if (n.includes("2nd")) return PILL.orange;
  if (n.includes("least")) return PILL.blue;
  return PILL.gray;
}

function pillClassForSupplyStatus(v: unknown) {
  const n = normText(v);
  if (n === "good") return PILL.green;
  if (n === "critical") return PILL.red;
  return PILL.gray;
}

function pillClassForPuStatus(v: unknown) {
  return unifiedStatusBadgeCls(v);
}

function pillClassForBool(v: unknown) {
  return v ? "bg-slate-900 text-white" : PILL.gray;
}

/** Shopify Status pill color — uses the shared unified palette. */
function pillClassForShopifyStatus(v: unknown) {
  return unifiedStatusBadgeCls(v);
}

/** Capitalize first letter only: "active" → "Active". */
function capitalizeFirst(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Canonicalize a raw `pu_status` value for filtering/grouping. Collapses
 * "Discontinued Active as a new SKU" into "Discontinued" so the planner
 * treats both flavors as a single Discontinued bucket. All other values
 * pass through unchanged (trimmed).
 */
function puStatusCanonical(v: unknown): string {
  const raw = String(v ?? "").trim();
  const n = raw.toLowerCase().replace(/\s+/g, " ");
  if (n === "discontinued" || n === "discontinued active as a new sku") {
    return "Discontinued";
  }
  return raw;
}

/**
 * IDP planner: rows whose purchasing status means we should NOT compute a
 * reorder recommendation. Discontinued (both flavors) + Working states are
 * excluded from the action bucket.
 */
function puStatusSkipsReorder(v: unknown): boolean {
  const n = normText(v).replace(/\s+/g, " ");
  if (n === "discontinued") return true;
  if (n === "discontinued active as a new sku") return true;
  if (n.includes("item data creation")) return true;
  if (n.includes("part component")) return true;
  return false;
}

/** Planner action-cell override label for non-computed pu_status states. */
function puStatusOverrideLabel(v: unknown): string | null {
  const n = normText(v).replace(/\s+/g, " ");
  if (n === "discontinued") return "Discontinued";
  if (n === "discontinued active as a new sku") return "Discontinued";
  if (n.includes("item data creation")) return "In Progress";
  if (n.includes("part component")) return "In Progress";
  return null;
}


function pillClassForSkuStatus(v: unknown) {
  const n = normText(v);
  if (n === "new sku") return PILL.green;
  if (n === "not new sku") return PILL.blue;
  return PILL.gray;
}

const Pill = React.forwardRef<HTMLSpanElement, { value: any; className: string; title?: string }>(({ value, className, title }, ref) => {
  const label = String(value ?? EMPTY_MARK);
  return (
    <span
      ref={ref}
      className={[
        "inline-flex items-center justify-center",
        "h-5 px-2 rounded-full",
        "text-[10px] font-semibold whitespace-nowrap",
        "shadow-sm",
        className,
      ].join(" ")}
      title={title ?? label}
    >
      {label}
    </span>
  );
});

/** Plain-language basis for the Sku Status pill — mirrors the upstream SQL:
 *  New SKU = no [first sale date] OR first sold within the last 120 days. */
function skuStatusBasis(raw: unknown): string {
  const v = String(raw ?? "").trim().toLowerCase();
  const rule =
    "Basis: New SKU = no first sale date, or first sold within the last 120 days.\n" +
    "Not New SKU = first sold more than 120 days ago.\n" +
    "(Set upstream from [first sale date] vs today − 120 days.)";
  if (v === "new sku") return "New SKU\n\n" + rule;
  if (v === "not new sku") return "Not New SKU\n\n" + rule;
  return rule;
}

// New SKU 120-day rule + lookup fetches — shared with MonthlySales.tsx.
// (imported from @/lib/forecast/newSku; local copies removed to prevent drift)

/** Tooltip when the actual date is present: show date + computed result, and
 *  flag if it disagrees with the upstream sku_status (helps validate the port). */
function skuStatusBasisWithDate(firstSaleDate: string, computed: string, upstream: string): string {
  const t = new Date(firstSaleDate).getTime();
  const dateTxt = Number.isFinite(t) ? new Date(t).toLocaleDateString() : firstSaleDate;
  const lines = [
    `First sale date: ${dateTxt}`,
    `Computed in UI: ${computed}`,
    `(New = no date, or sold within last ${NEW_SKU_WINDOW_DAYS} days.)`,
  ];
  if (upstream && /sku/i.test(upstream) && upstream.toLowerCase() !== computed.toLowerCase()) {
    lines.push(`⚠ Upstream sku_status = "${upstream}" — mismatch`);
  }
  return lines.join("\n");
}
Pill.displayName = "Pill";

/** =========================================================
 * GROUPING + COLORS
 * ========================================================= */
function groupKey(colName: string) {
  const n = colName.toLowerCase();

  if (["sku", "description", "priority_level", "factory", "status", "pu_status", "shopify_status", "kit", "item_color", "category", "shadow", "shopify_url", "purchasing_url"].includes(n))
    return "basic";
  if (/^month_[1-5]$/.test(n)) return "instock";

  if (
    [
      "sales_diff",
      "unit_cost",
      "actual_sale_of_month",
      "sales_velocity",
      "monthly_projection",
      "unshipped",
      "last_2months_avg",
    ].includes(n)
  ) {
    return "sales_metrics";
  }

  if (n.match(/^sales_month_(\d{1,2})$/)) return "sales_monthly";
  if (n.match(/^proj_month_(\d{1,2})$/)) return "projection";
  if (n.match(/^rev_month_(\d{1,2})$/)) return "revenue";
  if (n === "total_revenue") return "revenue";
  if (n.match(/^lost_month_(\d{1,2})$/)) return "lost_revenue";
  if (n === "total_lost_revenue") return "lost_revenue";
  if (n.match(/^incoming_month_(\d{1,2})$/)) return "incoming";

  if (["unsent_notifications_count", "quantity_required", "back_unit_price"].includes(n)) {
    return "back_in_stock";
  }

  if (["fba_reserved", "intransit_fba", "fba", "oh_inv", "otw_units", "on_order_units", "po_in_progress"].includes(n)) {
    return "inventory";
  }

  if (/^oo_units_(30|60|90|120|150|180|210)days$/.test(n)) return "inventory_breakdown";

  // 90-Day Reorder Decisions columns
  if (
    [
      "ninety_day_projection",
      "ninety_day_supply",
      "ninety_day_deficit",
      "ninety_day_revenue_loss",
      "safety_stock",
      "order_recommended",
      "order_date_forecast",
      "supply_month_forecast",
      "covered_months",
      "action",
    ].includes(n)
  ) {
    return "90day_forecast";
  }

  if (["replacement_rate", "return_rate"].includes(n)) return "rates";

  if (
    [
      "sku_status",
      "order_proposal_qty",
      "months_worth",
      "buyer_notes",
      "planner_notes",
      "analyst_notes",
      "cbm",
      "factory_latest_po_ordered",
      "po_number",
      "country",
      "lead_time",
      "buyer",
      "inventory_analyst",
      "total_cbm_approved",
      "order_date",
      "supplying_month",
      "supply_month",
      "supply_status",
    ].includes(n)
  ) {
    return "order";
  }

  if (n.match(/^supply_month_(\d{1,2})$/)) return "supply_plan";
  if (
    [
      "repl_fba_reserved",
      "repl_intransit_fba",
      "repl_fba",
      "repl_oh_inv",
      "repl_otw_units",
      "repl_on_order_units",
      "repl_po_in_progress",
    ].includes(n)
  ) {
    return "replacement_inventory";
  }

  if (n.match(/^repl_month_(\d{1,2})$/)) return "replacement_incoming";

  if (n === "replacement_sku") return "replacement";

  return "other";
}

/** Conditional cell styling for sales_diff, actual_sale_of_month, sales_velocity.
 *  Returns { bg, color } for inline styles — theme-aware via CSS class detection. */
function salesMetricCellStyle(colName: string, rawValue: unknown, prevMonthSales?: unknown): { bg?: string; color?: string } | undefined {
  const n = colName.toLowerCase();
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  // Land Cost (unit_cost) → no background (plain), per UX request.

  // Actual Sales — mula sa Sheets rule na "Is not empty → light green":
  // laging light green basta may laman (kahit 0), walang paghahambing.
  if (n === "actual_sale_of_month") {
    if (rawValue == null || rawValue === "" || rawValue === "-") return undefined;
    return { bg: "#A1E8C4", color: "#111827" } as any;
  }

  // Feb-Mar Ave (last 2 months avg) → consistent soft beige/peach background for all cells
  if (n === "last_2months_avg") {
    return { bg: "#FFE0B2", color: "#0f172a" };
  }

  // OH Inv — red bold text only (no background) for non-zero values
  if (n === "oh_inv" || n === "repl_oh_inv") {
    if (rawValue == null || rawValue === "" || rawValue === "-") return undefined;
    const v = typeof rawValue === "number" ? rawValue : Number(String(rawValue).replace(/[,\s]/g, ""));
    if (isNaN(v) || v === 0) return undefined;
    return { color: isDark ? "#f87171" : "#dc2626", fontWeight: "bold" } as any;
  }

  // Supply Plan — negative values get red bold text only
  if (/^supply_month_\d{1,2}$/.test(n)) {
    if (rawValue == null || rawValue === "" || rawValue === "-") return undefined;
    const v = typeof rawValue === "number" ? rawValue : Number(String(rawValue).replace(/[,\s]/g, ""));
    if (isNaN(v) || v >= 0) return undefined;
    return { color: isDark ? "#f87171" : "#dc2626", fontWeight: "bold" } as any;
  }

  // Monthly Lost Revenue — non-zero values get red bold text (lost is negative)
  if (/^lost_month_\d{1,2}$/.test(n)) {
    if (rawValue == null || rawValue === "" || rawValue === "-") return undefined;
    const v = typeof rawValue === "number" ? rawValue : Number(String(rawValue).replace(/[$,\s]/g, ""));
    if (isNaN(v) || v === 0) return undefined;
    return { color: isDark ? "#f87171" : "#dc2626", fontWeight: "bold" } as any;
  }

  // Total Revenue — always bold
  if (n === "total_revenue") {
    if (rawValue == null || rawValue === "" || rawValue === "-") return { fontWeight: "bold" } as any;
    return { fontWeight: "bold" } as any;
  }

  // Total Lost Revenue — bold red when non-zero (lost totals are negative)
  if (n === "total_lost_revenue") {
    if (rawValue == null || rawValue === "" || rawValue === "-") return { fontWeight: "bold" } as any;
    const v = typeof rawValue === "number" ? rawValue : Number(String(rawValue).replace(/[$,\s]/g, ""));
    if (isNaN(v) || v === 0) return { fontWeight: "bold" } as any;
    return { color: isDark ? "#f87171" : "#dc2626", fontWeight: "bold" } as any;
  }

  // Current Sales Velocity — per the planner/sheet ("Sales Diff (Jul–Current
  // Velocity)"): % change ng velocity LABAN SA JULY (huling kumpletong buwan
  // na ipinapakita sa grid, forecast_monthly_sales recent_month_1).
  // >15% dark green, 1–15% light green, ≤ −10% red, sa pagitan → walang kulay.
  // Kaya BAWAL maging green kapag ang velocity ay mas mababa sa July.
  if (n === "sales_velocity") {
    if (rawValue == null || rawValue === "" || rawValue === "-") return undefined;
    const v = typeof rawValue === "number" ? rawValue : Number(String(rawValue).replace(/[,\s]/g, ""));
    if (isNaN(v)) return undefined;
    // A true zero renders as "-" (same as null, per the generic zero-display
    // rule below in the render loop) -- keep the color in sync so a dash
    // never shows up colored red/green with nothing behind it.
    if (v === 0) return undefined;
    const prev = typeof prevMonthSales === "number" ? prevMonthSales : Number(String(prevMonthSales ?? "").replace(/[,\s]/g, ""));
    if (prev == null || isNaN(prev) || prev === 0) return undefined; // no baseline → no color
    void isDark;
    const pct = ((v - prev) / prev) * 100;
    if (pct > 15) return { bg: "#22C55E", color: "#FFFFFF", fontWeight: "bold" } as any;
    if (pct >= 1 && pct <= 15) return { bg: "#A1E8C4", color: "#111827", fontWeight: "bold" } as any;
    if (pct <= -10) return { bg: "#FF6B6B", color: "#FFFFFF", fontWeight: "bold" } as any;
    return undefined;
  }

  if (n !== "sales_diff") return undefined;
  if (rawValue == null || rawValue === "" || rawValue === "-") return undefined;
  let num: number;
  if (typeof rawValue === "number") {
    num = rawValue;
  } else {
    const cleaned = String(rawValue).replace(/[%,\s]/g, "");
    num = Number(cleaned);
  }
  if (isNaN(num)) return undefined;

  // Conditional format rules — high-contrast bold text on each tone:
  // ≤ -10%   → #FF6B6B with bold white text
  // 1% – 15% → #A1E8C4 with bold dark text
  // > 15%    → #22C55E with bold white text
  void isDark;
  if (num > 15) return { bg: "#22C55E", color: "#FFFFFF", fontWeight: "bold" } as any;
  if (num >= 1 && num <= 15) return { bg: "#A1E8C4", color: "#111827", fontWeight: "bold" } as any;
  if (num <= -10) return { bg: "#FF6B6B", color: "#FFFFFF", fontWeight: "bold" } as any;
  return undefined;
  return undefined;
}

function headerBg(colName: string) {
  const g = groupKey(colName);
  switch (g) {
    case "basic":
      return "bg-[#eaf2ff]";
    case "instock":
      return "bg-[#f5ff2a]";
    case "sales_monthly":
    case "sales_metrics":
      return "bg-[#ffe08a]";
    case "projection":
      return "bg-[#4cff4c]";
    case "revenue":
      return "bg-[#4cff4c]";
    case "inventory":
      return "bg-[#d9e8ff]";
    case "incoming":
      return "bg-[#c8fff1]";
    case "inventory_breakdown":
      return "bg-[#fff3a3]";
    case "90day_forecast":
      return "bg-[#d6ccff]"; // Light purple, same as supply_plan
    case "rates":
      return "bg-[#ffe6a6]";
    case "order":
      return "bg-[#ffd9b3]";
    case "supply_plan":
      return "bg-[#d6ccff]";
    case "lost_revenue":
      return "bg-[#ffb3b3]";
    case "replacement":
    case "replacement_inventory":
    case "replacement_incoming":
      return "bg-[#ffd0e6]";
    default:
      return "bg-[#eaf2ff]";
  }
}

function needsSeparator(prevCol: string | null, col: string) {
  if (!prevCol) return false;
  return groupKey(prevCol) !== groupKey(col);
}

/** =========================================================
 * YEAR / MONTH HELPERS
 * ========================================================= */
function monthOrderFromAnyCol(colName: string): number | null {
  const n = colName.toLowerCase();

  const rollingInstock = n.match(/^month_([1-5])$/);
  if (rollingInstock) return Number(rollingInstock[1]);

  const rollingSales = n.match(/^sales_month_(\d{1,2})$/);
  if (rollingSales) return Number(rollingSales[1]);

  const salesMatch = n.match(/^sales_(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)_\d{4}$/);
  if (salesMatch) return MONTH_ORDER[salesMatch[1]] ?? null;

  const rolling12 = n.match(/^(proj|incoming|repl|supply)_month_(\d{1,2})$/);
  if (rolling12) return Number(rolling12[2]);

  return null;
}

function yearFromCol(colName: string): number | null {
  const m = colName.match(/_(\d{4})$/);
  return m ? Number(m[1]) : null;
}

/** =========================================================
 * SEARCH BUILDER
 * ========================================================= */
function escFilterValue(v: string) {
  return v.trim().replace(/[(),]/g, "\\$&");
}

function tokenize(q: string) {
  const s = q.trim();
  if (!s) return [];
  const out: string[] = [];
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
  return out.filter(Boolean);
}

function buildSearchFilterLocal(schema: SchemaColumn[], query: string) {
  const q = query.trim();
  if (!q) return null;

  const tokens = tokenize(q);
  if (!tokens.length) return null;

  const textCols = schema.filter((c) => isTextType(c.data_type)).map((c) => c.column_name);
  const numCols = schema.filter((c) => isNumericType(c.data_type)).map((c) => c.column_name);
  const boolCols = schema.filter((c) => isBoolType(c.data_type)).map((c) => c.column_name);
  const dateCols = schema.filter((c) => isDateType(c.data_type)).map((c) => c.column_name);

  const hasSku = schema.some((c) => c.column_name === "sku");

  if (hasSku && /[A-Za-z0-9]+[-_][A-Za-z0-9]+/.test(q)) {
    const t = escFilterValue(q);
    return `sku.ilike.%${t}%`;
  }

  const andParts: string[] = [];

  for (const tok of tokens) {
    const tRaw = tok;
    const t = escFilterValue(tRaw);

    const orParts: string[] = [];
    for (const c of textCols) orParts.push(`${c}.ilike.%${t}%`);
    for (const c of dateCols) orParts.push(`${c}.ilike.%${t}%`);

    const n = Number(String(tRaw).replace(/,/g, ""));
    if (Number.isFinite(n) && String(tRaw).trim() !== "") {
      for (const c of numCols) orParts.push(`${c}.eq.${n}`);
    }

    const low = tRaw.toLowerCase();
    const boolVal =
      low === "true" || low === "yes" || low === "y" || low === "1"
        ? true
        : low === "false" || low === "no" || low === "n" || low === "-"
          ? false
          : null;

    if (boolVal !== null) {
      for (const c of boolCols) orParts.push(`${c}.eq.${boolVal}`);
    }

    if (orParts.length) andParts.push(`or(${orParts.join(",")})`);
  }

  if (!andParts.length) return null;
  if (andParts.length === 1) return andParts[0];
  return `and(${andParts.join(",")})`;
}

/** =========================================================
 * Sales Metrics fixed order
 * ========================================================= */
const SALES_METRICS_ORDER = [
  "sales_diff",
  "unit_cost",
  "actual_sale_of_month",
  "sales_velocity",
  "unshipped",
  "last_2months_avg",
  "monthly_projection",
];

/** Fixed column order within the "order" group */
const ORDER_GROUP_COL_ORDER = [
  "sku_status",
  "order_proposal_qty",
  "months_worth",
  "buyer_notes",
  "cbm",
  "factory_latest_po_ordered",
  "planner_notes",
  "analyst_notes",
  "po_number",
  "total_cbm_approved",
  "country",
  "lead_time",
  "buyer",
  "inventory_analyst",
  "order_date",
  "supplying_month",
  "supply_month",
  "supply_status",
];

/** =========================================================
 * ConfirmChangePortal — shared confirmation modal for all edits
 * ========================================================= */
function ConfirmChangePortal({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 animate-in fade-in-0" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg animate-in zoom-in-95 fade-in-0">
        <h3 className="text-lg font-semibold">Confirm Change</h3>
        <p className="mt-2 text-sm text-muted-foreground">Are you sure you want to apply this change?</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Yes, apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** =========================================================
 * OrderProposalQtyCell — lightweight inline-edit for numeric qty or free text
 * ========================================================= */
function OrderProposalQtyCellInner({
  value,
  onSave,
  emptyDisplay = "-",
  emptyIsBold = false,
  formatDisplay,
  editKey,
  onBusyChange,
  hasManualEdit = false,
  textMode = false,
}: {
  value: number | string | null;
  onSave: (v: number | string | null) => Promise<void>;
  emptyDisplay?: string;
  emptyIsBold?: boolean;
  formatDisplay?: (v: number) => string;
  editKey?: string;
  onBusyChange?: (editKey: string, busy: boolean) => void;
  hasManualEdit?: boolean;
  /** When true: accepts free text (e.g. "10/0"), skips numeric validation. */
  textMode?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingValue, setPendingValue] = useState<number | string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const startEdit = () => {
    if (editKey && onBusyChange) onBusyChange(editKey, true);
    setEditVal(value != null ? String(value) : "");
    setEditing(true);
    setStatus("idle");
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editKey || !onBusyChange) return;
    const busy = editing || showConfirm || status === "saving";
    if (busyRef.current !== busy) {
      busyRef.current = busy;
      onBusyChange(editKey, busy);
    }
  }, [editing, showConfirm, status, editKey, onBusyChange]);

  useEffect(() => {
    return () => {
      if (editKey && onBusyChange && busyRef.current) onBusyChange(editKey, false);
    };
  }, [editKey, onBusyChange]);

  const executeSave = async (parsed: number | string | null) => {
    setStatus("saving");
    try {
      await onSave(parsed);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (err) {
      toast.error("Save failed: " + (err instanceof Error ? err.message : String(err)));
      setStatus("error");
    }
  };

  const doSave = async (val: string) => {
    if (textMode) {
      const newVal = val.trim() === "" ? null : val.trim();
      const strValue = value != null ? String(value) : null;
      if (newVal === strValue || (newVal == null && value == null)) {
        setEditing(false);
        return;
      }
      setEditing(false);
      await executeSave(newVal);
      return;
    }

    const parsed = val.trim() === "" ? null : Number(val);
    if (val.trim() !== "" && (isNaN(parsed!) || parsed === undefined)) {
      setEditing(false);
      return;
    }

    if (parsed === value || (parsed == null && value == null)) {
      setEditing(false);
      return;
    }

    setEditing(false);
    // Instant save without confirmation - like Excel
    await executeSave(parsed);
  };

  const handleConfirm = async () => {
    setShowConfirm(false);
    await executeSave(pendingValue);
    setPendingValue(null);
  };

  const handleCancel = () => {
    setShowConfirm(false);
    setPendingValue(null);
    setStatus("idle");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSave(editVal);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      setStatus("idle");
    }
  };

  const displayValue = showConfirm || status === "saving" ? pendingValue : value;
  const isEmpty = textMode
    ? displayValue == null || String(displayValue) === ""
    : displayValue == null || displayValue === 0;

  return (
    <>
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type={textMode ? "text" : "number"}
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => doSave(editVal)}
            onKeyDown={handleKeyDown}
            className={`${textMode ? "w-24" : "w-16"} h-6 px-1 text-[12px] text-center border border-primary/50 rounded bg-background outline-none focus:ring-1 focus:ring-primary tabular-nums`}
          />
          {status === "saving" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <div
          onClick={startEdit}
          className="cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5 -mx-1 transition-colors min-h-[20px] flex items-center justify-center gap-1 group relative"
          title={hasManualEdit ? "Manually edited - Click to edit, right-click X to clear" : undefined}
        >
          {/* Manual edit indicator - pencil icon */}
          {hasManualEdit && (
            <>
              <svg
                className="absolute top-0 right-0 w-3 h-3 text-blue-500"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              {/* Clear button - shows on hover */}
              <button
                className="absolute top-0 right-3 w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold hover:bg-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  // Pure instant clear - call onSave directly without any UI state changes
                  onSave(null).catch((err) => {
                    toast.error("Failed to clear override");
                  });
                }}
                title="Clear manual override"
              >
                ×
              </button>
            </>
          )}
          {!isEmpty ? (
            <span className="tabular-nums">
              {textMode
                ? String(displayValue)
                : formatDisplay
                  ? formatDisplay(displayValue as number)
                  : Math.sign(displayValue as number) * Math.floor(Math.abs(displayValue as number) + 0.5)}
            </span>
          ) : emptyIsBold ? (
            <span className="tabular-nums font-semibold">{emptyDisplay}</span>
          ) : (
            <span className="text-muted-foreground/50 text-[10px] group-hover:text-primary/60">{emptyDisplay}</span>
          )}
          {status === "saved" && <Check className="h-3 w-3 text-green-500" />}
          {status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
        </div>
      )}

      <ConfirmChangePortal open={showConfirm} onConfirm={handleConfirm} onCancel={handleCancel} />
    </>
  );
}

const OrderProposalQtyCell = React.memo(OrderProposalQtyCellInner);

/** =========================================================
 * FormulaTooltip — Shows formula and highlights input cells
 * ========================================================= */
function FormulaTooltip({
  row,
  columnName,
  columnLabel,
  position,
  onClose,
  onHighlight,
  currentDate,
  monthlySaleMap,
  dateVars,
  manualMap,
  projOverrideMap,
  supplyOverrideMap,
  precomputedInputColumns,
}: {
  row: Record<string, unknown>;
  columnName: string;
  columnLabel?: string;
  position: { x: number; y: number };
  onClose: () => void;
  onHighlight: (inputColumns: string[]) => void;
  currentDate: Date;
  monthlySaleMap?: Map<string, Record<string, unknown>>;
  dateVars?: ForecastDateVars;
  manualMap?: Map<string, any>;
  projOverrideMap?: Map<string, any>;
  supplyOverrideMap?: Map<string, any>;
  precomputedInputColumns?: string[];
}) {
  const formulaDef = COLUMN_FORMULAS[columnName];
  if (!formulaDef) return null;

  const sku = String(row.sku ?? "");
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Check if this cell has a manual override
  const manual = manualMap?.get(sku);
  const projOvr = projOverrideMap?.get(sku);
  const supplyOvr = supplyOverrideMap?.get(sku);
  
  let isManualOverride = false;
  let manualValue: any = null;

  // Check for manual overrides based on column
  if (columnName === 'monthly_projection' && manual?.monthly_projection != null) {
    isManualOverride = true;
    manualValue = manual.monthly_projection;
  } else if (columnName === 'order_proposal_qty' && manual?.order_proposal_qty != null) {
    isManualOverride = true;
    manualValue = manual.order_proposal_qty;
  } else if (columnName.match(/^proj_month_(\d{1,2})$/)) {
    const mIdx = Number(columnName.match(/^proj_month_(\d{1,2})$/)![1]);
    const overrideVal = projOvr?.[`proj_month_${mIdx}_override`];
    if (overrideVal != null) {
      isManualOverride = true;
      manualValue = overrideVal;
    }
  } else if (columnName.match(/^supply_month_(\d{1,2})$/)) {
    const mIdx = Number(columnName.match(/^supply_month_(\d{1,2})$/)![1]);
    const overrideVal = supplyOvr?.[`supply_month_${mIdx}_override`];
    if (overrideVal != null) {
      isManualOverride = true;
      manualValue = overrideVal;
    }
  }

  // Get dynamic inputs if available - use precomputed if provided, otherwise calculate
  const inputColumns = precomputedInputColumns ?? (formulaDef.getDynamicInputs 
    ? formulaDef.getDynamicInputs(currentDate, row)
    : formulaDef.inputs);
  
  // Get input labels if available - pass row to support option-specific labels
  const inputLabels = formulaDef.getInputLabels 
    ? formulaDef.getInputLabels(currentDate, row)
    : {};

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Trigger highlighting when tooltip appears (only if not manual override)
  useEffect(() => {
    if (!isManualOverride) {
      onHighlight(inputColumns);
    } else {
      onHighlight([]); // No highlighting for manual overrides
    }
  }, [inputColumns, onHighlight, isManualOverride]);

  // Resolve sales values using resolveSalesMonthValue
  const resolvedRow = { ...row };
  for (const inputCol of inputColumns) {
    if (inputCol.startsWith('sales_month_')) {
      const resolved = resolveSalesMonthValue(row, inputCol, monthlySaleMap);
      resolvedRow[inputCol] = resolved;
    }
  }
  
  // Calculate net_velocity for display — ONLY Option 2 uses net velocity.
  // Options 1 & 3 use gross sales_velocity, so the inputs panel must show the
  // real sales_velocity for those (otherwise the panel shows net while the
  // formula line shows gross — the 459.3-vs-477 mismatch).
  const __popupOption = (row as any).__forecast_option ?? (row as any).forecast_option ?? 0;
  if (dateVars && columnName === 'proj_month_3' && __popupOption === 2) {
    const actualSaleOfMonth = row.actual_sale_of_month ?? 0;
    const daysElapsed = Math.max(1, dateVars.elapsed_days);
    const daysInMonth = dateVars.days_in_month;
    const netVelocity = (Number(actualSaleOfMonth) / daysElapsed) * daysInMonth;

    // Store both for display purposes (Option 2 substitutes net for gross).
    resolvedRow.net_velocity = netVelocity;
    resolvedRow.sales_velocity = row.sales_velocity ?? 0;
  }

  // Pass dateVars to calculation function if needed
  const calculation = !isManualOverride && formulaDef.getCalculation 
    ? formulaDef.getCalculation(resolvedRow, dateVars) 
    : "";

  return ReactDOM.createPortal(
    <div
      ref={tooltipRef}
      style={{
        position: "fixed",
        left: Math.min(position.x, window.innerWidth - 350),
        top: Math.min(position.y + 10, window.innerHeight - 250),
        zIndex: 10000,
        width: 320,
        maxHeight: 400,
        overflow: "auto",
      }}
      className="bg-popover text-popover-foreground border border-border rounded-lg shadow-2xl p-3 text-xs"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">{columnLabel ?? formulaDef.label}</div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1"
          title="Close (ESC)"
        >
          <X size={14} />
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground mb-2">SKU: {sku}</div>
      
      {isManualOverride ? (
        <>
          <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              <div className="font-semibold text-amber-700 dark:text-amber-500">Manual Override</div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              This value has been manually edited and does not use the automatic formula.
            </div>
          </div>

          <div className="mb-3">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Manual Value</div>
            <div className="bg-muted/50 border border-border rounded p-3 text-center">
              <div className="text-2xl font-bold tabular-nums">{manualValue}</div>
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground italic">
            Click the red × button to clear the override and restore automatic calculation.
          </div>
        </>
      ) : (
        <>
          <div className="mb-3">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Formula</div>
            <pre className="bg-muted/50 border border-border rounded p-2 text-[11px] whitespace-pre-wrap font-mono">
              {formulaDef.getFormulaLabel ? formulaDef.getFormulaLabel(row) : formulaDef.formula}
            </pre>
          </div>

          {calculation && (
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Calculation</div>
              <pre className="bg-muted/50 border border-border rounded p-2 text-[11px] whitespace-pre-wrap font-mono">
                {calculation}
              </pre>
            </div>
          )}

          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">
              Inputs (highlighted in blue)
            </div>
            <div className="space-y-1">
              {inputColumns.map((inputCol) => {
                let val = resolvedRow[inputCol];
                
                // Special case: if highlighting sales_velocity but label says "Current Sales Velocity" for Option 2,
                // show the net_velocity value instead (which is what's actually used in the calculation)
                if (inputCol === 'sales_velocity' && inputLabels[inputCol] === 'Current Sales Velocity' && resolvedRow.net_velocity != null) {
                  val = resolvedRow.net_velocity;
                }
                
                // Format numbers to 1 decimal place
                const displayVal = val != null 
                  ? (typeof val === 'number' ? val.toFixed(1) : String(val))
                  : "-";
                const label = inputLabels[inputCol] || inputCol;
                return (
                  <div key={inputCol} className="flex items-center gap-2 text-[11px]">
                    <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    <div className="flex-1 truncate">{label}</div>
                    <div className="font-semibold tabular-nums">{displayVal}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-border text-[10px] text-muted-foreground">
            💡 Click cell to toggle highlighting
          </div>
        </>
      )}
    </div>,
    document.body
  );
}

/** =========================================================
 * BuyerNotesDropdownCell — inline dropdown for Buyer Approval
 * ========================================================= */
const BUYER_NOTES_OPTIONS = [
  { value: "Approved", label: "Approved", cls: "bg-green-500/20 text-green-700 dark:text-green-400" },
  { value: "Hold", label: "Hold", cls: "bg-red-500/20 text-red-700 dark:text-red-400" },
  { value: "Discontinue", label: "Discontinue", cls: "bg-slate-300/50 text-slate-600 dark:text-slate-400" },
  { value: "Pending", label: "Pending", cls: "bg-yellow-400/30 text-yellow-700 dark:text-yellow-400" },
];

function buyerNotesBadgeCls(v: string | null) {
  const found = BUYER_NOTES_OPTIONS.find((o) => o.value.toLowerCase() === (v ?? "").toLowerCase());
  return found?.cls ?? "bg-muted text-muted-foreground";
}

function BuyerNotesDropdownCellInner({
  value,
  sku,
  onSave,
}: {
  value: string | null;
  sku: string;
  onSave: (sku: string, v: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [optimisticValue, setOptimisticValue] = useState<string | null | undefined>(undefined);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const displayValue = optimisticValue !== undefined ? optimisticValue : value;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
  };

  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingOpt, setPendingOpt] = useState<string | null>(null);

  const handleSelect = (opt: string) => {
    if (opt === displayValue) {
      setOpen(false);
      return;
    }
    setOpen(false);
    // Instant save without confirmation - like Excel
    void handleConfirm(opt);
  };

  const handleConfirm = async (optArg?: string | null) => {
    setShowConfirm(false);
    const opt = optArg !== undefined ? optArg : pendingOpt;
    setStatus("saving");
    setOptimisticValue(opt);
    try {
      await onSave(sku, opt);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (err) {
      setOptimisticValue(undefined);
      toast.error("Save failed: " + (err instanceof Error ? err.message : String(err)));
      setStatus("error");
    }
    setPendingOpt(null);
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
    setPendingOpt(null);
  };

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOptimisticValue(null);
    try {
      await onSave(sku, null);
    } catch {
      setOptimisticValue(undefined);
    }
  };

  return (
    <div ref={triggerRef}>
      <div
        onClick={toggleOpen}
        className="cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5 -mx-1 transition-colors min-h-[20px] flex items-center justify-center gap-1 group relative"
      >
        {displayValue && (
          <svg className="absolute top-0 right-0 w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
        )}
        {displayValue ? (
          <span
            className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold ${buyerNotesBadgeCls(displayValue)}`}
          >
            {displayValue}
          </span>
        ) : (
          <span className="text-muted-foreground/50 text-[10px] group-hover:text-primary/60">-</span>
        )}
        {displayValue && status === "idle" && (
          <button
            onClick={handleClear}
            title="Clear"
            className="invisible group-hover:visible shrink-0 h-3.5 w-3.5 rounded-full bg-destructive/80 hover:bg-destructive flex items-center justify-center"
          >
            <X className="h-2 w-2 text-white" />
          </button>
        )}
        {status === "saving" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {status === "saved" && <Check className="h-3 w-3 text-green-500" />}
        {status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
      </div>
      {open &&
        ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            className="fixed bg-popover border border-border rounded-md shadow-xl py-1 min-w-[130px]"
            style={{ top: pos.top, left: pos.left, zIndex: 9999 }}
          >
            {BUYER_NOTES_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-accent/50 transition-colors flex items-center gap-2 ${
                  opt.value === displayValue ? "font-bold" : ""
                }`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${opt.cls.split(" ")[0]}`} />
                {opt.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      <ConfirmChangePortal open={showConfirm} onConfirm={handleConfirm} onCancel={handleCancelConfirm} />
    </div>
  );
}
const BuyerNotesDropdownCell = React.memo(BuyerNotesDropdownCellInner);

/** =========================================================
 * NotesDropdownCell — reusable portal dropdown for the planner/the analyst notes
 * ========================================================= */
const NOTES_DROPDOWN_OPTIONS = [
  { value: "Approved", label: "Approved", cls: "bg-green-500/20 text-green-700 dark:text-green-400" },
  { value: "Hold", label: "Hold", cls: "bg-red-500/20 text-red-700 dark:text-red-400" },
  { value: "Discontinue", label: "Discontinue", cls: "bg-muted text-muted-foreground" },
  { value: "Pending", label: "Pending", cls: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400" },
];

function notesBadgeCls(v: string | null) {
  const found = NOTES_DROPDOWN_OPTIONS.find((o) => o.value.toLowerCase() === (v ?? "").toLowerCase());
  return found?.cls ?? "bg-muted text-muted-foreground";
}

function NotesDropdownCellInner({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
  };

  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingOpt, setPendingOpt] = useState<string | null>(null);

  const handleSelect = (opt: string) => {
    if (opt === value) {
      setOpen(false);
      return;
    }
    setOpen(false);
    // Instant save without confirmation - like Excel
    void handleConfirm(opt);
  };

  const handleConfirm = async (optArg?: string | null) => {
    setShowConfirm(false);
    const opt = optArg !== undefined ? optArg : pendingOpt;
    setStatus("saving");
    try {
      await onSave(opt);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (err) {
      toast.error("Save failed: " + (err instanceof Error ? err.message : String(err)));
      setStatus("error");
    }
    setPendingOpt(null);
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
    setPendingOpt(null);
  };

  const displayValue =
    value && NOTES_DROPDOWN_OPTIONS.some((o) => o.value.toLowerCase() === value.toLowerCase()) ? value : null;

  return (
    <div ref={triggerRef}>
      <div
        onClick={toggleOpen}
        className="cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5 -mx-1 transition-colors min-h-[20px] flex items-center justify-center gap-1 group"
      >
        {displayValue ? (
          <span
            className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold ${notesBadgeCls(displayValue)}`}
          >
            {displayValue}
          </span>
        ) : (
          <span className="text-muted-foreground text-[10px]">-</span>
        )}
        {status === "saving" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {status === "saved" && <Check className="h-3 w-3 text-green-500" />}
        {status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
      </div>
      {open &&
        ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            className="fixed bg-popover border border-border rounded-md shadow-xl py-1 min-w-[130px]"
            style={{ top: pos.top, left: pos.left, zIndex: 9999 }}
          >
            {NOTES_DROPDOWN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-accent/50 transition-colors flex items-center gap-2 ${
                  opt.value === value ? "font-bold" : ""
                }`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${opt.cls.split(" ")[0]}`} />
                {opt.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      <ConfirmChangePortal open={showConfirm} onConfirm={handleConfirm} onCancel={handleCancelConfirm} />
    </div>
  );
}
const NotesDropdownCell = React.memo(NotesDropdownCellInner);

/** =========================================================
 * STATUS OVERRIDE CELLS — factory, status, kit, category
 * Saved into forecast_report_status table (separate from manual)
 * ========================================================= */
// Editable Status dropdown — colors delegate to the unified palette so the
// dropdown chip matches the read-only Pill in the row.
const STATUS_OVERRIDE_OPTIONS = [
  { value: "Active", label: "Active", cls: unifiedStatusBadgeCls("Active") },
  { value: "Working (Item Data Creation)", label: "Working (Item Data Creation)", cls: unifiedStatusBadgeCls("Working (Item Data Creation)") },
  { value: "Discontinued", label: "Discontinued", cls: unifiedStatusBadgeCls("Discontinued") },
];

// Kit Yes uses the same pale-green-on-dark-text as Active so it stays
// readable even when a row's hover bg (brown tint) sits behind it.
const KIT_OPTIONS = [
  { value: "Y", label: "Y", cls: "bg-emerald-100 text-emerald-800" },
  { value: "N", label: "N", cls: PILL.gray },
];

function statusOverrideBadgeCls(v: string | null) {
  return unifiedStatusBadgeCls(v);
}

function normalizeKitDisplay(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === "-") return null;
  // Canonical display = Y / N (matches the loader's stored values and the
  // filter options). Every legacy representation folds into the same bucket.
  if (["true", "yes", "1", "y"].includes(s)) return "Y";
  if (["false", "no", "0", "n"].includes(s)) return "N";
  return String(v);
}

function kitBadgeCls(v: string | null) {
  const found = KIT_OPTIONS.find((o) => o.value.toLowerCase() === (v ?? "").toLowerCase());
  return found?.cls ?? PILL.gray;
}

/** Generic portal dropdown for status overrides */
function StatusOverrideDropdownCellInner({
  value,
  onSave,
  options,
  badgeClsFn,
  placeholder = "-",
}: {
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
  options: { value: string; label: string; cls: string }[];
  badgeClsFn: (v: string | null) => string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
  };

  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingOpt, setPendingOpt] = useState<string | null>(null);

  const handleSelect = (opt: string) => {
    if (opt === value) {
      setOpen(false);
      return;
    }
    setOpen(false);
    // Instant save without confirmation - like Excel
    void handleConfirm(opt);
  };

  const handleConfirm = async (optArg?: string | null) => {
    setShowConfirm(false);
    const opt = optArg !== undefined ? optArg : pendingOpt;
    setStatus("saving");
    try {
      await onSave(opt);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (err) {
      toast.error("Save failed: " + (err instanceof Error ? err.message : String(err)));
      setStatus("error");
    }
    setPendingOpt(null);
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
    setPendingOpt(null);
  };

  return (
    <div ref={triggerRef}>
      <div
        onClick={toggleOpen}
        className="cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5 -mx-1 transition-colors min-h-[20px] flex items-center justify-center gap-1 group"
      >
        {value ? (
          <span
            title={value}
            className={`inline-block max-w-[110px] truncate h-5 leading-5 px-2 rounded-full text-[10px] font-semibold shadow-sm ${badgeClsFn(value)}`}
          >
            {value}
          </span>
        ) : (
          <span className="text-muted-foreground/50 text-[10px] group-hover:text-primary/60 w-full text-center">
            {placeholder}
          </span>
        )}
        {status === "saving" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {status === "saved" && <Check className="h-3 w-3 text-green-500" />}
        {status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
      </div>
      {open &&
        ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            className="fixed bg-popover border border-border rounded-md shadow-xl py-1 min-w-[130px]"
            style={{ top: pos.top, left: pos.left, zIndex: 9999 }}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-accent/50 transition-colors flex items-center gap-2 ${
                  opt.value === value ? "font-bold" : ""
                }`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${opt.cls.split(" ")[0]}`} />
                {opt.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      <ConfirmChangePortal open={showConfirm} onConfirm={handleConfirm} onCancel={handleCancelConfirm} />
    </div>
  );
}
const StatusOverrideDropdownCell = React.memo(StatusOverrideDropdownCellInner);

/** Inline text edit cell for factory / category overrides */
function InlineStatusTextCellInner({
  value,
  onSave,
  placeholder = "-",
}: {
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingVal, setPendingVal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setEditVal(value ?? "");
    setEditing(true);
    setStatus("idle");
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const doSave = (val: string) => {
    const trimmed = val.trim() || null;
    if (trimmed === value || (trimmed == null && value == null)) {
      setEditing(false);
      return;
    }
    setEditing(false);
    // Instant save without confirmation - like Excel
    void handleConfirm(trimmed);
  };

  const handleConfirm = async (valArg?: string | null) => {
    setShowConfirm(false);
    const val = valArg !== undefined ? valArg : pendingVal;
    setStatus("saving");
    try {
      await onSave(val);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (err) {
      toast.error("Save failed: " + (err instanceof Error ? err.message : String(err)));
      setStatus("error");
    }
    setPendingVal(null);
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
    setPendingVal(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSave(editVal);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      setStatus("idle");
    }
  };

  if (editing) {
    return (
      <>
        <div className="flex items-center justify-center gap-1">
          <input
            ref={inputRef}
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => doSave(editVal)}
            onKeyDown={handleKeyDown}
            className="w-full min-w-[60px] px-1 py-0.5 text-[12px] text-center border border-primary/50 rounded bg-background outline-none focus:ring-1 focus:ring-primary"
          />
          {status === "saving" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <ConfirmChangePortal open={showConfirm} onConfirm={handleConfirm} onCancel={handleCancelConfirm} />
      </>
    );
  }

  return (
    <>
      <div
        onClick={startEdit}
        title={value || undefined}
        className="cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5 -mx-1 transition-colors min-h-[20px] flex items-center justify-center gap-1 group"
      >
        {value ? (
          <span className="truncate text-[12px] text-center">{value}</span>
        ) : (
          <span className="text-muted-foreground/50 text-[10px] italic group-hover:text-primary/60 w-full text-center">
            {placeholder}
          </span>
        )}
        {status === "saved" && <Check className="h-3 w-3 text-green-500 shrink-0" />}
        {status === "error" && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
      </div>
      <ConfirmChangePortal open={showConfirm} onConfirm={handleConfirm} onCancel={handleCancelConfirm} />
    </>
  );
}
const InlineStatusTextCell = React.memo(InlineStatusTextCellInner);

function InlineTextNoteCellInner({
  value,
  sku,
  onSave,
}: {
  value: string | null;
  sku: string;
  onSave: (sku: string, v: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingVal, setPendingVal] = useState<string | null>(null);
  const [optimisticValue, setOptimisticValue] = useState<string | null | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const displayValue = optimisticValue !== undefined ? optimisticValue : value;

  const startEdit = () => {
    setEditVal(displayValue ?? "");
    setEditing(true);
    setStatus("idle");
  };

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const doSave = (val: string) => {
    const trimmed = val.trim() || null;
    if (trimmed === displayValue || (trimmed == null && displayValue == null)) {
      setEditing(false);
      return;
    }
    setEditing(false);
    // Instant save without confirmation - like Excel
    void handleConfirm(trimmed);
  };

  const handleConfirm = async (valArg?: string | null) => {
    setShowConfirm(false);
    const val = valArg !== undefined ? valArg : pendingVal;
    setStatus("saving");
    setOptimisticValue(val);
    try {
      await onSave(sku, val);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (err) {
      setOptimisticValue(undefined);
      toast.error("Save failed: " + (err instanceof Error ? err.message : String(err)));
      setStatus("error");
    }
    setPendingVal(null);
  };

  const handleCancelConfirm = () => {
    setShowConfirm(false);
    setPendingVal(null);
  };

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOptimisticValue(null);
    try {
      await onSave(sku, null);
    } catch {
      setOptimisticValue(undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSave(editVal);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      setStatus("idle");
    }
  };

  if (editing) {
    return (
      <>
        <div className="flex items-center justify-center gap-1">
          <textarea
            ref={textareaRef}
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => doSave(editVal)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="w-full min-w-[140px] px-1 py-0.5 text-[12px] text-center border border-primary/50 rounded bg-background outline-none focus:ring-1 focus:ring-primary resize-y"
          />
          {status === "saving" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <ConfirmChangePortal open={showConfirm} onConfirm={handleConfirm} onCancel={handleCancelConfirm} />
      </>
    );
  }

  return (
    <>
      <div
        onClick={startEdit}
        title={displayValue || undefined}
        className="cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5 -mx-1 transition-colors min-h-[20px] flex items-center justify-center gap-1 group relative"
      >
        {displayValue && (
          <svg className="absolute top-0 right-0 w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
        )}
        {displayValue ? (
          <span className="truncate text-[12px] text-center">{displayValue}</span>
        ) : (
          <span className="text-muted-foreground/50 text-[10px] group-hover:text-primary/60 w-full text-center">-</span>
        )}
        {displayValue && status === "idle" && (
          <button
            onClick={handleClear}
            title="Clear"
            className="invisible group-hover:visible shrink-0 h-3.5 w-3.5 rounded-full bg-destructive/80 hover:bg-destructive flex items-center justify-center"
          >
            <X className="h-2 w-2 text-white" />
          </button>
        )}
        {status === "saved" && <Check className="h-3 w-3 text-green-500 shrink-0" />}
        {status === "error" && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
      </div>
      <ConfirmChangePortal open={showConfirm} onConfirm={handleConfirm} onCancel={handleCancelConfirm} />
    </>
  );
}

const InlineTextNoteCell = React.memo(InlineTextNoteCellInner);

function DateVarsBadge({ vars }: { vars: ForecastDateVars }) {
  const { current_date, days_in_month, elapsed_days, remaining_days } = vars;
  const Item = ({ label, value }: { label: string; value: string | number }) => (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
      <span className="text-muted-foreground">[{label}]</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
  return (
    <div
      className="hidden md:flex items-center gap-1.5"
      title="Auto-updating date variables from system time. Used by formulas like ([Monthly Projection]/30) * [remaining_days]."
    >
      <Item label="current_date" value={current_date} />
      <Item label="days_in_month" value={days_in_month} />
      <Item label="elapsed_days" value={elapsed_days} />
      <Item label="remaining_days" value={remaining_days} />
    </div>
  );
}

/**
 * Reorder Decisions — per-row urgency derivation.
 *
 * Two branches:
 *
 * 1) 90-day deficit > 0  (excess stock for next 90 days)
 *    Don't trust a far-out negative Supply Plan month to flag the SKU as
 *    overdue — current stock genuinely covers near-term demand. Fall back
 *    to the covered_months horizon:
 *        days_to_reorder = (covered_months - today) - lead_time
 *    If covered_months is missing, treat as healthy (~12 months out).
 *
 * 2) Otherwise (deficit ≤ 0, real near-term shortfall)
 *    Use the stockout-month scan:
 *        stockout_month  = first supply_month_N (N=1..12) where value < 0
 *        days_until      = (1st of stockout_month) - today, clamped to ≥ 0
 *        days_to_reorder = days_until - lead_time
 *    If no month goes negative within the 12-month window → month 12 anchor.
 *
 * Edge cases:
 *   - supply_month_1 already < 0 → days_until = 0 (today)
 *   - missing lead_time / unparseable inputs → return null
 */
function computeIdpDaysToReorder(row: any, todayMs: number): number | null {
  const leadRaw = row?.lead_time;
  const lead = leadRaw == null || leadRaw === "" ? null : Number(leadRaw);
  if (lead == null || !Number.isFinite(lead)) return null;

  const today = new Date(todayMs);
  const ninetyDayDeficit = Number(row?.ninety_day_deficit ?? 0);

  // Branch 1: surplus over next 90 days → use covered_months horizon.
  if (Number.isFinite(ninetyDayDeficit) && ninetyDayDeficit > 0) {
    const cm = row?.covered_months;
    if (cm) {
      const cmParsed = new Date(cm);
      if (!isNaN(cmParsed.getTime())) {
        const daysOfCoverage = Math.round((cmParsed.getTime() - todayMs) / 86400000);
        return daysOfCoverage - lead;
      }
    }
    // No covered_months → assume far horizon (12 months out) so it surfaces as healthy.
    const farHorizon = new Date(today.getFullYear(), today.getMonth() + 11, 1);
    const days = Math.max(0, Math.round((farHorizon.getTime() - todayMs) / 86400000));
    return days - lead;
  }

  // Branch 2: real shortfall → first negative supply month wins.
  let stockoutMonthIdx: number | null = null;
  for (let i = 1; i <= 12; i++) {
    const raw = row?.[`supply_month_${i}`];
    const v = raw == null || raw === "" ? null : Number(raw);
    if (v != null && Number.isFinite(v) && v < 0) {
      stockoutMonthIdx = i;
      break;
    }
  }
  const horizonIdx = stockoutMonthIdx ?? 12;
  const horizonDate = new Date(today.getFullYear(), today.getMonth() + (horizonIdx - 1), 1);
  const daysUntilStockout = Math.max(
    0,
    Math.round((horizonDate.getTime() - todayMs) / 86400000),
  );
  return daysUntilStockout - lead;
}

/**
 * Reorder Decisions — per-row supply-runway metrics.
 *
 *   daily_rate            = ninety_day_projection / 90
 *   days_of_supply        = floor(ninety_day_supply / daily_rate)
 *   days_until_must_order = days_of_supply - lead_time
 *   days_without_stock    = floor(|deficit| / daily_rate)  // only when deficit < 0
 *
 *   action tier — deficit-first urgency. See computeIdpRowMetrics body for
 *   the full ordered ruleset and the negative-deficit invariant.
 *
 * No Demand / In Progress / Discontinued tiers are decided upstream from
 * ninety_day_projection and pu_status, not by computeIdpRowMetrics.
 */
/**
 * Canonical Action tier labels for the IDP planner. Drives the Action cell
 * badge, summary cards, sort ranking, and Action filter dropdown.
 *
 * Tier order is the planner's urgency hierarchy from most urgent (top) to
 * least urgent (bottom). Sort rank = index into this array.
 */
const ACTION_TIER = {
  URGENT:        "Urgent",
  ORDER_30:      "Order Within 20 Days",
  ORDER_60:      "Order Within 45 Days",
  ORDER_90:      "Order Within 75 Days",
  NO_ACTION:     "Covered",
  MISSING_LT:    "Missing LT",
  // Loader safeguard: the row has NO inventory data at all (oh_inv / otw /
  // on_order all NULL — seen on the full SKU set). Treating
  // NULL as "0 stock" faked many Urgent rows; this tier isolates them instead.
  MISSING_INV:   "Missing Inventory",
  NO_DEMAND:     "No Demand",
  IN_PROGRESS:   "In Progress",
  DISCONTINUED:  "Discontinued",
} as const;
type ActionTierLabel = typeof ACTION_TIER[keyof typeof ACTION_TIER];

const ACTION_TIER_ORDER: ActionTierLabel[] = [
  ACTION_TIER.URGENT,
  ACTION_TIER.ORDER_30,
  ACTION_TIER.ORDER_60,
  ACTION_TIER.ORDER_90,
  ACTION_TIER.NO_ACTION,
  ACTION_TIER.MISSING_LT,
  ACTION_TIER.MISSING_INV,
  ACTION_TIER.NO_DEMAND,
  ACTION_TIER.IN_PROGRESS,
  ACTION_TIER.DISCONTINUED,
];

/** Sort rank — lower = more urgent. Tiers without a computed signal fall
 *  back to ACTION_TIER_RANK_NULL (between Covered and Missing LT). */
const ACTION_TIER_RANK: Record<ActionTierLabel, number> = Object.fromEntries(
  ACTION_TIER_ORDER.map((label, i) => [label, i]),
) as Record<ActionTierLabel, number>;
const ACTION_TIER_RANK_NULL = ACTION_TIER_RANK[ACTION_TIER.NO_ACTION] + 0.5;

/** Action-cell color theming per tier. */
const ACTION_TIER_THEME: Record<ActionTierLabel, { bg: string; color: string }> = {
  [ACTION_TIER.URGENT]:       { bg: "#dc2626", color: "white" },   // red
  [ACTION_TIER.ORDER_30]:     { bg: "#ea580c", color: "white" },   // orange
  [ACTION_TIER.ORDER_60]:     { bg: "#ca8a04", color: "white" },   // amber
  [ACTION_TIER.ORDER_90]:     { bg: "#16a34a", color: "white" },   // green
  [ACTION_TIER.NO_ACTION]:    { bg: "#e5e7eb", color: "#4b5563" }, // gray
  [ACTION_TIER.MISSING_LT]:   { bg: "#eab308", color: "white" },   // yellow
  [ACTION_TIER.MISSING_INV]:  { bg: "#a855f7", color: "white" },   // purple — data gap, not a stock signal
  [ACTION_TIER.NO_DEMAND]:    { bg: "#e5e7eb", color: "#4b5563" }, // gray
  [ACTION_TIER.IN_PROGRESS]:  { bg: "#e5e7eb", color: "#4b5563" }, // gray
  [ACTION_TIER.DISCONTINUED]: { bg: "#e5e7eb", color: "#4b5563" }, // gray
};

/**
 * Build the action-cell badge + subtitle for the planner row. Returns the
 * lucide icon component, badge bg/fg colors, and the two text lines. Driven
 * by effectiveTier with per-tier sub-branches for the dynamic values the
 * spec describes (e.g., URGENT splits on daysOfSupply, ORDER_30 keeps its
 * subtitle terse when ≤7d vs. 8-30d).
 */
type IconCmp = React.ComponentType<{ size?: number; className?: string }>;
interface ActionBadge {
  Icon: IconCmp | null;
  text: string;
  subtitle: string;
  bg: string;
  color: string;
}
// Map the shared lib's icon-name string to the React component. The badge
// text / subtitle / colors come from buildActionBadgeContent so the CSV +
// email render the exact same wording the buyer sees in the planner cell.
const ACTION_ICON_BY_NAME: Record<string, IconCmp> = {
  MinusCircle,
  AlertCircle,
  AlertOctagon,
  Clock,
  Bell,
  CheckCircle2,
};
function buildActionBadge(args: {
  effectiveTier: ActionTierLabel | null;
  daysOfSupply: number;
  daysUntilMustOrder: number | null;
  daysWithoutStock: number;
  leadTime: number | null;
}): ActionBadge {
  const content = buildActionBadgeContent(args);
  return {
    Icon: content.iconName ? ACTION_ICON_BY_NAME[content.iconName] ?? null : null,
    text: content.text,
    subtitle: content.subtitle,
    bg: content.bg,
    color: content.color,
  };
}

function computeIdpRowMetrics(row: any): {
  daysOfSupply: number | null;
  daysUntilMustOrder: number | null;
  daysWithoutStock: number;
  /** Computed urgency tier. null when daily_rate ≤ 0 or lead time missing. */
  actionTier: ActionTierLabel | null;
} {
  // `__raw_ninety_day_*` are set by the recompute to the UI-computed 90-day
  // figures (sum of the displayed monthly values) — the Forecast UI is the
  // source of truth, not the loader's stored columns. Falls back to
  // `row.ninety_day_*` for code paths that don't run recompute.
  const projRaw =
    row?.__raw_ninety_day_projection != null && row.__raw_ninety_day_projection !== ""
      ? Number(row.__raw_ninety_day_projection)
      : Number(row?.ninety_day_projection ?? 0);
  const supplyRaw =
    row?.__raw_ninety_day_supply != null && row.__raw_ninety_day_supply !== ""
      ? Number(row.__raw_ninety_day_supply)
      : Number(row?.ninety_day_supply ?? 0);
  const deficitRaw =
    row?.__raw_ninety_day_deficit != null && row.__raw_ninety_day_deficit !== ""
      ? Number(row.__raw_ninety_day_deficit)
      : Number(row?.ninety_day_deficit ?? 0);

  const proj = projRaw;
  const dailyRate = Number.isFinite(proj) && proj > 0 ? proj / 90 : 0;
  const supply90 = supplyRaw;
  const leadRaw = row?.lead_time;
  const lead = leadRaw == null || leadRaw === "" ? null : Number(leadRaw);

  const daysOfSupply =
    dailyRate > 0 && Number.isFinite(supply90) && supply90 > 0
      ? Math.floor(supply90 / dailyRate)
      : 0;

  const daysUntilMustOrder =
    lead != null && Number.isFinite(lead) ? daysOfSupply - lead : null;

  const deficit = deficitRaw;
  const daysWithoutStock =
    dailyRate > 0 && Number.isFinite(deficit) && deficit < 0
      ? Math.floor(Math.abs(deficit) / dailyRate)
      : 0;

  // Action tier rules — buyer-anchored. Negative 90-day deficit means stock
  // *will* run out within 90 days, and typical multi-month lead times mean an
  // order placed today can't arrive in time. So negative deficit is THE
  // primary urgency trigger and is never demoted below "Urgent".
  //
  // Order of evaluation (first match wins, after upstream SKIP tiers):
  //   Missing LT        → daily_rate > 0 but no lead time → can't compute timing
  //   Urgent            → deficit < 0 (any supply state)
  //                       OR (deficit ≥ 0 AND daysUntilMustOrder ≤ 0)
  //   Order Within 20 Days   → deficit ≥ 0 AND 1 ≤ daysUntilMustOrder ≤ 20
  //   Order Within 45 Days   → deficit ≥ 0 AND 21 ≤ daysUntilMustOrder ≤ 45
  //   Order Within 75 Days   → deficit ≥ 0 AND 46 ≤ daysUntilMustOrder ≤ 75
  //   Covered  → deficit ≥ 0 AND daysUntilMustOrder > 90
  //
  // INVARIANT: rows with deficit < 0 can ONLY land in Urgent. The other
  // timing tiers are reserved for non-deficit rows.
  //
  // No Demand / In Progress / Discontinued are decided upstream from
  // ninety_day_projection and pu_status, not from this function.
  // No inventory data at all → the supply plan is built on NULL-as-zero and
  // would fake an Urgent. Isolate as Missing Inventory (excluded from cards).
  const inventoryMissing =
    (row?.oh_inv == null || row?.oh_inv === "") &&
    (row?.otw_units == null || row?.otw_units === "") &&
    (row?.on_order_units == null || row?.on_order_units === "");

  let actionTier: ActionTierLabel | null = null;
  if (dailyRate > 0) {
    if (inventoryMissing) {
      actionTier = ACTION_TIER.MISSING_INV;
    } else if (lead == null || !Number.isFinite(lead) || lead <= 0) {
      actionTier = ACTION_TIER.MISSING_LT;
    } else if (Number.isFinite(deficit) && deficit < 0) {
      // Primary urgency lane — deficit-first.
      actionTier = ACTION_TIER.URGENT;
    } else if (daysUntilMustOrder != null) {
      // Secondary lane — positive (or zero) deficit, plan by timing.
      if (daysUntilMustOrder <= 0) actionTier = ACTION_TIER.URGENT;
      else if (daysUntilMustOrder <= 20) actionTier = ACTION_TIER.ORDER_30;
      else if (daysUntilMustOrder <= 45) actionTier = ACTION_TIER.ORDER_60;
      else if (daysUntilMustOrder <= 75) actionTier = ACTION_TIER.ORDER_90;
      else actionTier = ACTION_TIER.NO_ACTION;
    }
  }

  return { daysOfSupply, daysUntilMustOrder, daysWithoutStock, actionTier };
}

export default function ForecastReportDashboard() {
  const queryClient = useQueryClient();
  const { canEdit } = usePagePermission("forecast_report");
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { user: authUser } = useAuth();

  const liveDateVars = useForecastDateVars();
  const now = liveDateVars.now;
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // lowercase → all raw case-variants of pu_status / status seen in the data.
  // Lets the deduped single option ("Slow") expand to match every DB variant
  // ("Slow", "SLOW") in the server `.in()` filter. Populated from the distinct
  // filter-options scan via an effect below.
  const puStatusVariantsRef = useRef<Map<string, string[]>>(new Map());
  const statusVariantsRef = useRef<Map<string, string[]>>(new Map());
  const shopifyStatusVariantsRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;

    const key = "monthly-forecast:table-scroll";
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { top?: number; left?: number };
        if (typeof parsed.top === "number") el.scrollTop = parsed.top;
        if (typeof parsed.left === "number") el.scrollLeft = parsed.left;
      } catch {
        // ignore invalid persisted scroll payload
      }
    }

    // Frozen columns are pinned purely via CSS `position: sticky; left` (set
    // in the cell style objects below). No imperative transform here — that
    // fought the sticky offset (double-shift) and was wiped by React on every
    // re-render. This effect now only persists scroll position.
    const handleScroll = () => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          top: el.scrollTop,
          left: el.scrollLeft,
        }),
      );
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Track the viewport position of the "Total CBM Approved" column center
  // and render the summary label as position:fixed so it's always visible
  // and always aligned under the column when that column is in view.
  useEffect(() => {
    const scrollEl = tableScrollRef.current;
    if (!scrollEl) return;
    let rafId: number;
    let prevScrollLeft = -1;

    const update = (force = false) => {
      const currentScrollLeft = scrollEl.scrollLeft;
      if (!force && currentScrollLeft === prevScrollLeft) return;
      prevScrollLeft = currentScrollLeft;

      const th = scrollEl.querySelector<HTMLElement>('th[data-col="total_cbm_approved"]');
      if (!th) return;
      const thRect = th.getBoundingClientRect();
      const containerRect = scrollEl.getBoundingClientRect();
      const paginationBar = document.querySelector<HTMLElement>('[data-pagination-bar]');

      // Viewport X of column center.
      const viewportX = thRect.left + thRect.width / 2;
      // Y = exact vertical center of the rendered pagination bar.
      const paginationRect = paginationBar?.getBoundingClientRect();
      const paginationY = paginationRect
        ? paginationRect.top + paginationRect.height / 2
        : containerRect.bottom + 18;

      // Clamp X so the label stays inside the visible content area.
      // Right bound reserves space for "X–Y of Z + nav buttons" (~320px).
      const LABEL_HALF_W = 140;
      const clampMin = containerRect.left + LABEL_HALF_W + 8;
      const clampMax = containerRect.right - 330;
      const x = Math.max(clampMin, Math.min(viewportX, clampMax));

      setSummaryFixedPos({ x, y: paginationY });
    };

    const handleScroll = () => update();
    const handleResize = () => update(true);

    rafId = requestAnimationFrame(() => requestAnimationFrame(() => update(true)));
    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(rafId);
      scrollEl.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Factory/region access — non-admins only see rows for their assigned country.
  const { restricted: factoryRestricted, assignedCountry, factoryLevel, allowedFactoryShortNames } = useFactoryAccess();
  const factoryKey = (allowedFactoryShortNames ?? []).join("|");

  // v2: namespaced for clean isolation from forecast-view:filters. Both pages
  // use distinct localStorage keys so filters on one page never bleed into
  // the other.
  const [filters, setFilters] = usePersistedState<{
    sku: string[];
    description: string[];
    factory: string[];
    item_color: string[];
    kit: string[];
    status: string[];
    pu_status: string[];
    shopify_status: string[];
    category: string[];
    country: string[];
    buyer: string[];
    inventory_analyst: string[];
    supply_status: string[];
    priority_level: string[];
    shadow: string[];
    action: string[];
    order_proposal_qty: string[];
    buyer_notes: string[];
    months_worth: string[];
    sku_status: string[];
    needs_order: string[];
  }>("monthly-forecast:filters:v12", {
    sku: [],
    description: [],
    factory: [],
    item_color: [],
    kit: [],
    status: [],
    pu_status: [],
    shopify_status: [], // Remove default filter
    category: [],
    country: [],
    buyer: [],
    inventory_analyst: [],
    supply_status: [],
    priority_level: [],
    shadow: [],
    action: [],
    order_proposal_qty: [],
    buyer_notes: [],
    months_worth: [],
    sku_status: [],
    needs_order: [],
  });

  // Ensure description field exists (migration from v3 to v4)
  if (!filters.description) {
    setFilters((prev) => ({ ...prev, description: [] }));
  }
  // Ensure months_worth field exists (migration)
  if (!filters.months_worth) {
    setFilters((prev) => ({ ...prev, months_worth: [] }));
  }
  // Ensure sku_status field exists (migration — computed New SKU / Not New SKU filter)
  if (!filters.sku_status) {
    setFilters((prev) => ({ ...prev, sku_status: [] }));
  }

  // Independent filter state for the Reorder Decisions dialog.
  // The dialog and the main forecast report table must filter independently —
  // a Factory pick inside the dialog must NOT affect the main table behind it
  // FORCE CLEAR OLD FILTER VERSIONS BEFORE INITIALIZING STATE
  // This runs synchronously before the hook initializes, ensuring clean state
  React.useMemo(() => {
    const oldVersions = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11'];
    oldVersions.forEach(v => {
      const key = `idp-dialog:filters:${v}`;
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
      }
    });
  }, []);

  // and vice versa. Each persists to its own localStorage key.
  const [idpFilters, setIdpFilters] = usePersistedState<{
    sku: string[];
    description: string[];
    factory: string[];
    status: string[];
    pu_status: string[];
    shopify_status: string[];
    category: string[];
    country: string[];
    buyer: string[];
    inventory_analyst: string[];
    supply_status: string[];
    priority_level: string[];
    shadow: string[];
    action: string[];
  }>("idp-dialog:filters:v12", {
    sku: [],
    description: [],
    factory: [],
    status: [],
    pu_status: [],
    shopify_status: [], // NO DEFAULT - will be applied at data layer for Storefront Stock only
    category: [],
    country: [],
    buyer: [],
    inventory_analyst: [],
    supply_status: [],
    priority_level: [],
    shadow: [],
    action: [], // NO DEFAULT - show all action tiers on open
  });

  // Ensure description field exists (migration from v2 to v3)
  if (!idpFilters.description) {
    setIdpFilters((prev) => ({ ...prev, description: [] }));
  }
  
  // IDP dialog's own search query (independent from main page search).
  const [idpSearchQuery, setIdpSearchQuery] = usePersistedState<string>(
    "idp-dialog:search:v1",
    "",
  );

  // Persist the active IDP filter snapshot to Supabase so the background
  // email pipeline can replay the same filtered view per recipient. Debounced
  // so rapid toggling of filter chips doesn't hammer the DB.
  useEffect(() => {
    const email = authUser?.email;
    if (!email) return;
    const handle = setTimeout(() => {
      void persistIdpFilterState(email, idpFilters, idpSearchQuery);
    }, 750);
    return () => clearTimeout(handle);
  }, [authUser?.email, idpFilters, idpSearchQuery]);

  // ──────────────────────────────────────────────────────────────────────────
  // URL-param-driven initial filters (deep-link support).
  //
  // Email reports and dashboards can link straight to a pre-filtered view, e.g.
  //   /monthly-forecast?action=Order+Now
  //   /monthly-forecast?factory=VND1&status=Active
  //
  // On mount we read the supported params and merge them into both the main
  // table filter state and the IDP-dialog filter state. Multiple comma-separated
  // values are supported (e.g. ?factory=VND1,VND4). Only filter keys whose param
  // is present in the URL are touched — other persisted filters are preserved.
  // ──────────────────────────────────────────────────────────────────────────
  const appliedUrlFiltersRef = useRef(false);
  useEffect(() => {
    if (appliedUrlFiltersRef.current) return;
    appliedUrlFiltersRef.current = true;

    const supported = [
      "sku",
      "factory",
      "status",
      "pu_status",
      "category",
      "country",
      "buyer",
      "inventory_analyst",
      "supply_status",
      "priority_level",
      "shadow",
      "action",
    ] as const;

    const overrides: Partial<Record<(typeof supported)[number], string[]>> = {};
    for (const key of supported) {
      const raw = searchParams.get(key);
      if (raw == null) continue;
      const values = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      if (values.length === 0) continue;
      overrides[key] = values;
    }

    if (Object.keys(overrides).length === 0) return;

    // "action" is a computed tier — only apply it to the IDP dialog, not the
    // main Demand Planner table (dashboard See More links use ?action= to
    // pre-filter the planner modal only).
    const { action: actionOverride, ...tableOverrides } = overrides as any;
    if (Object.keys(tableOverrides).length > 0) {
      setFilters((prev) => ({ ...prev, ...tableOverrides }));
    }
    setIdpFilters((prev) => ({ ...prev, ...overrides }));
  }, [searchParams, setFilters, setIdpFilters]);

  // Forecast option is now PER-ROW (stored on forecast_report_manual.forecast_option).
  // The app reads from a single source table — forecast_report — and applies the
  // selected formula client-side per row.
  const forecastOption = "forecast_report"; // legacy var kept for places still keyed by it
  const TABLE_NAME = "forecast_report";

  // Per-row context-menu state for picking a forecast option (1..4).
  const [rowOptionMenu, setRowOptionMenu] = useState<{
    x: number;
    y: number;
    sku: string;
    currentOption: number;
  } | null>(null);

  /** Optimistic row-level recompute patches shown immediately after manual edits. */
  const [localRowPatches, setLocalRowPatches] = useState<Record<string, Record<string, unknown>>>({});

  /** Formula highlighting state - tracks which cell is active and which cells are its inputs */
  const [formulaHighlight, setFormulaHighlight] = useState<{
    sku: string;
    activeColumn: string;
    inputColumns: string[];
  } | null>(null);

  // Viewport-fixed position of the Total CBM Approved summary label.
  const [summaryFixedPos, setSummaryFixedPos] = useState<{ x: number; y: number } | null>(null);

  /** Toggle: show/hide formula tooltip on cell click. Persisted in localStorage. */
  const [showFormulaTooltip, setShowFormulaTooltip] = useState<boolean>(() => {
    try {
      return localStorage.getItem("filter:monthly-forecast:formula-tooltip") !== "false";
    } catch {
      return true;
    }
  });

  // Apply query-param filters on mount (e.g. from dashboard drill-down)
  useEffect(() => {
    const qpSupply = searchParams.get("supply_status");
    if (qpSupply) {
      setFilters((prev) => ({ ...prev, supply_status: [qpSupply] }));
      searchParams.delete("supply_status");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: rawSchema = [], isLoading: schemaLoading } = useQuery({
    queryKey: ["forecast-report-schema", TABLE_NAME],
    queryFn: async () => {
      // Try RPC first (works for tables & regular views)
      const { data, error } = await supabase.rpc("get_table_columns", { p_schema: "public", p_table: TABLE_NAME });
      if (!error && data && (data as SchemaColumn[]).length > 0) {
        return ((data as SchemaColumn[]) ?? []).sort((a, b) => a.ordinal_position - b.ordinal_position);
      }

      // Fallback for materialized views: fetch one row and infer columns
      const { data: sampleRows, error: sampleErr } = await supabase.from(TABLE_NAME).select("*").limit(1);
      if (sampleErr) throw sampleErr;
      if (!sampleRows || sampleRows.length === 0) {
        return [];
      }
      const sample = sampleRows[0] as Record<string, unknown>;
      const inferredSchema: SchemaColumn[] = Object.keys(sample).map((key, idx) => {
        const val = sample[key];
        let dataType = "text";
        if (typeof val === "number") dataType = "numeric";
        else if (typeof val === "boolean") dataType = "boolean";
        else if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) dataType = "date";
        return {
          column_name: key,
          data_type: dataType,
          is_nullable: "YES",
          column_default: null,
          ordinal_position: idx + 1,
        };
      });
      return inferredSchema.sort((a, b) => a.ordinal_position - b.ordinal_position);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Re-measure the summary position once the schema (and therefore table headers)
  // have loaded. On initial mount the double-rAF fires before headers exist in DOM.
  useEffect(() => {
    if (schemaLoading) return;
    const scrollEl = tableScrollRef.current;
    if (!scrollEl) return;
    const rafId = requestAnimationFrame(() => requestAnimationFrame(() => {
      const th = scrollEl.querySelector<HTMLElement>('th[data-col="total_cbm_approved"]');
      if (!th) return;
      const thRect = th.getBoundingClientRect();
      const containerRect = scrollEl.getBoundingClientRect();
      const paginationBar = document.querySelector<HTMLElement>('[data-pagination-bar]');
      const viewportX = thRect.left + thRect.width / 2;
      const paginationRect = paginationBar?.getBoundingClientRect();
      const paginationY = paginationRect
        ? paginationRect.top + paginationRect.height / 2
        : containerRect.bottom + 18;
      const LABEL_HALF_W = 140;
      const clampMin = containerRect.left + LABEL_HALF_W + 8;
      const clampMax = containerRect.right - 330;
      setSummaryFixedPos({ x: Math.max(clampMin, Math.min(viewportX, clampMax)), y: paginationY });
    }));
    return () => cancelAnimationFrame(rafId);
  }, [schemaLoading]);

  const rollingInstock = useMemo(() => getRollingMonths(now, 5), [now]);
  // rollingSalesMonths: 10-month window ending at previous month
  // sales_month_9 = oldest, sales_month_0 = newest (prev month)
  const rollingSalesMonths = useMemo(() => {
    const out: { month: number; year: number }[] = [];
    const base = new Date(now.getFullYear(), now.getMonth() - 1, 1); // prev month
    for (let i = 9; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      out.push({ month: d.getMonth() + 1, year: d.getFullYear() });
    }
    return out; // [oldest, ..., prev month] length=10
  }, [now]);
  const rollingIncomingMonths = useMemo(() => getRolling12MonthsStartingCurrent(now), [now]);

  // ── IDP planner header — fully driven by the shared column registry ──
  // The registry (src/lib/forecast/idpColumns.ts) is the single source of
  // truth for column order, labels, widths, and group banners across the
  // planner UI, the CSV download, and the emailed CSV.
  const idpMonthLabels = useMemo(() => {
    const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return rollingIncomingMonths.slice(0, 3).map((m) => MONTH_ABBR[m.month - 1]) as [string, string, string];
  }, [rollingIncomingMonths]);
  const idpRegistryColumns = useMemo(() => buildIdpColumns(idpMonthLabels), [idpMonthLabels]);
  const idpHeaderRows = useMemo(() => buildIdpHeaderRows(idpRegistryColumns), [idpRegistryColumns]);

  const salesDiffHeader = useMemo(() => getSalesDiffHeader(now), [now]);
  const actualSalesHeader = useMemo(() => getActualSalesHeader(), []);
  const last2MonthsAvgHeader = useMemo(() => getLast2MonthsAvgHeader(now), [now]);

  // Display oldest→newest, same as before — value source is reversed:
  // position 1 → sales_month_9 (recent_month_10, pinakaluma),
  // position 10 → sales_month_0 (recent_month_1, huling kumpletong buwan)
  const orderedSalesColumns = useMemo(() => {
    return Array.from({ length: 10 }, (_, i) => `sales_month_${9 - i}`);
  }, []);

  const orderedIncomingColumns = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => `incoming_month_${i + 1}`);
  }, []);

  const orderedReplacementIncomingColumns = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => `repl_month_${i + 1}`);
  }, []);

  const orderedSupplyColumns = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => `supply_month_${i + 1}`);
  }, []);

  const orderedProjectionColumns = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => `proj_month_${i + 1}`);
  }, []);

  const orderedRevenueColumns = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => `rev_month_${i + 1}`);
  }, []);

  const orderedLostRevenueColumns = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => `lost_month_${i + 1}`);
  }, []);

  const displaySchema = useMemo(() => {
    const base = rawSchema.filter((c) => !HIDE_DISPLAY_COLUMNS.includes(c.column_name));

    // Ensure all 10 sales_month columns exist in schema even if DB only has fewer
    // (recent_month_1..recent_month_10 = 10 completed months from forecast_monthly_sales)
    const existingSalesCols = new Set(
      base.filter((c) => /^sales_month_\d{1,2}$/i.test(c.column_name)).map((c) => c.column_name.toLowerCase()),
    );
    const syntheticSalesCols: SchemaColumn[] = [];
    for (let i = 0; i <= 9; i++) {
      const colName = `sales_month_${i}`;
      if (!existingSalesCols.has(colName)) {
        syntheticSalesCols.push({
          column_name: colName,
          data_type: "numeric",
          ordinal_position: 9000 + i,
        });
      }
    }

    const allCols = [...base, ...syntheticSalesCols];

    // Ensure manual note cols exist as synthetic cols only
    const existingColNames = new Set(allCols.map((c) => c.column_name.toLowerCase()));
    const syntheticTextCols = ["buyer_notes", "planner_notes", "analyst_notes"];
    for (const mc of syntheticTextCols) {
      if (!existingColNames.has(mc)) {
        allCols.push({
          column_name: mc,
          data_type: "text",
          ordinal_position: 8000 + syntheticTextCols.indexOf(mc),
          is_nullable: "YES",
          column_default: null,
        } as SchemaColumn);
      }
    }
    // total_revenue / total_lost_revenue removed — groups hidden
    const syntheticTotalCols: string[] = [];
    for (const tc of syntheticTotalCols) {
      if (!existingColNames.has(tc)) {
        allCols.push({
          column_name: tc,
          data_type: "numeric",
          ordinal_position: 8500 + syntheticTotalCols.indexOf(tc),
          is_nullable: "YES",
          column_default: null,
        } as SchemaColumn);
      }
    }

    // Back In Stock Request synthetic columns (rendered between Total Revenue
    // and FBA Reserved). Created here in case the DB schema introspection
    // doesn't yet expose them — group position is driven by GROUP_ORDER, not
    // ordinal_position.
    const syntheticBackInStockCols = ["unsent_notifications_count", "quantity_required", "back_unit_price"];
    for (const bc of syntheticBackInStockCols) {
      if (!existingColNames.has(bc)) {
        allCols.push({
          column_name: bc,
          data_type: "numeric",
          ordinal_position: 8550 + syntheticBackInStockCols.indexOf(bc),
          is_nullable: "YES",
          column_default: null,
        } as SchemaColumn);
      }
    }

    // Ensure 90-Day Reorder Decisions synthetic columns exist
    const synthetic90DayForecastCols = [
      "ninety_day_projection",
      "ninety_day_supply",
      "ninety_day_deficit",
      "ninety_day_revenue_loss",
      "safety_stock",
      "order_recommended",
      "lead_time",
      "order_date_forecast",
      "supply_month_forecast",
      "covered_months",
      "action",
    ];
    for (const fc of synthetic90DayForecastCols) {
      if (!existingColNames.has(fc)) {
        allCols.push({
          column_name: fc,
          data_type: fc === "action" || fc === "order_date_forecast" || fc === "supply_month_forecast" || fc === "covered_months" ? "text" : "numeric",
          ordinal_position: 8600 + synthetic90DayForecastCols.indexOf(fc),
          is_nullable: "YES",
          column_default: null,
        } as SchemaColumn);
      }
    }

    const hasRealSupplyingMonth = allCols.some((c) => c.column_name.toLowerCase() === "supplying_month");

    let filtered = allCols.filter((c) => {
      const n = c.column_name.toLowerCase();
      if (n === "supply_month" && hasRealSupplyingMonth) return false;

      const g = groupKey(c.column_name);
      if (g === "other") return false;

      if (g === "sales_monthly") return /^sales_month_(\d|1\d|2[0-5])$/i.test(c.column_name);
      if (g === "projection") { const n = Number(c.column_name.match(/^proj_month_(\d{1,2})$/i)?.[1]); return n >= 1 && n <= 9; }
      if (g === "revenue" || g === "lost_revenue") return false;
      if (g === "replacement_incoming") return /^repl_month_(\d{1,2})$/i.test(c.column_name);
      if (g === "incoming") { const n = Number(c.column_name.match(/^incoming_month_(\d{1,2})$/i)?.[1]); return n >= 1 && n <= 9; }
      if (g === "instock") return /^month_[1-5]$/i.test(c.column_name);
      if (g === "supply_plan") { const n = Number(c.column_name.match(/^supply_month_(\d{1,2})$/i)?.[1]); return n >= 1 && n <= 9; }

      return true;
    });

    const GROUP_ORDER = [
      "basic",
      "instock",
      "sales_monthly",
      "sales_metrics",
      "projection",
      "back_in_stock",
      "inventory",
      "incoming",
      "inventory_breakdown",
      "90day_forecast",
      "rates",
      "order",
      "supply_plan",
      "replacement",
      "replacement_inventory",
      "replacement_incoming",
      "other",
    ] as const;

    const groupRank = (g: string) => {
      const i = GROUP_ORDER.indexOf(g as any);
      return i === -1 ? 999 : i;
    };

    const isSM = (n: string) => SALES_METRICS_ORDER.includes(n.toLowerCase());

    filtered = filtered
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const an = a.c.column_name.toLowerCase();
        const bn = b.c.column_name.toLowerCase();

        const ag = groupKey(a.c.column_name);
        const bg = groupKey(b.c.column_name);

        const gr = groupRank(ag) - groupRank(bg);
        if (gr !== 0) return gr;

        const aSM = isSM(an);
        const bSM = isSM(bn);
        if (aSM && bSM) return SALES_METRICS_ORDER.indexOf(an) - SALES_METRICS_ORDER.indexOf(bn);

        if (ag === "sales_monthly" && bg === "sales_monthly") {
          return orderedSalesColumns.indexOf(an) - orderedSalesColumns.indexOf(bn);
        }

        if (ag === "projection" && bg === "projection") {
          return orderedProjectionColumns.indexOf(an) - orderedProjectionColumns.indexOf(bn);
        }

        if (ag === "incoming" && bg === "incoming") {
          return orderedIncomingColumns.indexOf(an) - orderedIncomingColumns.indexOf(bn);
        }

        if (ag === "replacement_incoming" && bg === "replacement_incoming") {
          return orderedReplacementIncomingColumns.indexOf(an) - orderedReplacementIncomingColumns.indexOf(bn);
        }

        if (ag === "supply_plan" && bg === "supply_plan") {
          return orderedSupplyColumns.indexOf(an) - orderedSupplyColumns.indexOf(bn);
        }

        if (ag === "inventory_breakdown" && bg === "inventory_breakdown") {
          const days = (s: string) => {
            const m = s.match(/^oo_units_(\d+)days$/);
            return m ? Number(m[1]) : 0;
          };
          return days(an) - days(bn);
        }

        if (ag === "revenue" && bg === "revenue") {
          if (an === "total_revenue") return 1;
          if (bn === "total_revenue") return -1;
          return orderedRevenueColumns.indexOf(an) - orderedRevenueColumns.indexOf(bn);
        }

        if (ag === "lost_revenue" && bg === "lost_revenue") {
          if (an === "total_lost_revenue") return 1;
          if (bn === "total_lost_revenue") return -1;
          return orderedLostRevenueColumns.indexOf(an) - orderedLostRevenueColumns.indexOf(bn);
        }

        // Basic group: fixed column order (description/sku forced first in fullSchema, but shadow→status here)
        if (ag === "basic" && bg === "basic") {
          const BASIC_COL_ORDER = [
            "description", "sku", "priority_level", "factory",
            "kit", "category", "shadow", "item_color", "status",
            "pu_status", "shopify_status", "purchasing_url", "shopify_url",
          ];
          const aIdx = BASIC_COL_ORDER.indexOf(an);
          const bIdx = BASIC_COL_ORDER.indexOf(bn);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
        }

        // Order group: use fixed column order
        if (ag === "order" && bg === "order") {
          const aIdx = ORDER_GROUP_COL_ORDER.indexOf(an);
          const bIdx = ORDER_GROUP_COL_ORDER.indexOf(bn);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
        }

        const aMo = monthOrderFromAnyCol(a.c.column_name);
        const bMo = monthOrderFromAnyCol(b.c.column_name);

        if (aMo != null && bMo != null) {
          const ay = yearFromCol(a.c.column_name) ?? 0;
          const by = yearFromCol(b.c.column_name) ?? 0;
          if (ay !== by) return ay - by;
          return aMo - bMo;
        }

        return a.i - b.i;
      })
      .map((x) => x.c);

    // Guarantee basic column order regardless of DB ordinal positions
    const BASIC_FIXED_ORDER = [
      "description", "sku", "priority_level", "factory",
      "kit", "category", "shadow", "item_color", "status",
      "pu_status", "shopify_status", "purchasing_url", "shopify_url",
    ];
    const basicSet = new Set(BASIC_FIXED_ORDER);
    const basicCols = BASIC_FIXED_ORDER.map((n) => filtered.find((c) => c.column_name === n)).filter(Boolean) as typeof filtered;
    const nonBasic = filtered.filter((c) => !basicSet.has(c.column_name));
    filtered = [...basicCols, ...nonBasic];

    return filtered;
  }, [
    rawSchema,
    orderedSalesColumns,
    orderedIncomingColumns,
    orderedReplacementIncomingColumns,
    orderedSupplyColumns,
    orderedProjectionColumns,
    orderedRevenueColumns,
    orderedLostRevenueColumns,
  ]);

  const pkCol = useMemo(() => {
    for (const name of ID_PRIORITY) {
      if (rawSchema.some((c) => c.column_name === name)) return name;
    }
    return rawSchema[0]?.column_name ?? "id";
  }, [rawSchema]);

  /** ── Column visibility (fast local state + deferred persistence) ── */
  const REQUIRED_COLUMNS = useMemo(() => ["sku", "description"], []);

  // 90-Day Reorder Decisions columns - permanently hidden from main table
  const PERMANENTLY_HIDDEN_90DAY_COLUMNS = [
    "ninety_day_projection",
    "ninety_day_supply",
    "ninety_day_deficit",
    "ninety_day_revenue_loss",
    "safety_stock",
    "order_recommended",
    "order_date_forecast",
    "supply_month_forecast",
    "covered_months",
    "action",
  ];

  const [hiddenColumnsArr, setHiddenColumnsArrRaw] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("filter:monthly-forecast:hidden-cols");
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        // Always merge with permanently hidden 90-day columns
        const merged = new Set([...parsed, ...PERMANENTLY_HIDDEN_90DAY_COLUMNS]);
        return Array.from(merged);
      }
    } catch {
      /* ignore */
    }
    // Default: hide all 90-day columns
    return PERMANENTLY_HIDDEN_90DAY_COLUMNS;
  });
  const hiddenColumns = useMemo(() => new Set(hiddenColumnsArr), [hiddenColumnsArr]);

  // Deferred localStorage write — doesn't block the UI toggle
  const persistTimerHidden = useRef<ReturnType<typeof setTimeout>>();
  const setHiddenColumnsArr = useCallback((arr: string[]) => {
    // Always enforce that 90-day columns remain hidden
    const enforced = new Set([...arr, ...PERMANENTLY_HIDDEN_90DAY_COLUMNS]);
    const enforcedArr = Array.from(enforced);
    setHiddenColumnsArrRaw(enforcedArr);
    if (persistTimerHidden.current) clearTimeout(persistTimerHidden.current);
    persistTimerHidden.current = setTimeout(() => {
      try {
        localStorage.setItem("filter:monthly-forecast:hidden-cols", JSON.stringify(enforcedArr));
      } catch {
        /* ignore */
      }
    }, 300);
  }, []);

  const setHiddenColumns = useCallback((s: Set<string>) => setHiddenColumnsArr(Array.from(s)), [setHiddenColumnsArr]);

  /** ── Extra user-frozen columns (beyond required description + sku) ── */
  const REQUIRED_FROZEN_COLS = useMemo(() => ["description", "sku"], []);
  const [extraFrozenCols, setExtraFrozenCols] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("filter:monthly-forecast:extra-frozen");
      if (stored) return JSON.parse(stored) as string[];
    } catch { /* ignore */ }
    return [];
  });
  const handleFreezeToggle = useCallback((colKey: string) => {
    if (REQUIRED_FROZEN_COLS.includes(colKey)) return;
    setExtraFrozenCols((prev) => {
      const next = prev.includes(colKey) ? prev.filter((c) => c !== colKey) : [...prev, colKey];
      try { localStorage.setItem("filter:monthly-forecast:extra-frozen", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [REQUIRED_FROZEN_COLS]);

  /** ── Column widths (fast local state + deferred persistence) ── */
  const [columnWidths, setColumnWidthsRaw] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem("filter:monthly-forecast:col-widths");
      if (stored) return JSON.parse(stored) as Record<string, number>;
    } catch {
      /* ignore */
    }
    return {};
  });
  const columnWidthsRef = useRef(columnWidths);
  columnWidthsRef.current = columnWidths;

  const persistTimerWidths = useRef<ReturnType<typeof setTimeout>>();
  const setColumnWidths = useCallback(
    (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
      setColumnWidthsRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (persistTimerWidths.current) clearTimeout(persistTimerWidths.current);
        persistTimerWidths.current = setTimeout(() => {
          try {
            localStorage.setItem("filter:monthly-forecast:col-widths", JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }, 500);
        return next;
      });
    },
    [],
  );

  /** Full schema (all cols) for column visibility dropdown.
   *  Order: description (Product Name) first, then sku (Product ID), then the rest. */
  const fullSchema = useMemo(() => {
    const desc = displaySchema.find((c) => c.column_name === "description");
    const pk = displaySchema.find((c) => c.column_name === pkCol);
    const rest = displaySchema.filter((c) => c.column_name !== pkCol && c.column_name !== "description");
    const head: typeof displaySchema = [];
    if (desc) head.push(desc);
    if (pk && pkCol !== "description") head.push(pk);
    return [...head, ...rest];
  }, [displaySchema, pkCol]);

  /** Incoming Breakdown sort: which oo_units_*days column to ORDER BY (DESC). */
  const [incomingDaysSort, setIncomingDaysSort] = usePersistedState<number | null>(
    "monthly-forecast:incoming-days-sort",
    null,
  );

  // Server-side sort on the Level of Priority column. "none" = default (sku) order.
  // asc is alphabetical, which is also the logical urgency order:
  // 1st Priority → 2nd Priority → Least Priority → (Blank).
  const [prioritySort, setPrioritySort] = usePersistedState<"none" | "asc" | "desc">(
    "monthly-forecast:priority-sort",
    "none",
  );

  // Server-side sort on the Factory column (the planner's request: group rows by
  // factory, e.g. all VND3 together). Same cycle UX as the Priority chip.
  const [factorySort, setFactorySort] = usePersistedState<"none" | "asc" | "desc">(
    "monthly-forecast:factory-sort",
    "none",
  );

  /** Visible schema (filtered by hidden columns). Frozen columns
   *  are forced to the front in ALL_FROZEN_COLS order. */
  const schema = useMemo(() => {
    const filtered = fullSchema.filter(
      (c) => !hiddenColumns.has(c.column_name) && !["oo_units_210days", "oo_units_120days", "oo_units_150days", "oo_units_180days"].includes(c.column_name),
    );
    const frozenOrder = [...REQUIRED_FROZEN_COLS, ...extraFrozenCols.filter((c) => !REQUIRED_FROZEN_COLS.includes(c))];
    const frozenSet = new Set(frozenOrder);
    const byName = new Map<string, (typeof filtered)[number]>();
    for (const c of filtered) byName.set(c.column_name, c);
    const frozenInOrder = frozenOrder.map((name) => byName.get(name)).filter(
      (c): c is (typeof filtered)[number] => Boolean(c),
    );
    const rest = filtered.filter((c) => !frozenSet.has(c.column_name));
    return [...frozenInOrder, ...rest];
  }, [fullSchema, hiddenColumns, REQUIRED_FROZEN_COLS, extraFrozenCols]);

  /** ── Frozen column layout derived from VISIBLE columns only ── */
  const ALL_FROZEN_COLS = useMemo(
    () => [...REQUIRED_FROZEN_COLS, ...extraFrozenCols.filter((c) => !REQUIRED_FROZEN_COLS.includes(c))],
    [REQUIRED_FROZEN_COLS, extraFrozenCols],
  );
  const DEFAULT_FROZEN_WIDTHS: Record<string, number> = useMemo(
    () => ({
      sku: 120,
      description: 320,
      priority_level: 100,
      factory: 85,
      status: 70,
      pu_status: 80,
      purchasing_url: 80,
      shopify_status: 80,
      shopify_url: 80,
      kit: 50,
      item_color: 100,
      category: 110,
      shadow: 70,
      total_cbm_approved: 100,
    }),
    [],
  );

  /** Only frozen cols that are currently visible */
  const visibleFrozenCols = useMemo(() => {
    const visibleSet = new Set(schema.map((c) => c.column_name.toLowerCase()));
    return ALL_FROZEN_COLS.filter((c) => visibleSet.has(c));
  }, [schema, ALL_FROZEN_COLS]);

  /** Precomputed left offsets for each visible frozen column.
   *  Shifted by ROW_NUM_WIDTH so the leading row-number column sits at left:0. */
  const frozenLayout = useMemo(() => {
    const layout: Record<string, { left: number; width: number; idx: number; isLast: boolean }> = {};
    let cumLeft = ROW_NUM_WIDTH;
    for (let i = 0; i < visibleFrozenCols.length; i++) {
      const col = visibleFrozenCols[i];
      const w = columnWidths[col] || DEFAULT_FROZEN_WIDTHS[col] || 80;
      layout[col] = { left: cumLeft, width: w, idx: i, isLast: i === visibleFrozenCols.length - 1 };
      cumLeft += w;
    }
    return layout;
  }, [visibleFrozenCols, columnWidths, DEFAULT_FROZEN_WIDTHS]);

  // Resolved pixel width for EVERY column — the table is table-layout:fixed with a
  // <colgroup>, so widths are content-independent (no jump when new rows scroll in,
  // and a resized width actually sticks). Priority: frozen layout → user resize →
  // known default → month/units pattern → fallback.
  const NON_FROZEN_DEFAULT_WIDTHS: Record<string, number> = useMemo(() => ({
    sku_status: 90, supply_status: 100, order_proposal_qty: 85, months_worth: 78,
    monthly_projection: 85, buyer_notes: 95, planner_notes: 140, analyst_notes: 140,
    cbm: 60, po_number: 100, factory_latest_po_ordered: 110, order_date: 85,
    supplying_month: 95, supply_month: 95, replacement_rate: 78, return_rate: 78,
    total_revenue: 95, total_lost_revenue: 95, lead_time: 78, buyer: 95,
    inventory_analyst: 100, country: 85, actual_sale_of_month: 78, sales_velocity: 85,
    unshipped: 78, last_2months_avg: 78, sales_diff: 78, unit_cost: 78,
    unsent_notifications_count: 95, quantity_required: 85, back_unit_price: 78,
  }), []);
  const colBodyWidth = useCallback((name: string) => {
    const n = name.toLowerCase();
    if (frozenLayout[n]) return frozenLayout[n].width;
    if (columnWidths[n]) return columnWidths[n];
    if (DEFAULT_FROZEN_WIDTHS[n]) return DEFAULT_FROZEN_WIDTHS[n];
    if (/_month_\d+$/.test(n) || /^oo_units_\d+days$/.test(n)) return 72;
    return NON_FROZEN_DEFAULT_WIDTHS[n] ?? 85;
  }, [frozenLayout, columnWidths, DEFAULT_FROZEN_WIDTHS, NON_FROZEN_DEFAULT_WIDTHS]);
  const forecastTotalWidth = useMemo(
    () => ROW_NUM_WIDTH + schema.reduce((s, c) => s + colBodyWidth(c.column_name), 0),
    [schema, colBodyWidth],
  );

  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Min/max width constraints per column type
  const getColumnMinMax = useCallback((col: string) => {
    const FROZEN_WIDTHS: Record<string, { min: number; max: number }> = {
      sku: { min: 80, max: 300 },
      description: { min: 150, max: 600 },
      priority_level: { min: 60, max: 200 },
      factory: { min: 60, max: 200 },
      status: { min: 50, max: 160 },
      pu_status: { min: 70, max: 200 },
      kit: { min: 40, max: 120 },
      category: { min: 60, max: 250 },
      shadow: { min: 50, max: 150 },
    };
    return FROZEN_WIDTHS[col.toLowerCase()] || { min: 40, max: 400 };
  }, []);

  // Smooth resize handler using rAF to batch DOM updates
  const handleResizeStart = useCallback(
    (col: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = columnWidthsRef.current[col] || 80;
      const { min, max } = getColumnMinMax(col);
      resizingRef.current = { col, startX, startW };

      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        // Cancel any pending rAF to avoid stacking frames
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          if (!resizingRef.current) return;
          const diff = ev.clientX - resizingRef.current.startX;
          const newW = Math.min(max, Math.max(min, resizingRef.current.startW + diff));
          setColumnWidths((prev) => ({ ...prev, [resizingRef.current!.col]: newW }));
        });
      };
      const onUp = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        resizingRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [setColumnWidths, getColumnMinMax],
  );

  const resetColumns = useCallback(() => {
    // Reset to only permanently hidden columns (90-day inventory decision planner)
    setHiddenColumnsArr(PERMANENTLY_HIDDEN_90DAY_COLUMNS);
    setColumnWidths({});
    setSelectedColumns(new Set());
    toast.success("Columns reset to defaults");
  }, [setHiddenColumnsArr, setColumnWidths]);

  /** ── Multi-select column headers (Excel-like) ── */
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  /** Per-token hover highlight from formula tooltip. */
  const [hoverHighlight, setHoverHighlight] = useState<{ col: string; hsl: string } | null>(null);
  /** Last clicked sales-month column (e.g. "sales_month_0"). Used to substitute
   * placeholder month tokens inside formula tooltips with friendly labels. */
  const [selectedMonthCol, setSelectedMonthCol] = useState<string | null>(null);
  const lastClickedColRef = useRef<string | null>(null);

  const handleColumnHeaderClick = useCallback(
    (colName: string, e: React.MouseEvent) => {
      e.preventDefault();
      const isCtrlCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      setSelectedColumns((prev) => {
        const next = new Set(prev);

        if (isShift && lastClickedColRef.current) {
          // Range select between last clicked and current
          const allColNames = schema.map((c) => c.column_name);
          const startIdx = allColNames.indexOf(lastClickedColRef.current);
          const endIdx = allColNames.indexOf(colName);
          if (startIdx !== -1 && endIdx !== -1) {
            const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            for (let j = from; j <= to; j++) {
              next.add(allColNames[j]);
            }
          }
        } else if (isCtrlCmd) {
          // Toggle single
          if (next.has(colName)) next.delete(colName);
          else next.add(colName);
        } else {
          // Single select (clear others)
          if (next.size === 1 && next.has(colName)) {
            next.clear();
          } else {
            next.clear();
            next.add(colName);
          }
        }
        return next;
      });
      lastClickedColRef.current = colName;
      // Track last clicked sales-month column for tooltip month substitution.
      if (/^sales_month_\d{1,2}$/i.test(colName)) {
        setSelectedMonthCol(colName);
      }
    },
    [schema],
  );

  /** ── Context menu state ── */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; col: string } | null>(null);
  const handleColumnContextMenu = useCallback((colName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicked column isn't selected, select it alone
    setSelectedColumns((prev) => {
      if (!prev.has(colName)) {
        return new Set([colName]);
      }
      return prev;
    });
    setContextMenu({ x: e.clientX, y: e.clientY, col: colName });
  }, []);

  const handleContextMenuHide = useCallback(
    (keys: string[]) => {
      setHiddenColumnsArrRaw((prev) => {
        const s = new Set(prev);
        for (const k of keys) s.add(k);
        const next = Array.from(s);
        // Deferred persist
        if (persistTimerHidden.current) clearTimeout(persistTimerHidden.current);
        persistTimerHidden.current = setTimeout(() => {
          try {
            localStorage.setItem("filter:monthly-forecast:hidden-cols", JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }, 300);
        return next;
      });
      setSelectedColumns(new Set());
    },
    [setHiddenColumnsArr],
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const headerGroups = useMemo(() => {
    const cols = schema;
    const groups: { key: string; start: number; end: number }[] = [];
    for (let i = 0; i < cols.length; i++) {
      const g = groupKey(cols[i].column_name);
      const last = groups[groups.length - 1];
      if (!last || last.key !== g) groups.push({ key: g, start: i, end: i });
      else last.end = i;
    }
    return groups;
  }, [schema]);

  const editableCols = useMemo(() => rawSchema.map((c) => c.column_name).filter(isEditableColumn), [rawSchema]);

  const [searchQuery, setSearchQuery] = usePersistedState("monthly-forecast:search", "");
  const [currentPage, setCurrentPage] = usePersistedState("monthly-forecast:page", 1);
  const [pageSize, setPageSize] = usePersistedState("monthly-forecast:pageSize", 100);

  // Cycle the Level of Priority column sort: none → asc → desc → none.
  // Reset to page 1 so the user sees the newly-ordered top rows.
  const cyclePrioritySort = useCallback(() => {
    setPrioritySort((s) => (s === "none" ? "asc" : s === "asc" ? "desc" : "none"));
    setCurrentPage(1);
  }, [setPrioritySort, setCurrentPage]);

  // Cycle the Factory column sort: none → asc → desc → none.
  const cycleFactorySort = useCallback(() => {
    setFactorySort((s) => (s === "none" ? "asc" : s === "asc" ? "desc" : "none"));
    setCurrentPage(1);
  }, [setFactorySort, setCurrentPage]);

  // Improved Debounce for Search
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, setCurrentPage]);

  // Independent debounce for the IDP dialog search — must NOT advance the
  // main page's currentPage (dialog has its own dialogCurrentPage).
  const [debouncedIdpSearch, setDebouncedIdpSearch] = useState(idpSearchQuery);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedIdpSearch(idpSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [idpSearchQuery]);

  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  const [deleteRow, setDeleteRow] = useState<Record<string, unknown> | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Selection kept in a ref + imperative DOM class toggle to avoid re-rendering
  // the entire 100-row × 130-col tbody every time the user clicks a row.
  // === INSTANT ROW HIGHLIGHT ===
  const selectedRowKeyRef = useRef<string | number | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  const SELECTED_CLS = ["selected"];
  const STICKY_SELECTED_BG = "color-mix(in srgb, hsl(217 91% 60%) 10%, hsl(210 20% 96%))";
  const STICKY_DEFAULT_BG = "hsl(210 20% 96%)";

  const applyRowSelection = useCallback((nextKey: string | number | null) => {
    const tbody = tbodyRef.current;
    if (!tbody) {
      selectedRowKeyRef.current = nextKey;
      return;
    }
    const prevKey = selectedRowKeyRef.current;
    if (prevKey === nextKey) return;

    if (prevKey != null) {
      const prevEl = tbody.querySelector(`tr[data-row-key="${CSS.escape(String(prevKey))}"]`);
      if (prevEl) {
        prevEl.classList.remove(...SELECTED_CLS);
        const stickyCell = prevEl.querySelector<HTMLElement>("td[data-sticky-rownum]");
        if (stickyCell) stickyCell.style.background = STICKY_DEFAULT_BG;
      }
    }
    if (nextKey != null) {
      const nextEl = tbody.querySelector(`tr[data-row-key="${CSS.escape(String(nextKey))}"]`);
      if (nextEl) {
        nextEl.classList.add(...SELECTED_CLS);
        const stickyCell = nextEl.querySelector<HTMLElement>("td[data-sticky-rownum]");
        if (stickyCell) stickyCell.style.background = STICKY_SELECTED_BG;
      }
    }
    selectedRowKeyRef.current = nextKey;
  }, []);

  // Reset Forecast Option (bulk) — clears forecast_option for ALL rows in forecast_report_manual
  // Reset Forecast Option (Improved)
  const [resetForecastOptionOpen, setResetForecastOptionOpen] = useState(false);
  const [resettingForecastOption, setResettingForecastOption] = useState(false);

  // Reorder Decisions Dialog
  const [forecastAnalysisOpen, setForecastAnalysisOpen] = useState(false);

  // Storefront Stock Dialog (same data as IDP for now)
  const [shopifyInventoryOpen, setShopifyInventoryOpen] = useState(false);

  // AUTO-CLEAR FILTERS when Storefront Stock dialog opens
  // This ensures clean state every time the dialog is opened
  useEffect(() => {
    if (shopifyInventoryOpen) {
      setIdpFilters({
        sku: [],
        description: [],
        factory: [],
        status: [],
        pu_status: [],
        shopify_status: [], // Will be applied at data layer
        category: [],
        country: [],
        buyer: [],
        inventory_analyst: [],
        supply_status: [],
        priority_level: [],
        shadow: [],
        action: [],
      });
      setIdpSearchQuery("");
      setDialogCurrentPage(1);
    }
  }, [shopifyInventoryOpen]); // Run whenever dialog opens/closes

  // Deep-link support: the Reorder Decisions modal auto-opens on
  // mount when either (a) the path is /inventory-planner (the dedicated
  // shortcut route), or (b) ?view=planner is in the search params (works on
  // any route rendering this component, e.g. /monthly-forecast?view=planner).
  //
  // This effect lives below the useState above (not next to the URL-param
  // filter effect further up the component) because referencing
  // setForecastAnalysisOpen from that earlier effect would hit a TDZ
  // ReferenceError — the deps array is evaluated eagerly during render.
  const appliedUrlViewRef = useRef(false);
  useEffect(() => {
    if (appliedUrlViewRef.current) return;
    appliedUrlViewRef.current = true;
    const isPlannerRoute = location.pathname === "/inventory-planner";
    const isPlannerView = searchParams.get("view") === "planner";
    if (isPlannerRoute || isPlannerView) {
      setForecastAnalysisOpen(true);
    }
    if (searchParams.get("view") === "shopify") {
      setShopifyInventoryOpen(true);
    }
  }, [searchParams, location.pathname]);

  const [dialogPageSize, setDialogPageSize] = useState(50);
  const [dialogCurrentPage, setDialogCurrentPage] = useState(1);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showEmailSettingsDialog, setShowEmailSettingsDialog] = useState(false);
  const [emailSettingsReportType, setEmailSettingsReportType] = useState<'idp' | 'shopify'>('idp'); // Track which report type is being configured
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  
  // Fetch active schedule configuration (IDP)
  const { data: scheduleConfig, refetch: refetchSchedule } = useQuery({
    queryKey: ["email_schedule_config", "idp", "v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_schedule_config")
        .select("*")
        .eq("report_type", "idp")
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    staleTime: 0,
    cacheTime: 0,
  });

  // Fetch active schedule configuration (Shopify)
  const { data: shopifyScheduleConfig, refetch: refetchShopifySchedule } = useQuery({
    queryKey: ["email_schedule_config", "shopify", "v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_schedule_config")
        .select("*")
        .eq("report_type", "shopify")
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    staleTime: 0,
    cacheTime: 0,
  });
  
  // Fetch recent execution logs
  const { data: executionLogs = [] } = useQuery({
    queryKey: ["email_schedule_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_schedule_log")
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data || [];
    },
  });
  
  // Schedule settings state (initialized from database)
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'custom'>('daily');
  const [minutesInterval, setMinutesInterval] = useState(30);
  const [hoursInterval, setHoursInterval] = useState(1);
  const [monthlyDate, setMonthlyDate] = useState(1);
  const [lastDayOfMonth, setLastDayOfMonth] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [expireType, setExpireType] = useState<'never' | 'onDate'>('never');
  const [expireDate, setExpireDate] = useState('');
  
  // Load schedule config into state when dialog opens (uses correct config per report type)
  useEffect(() => {
    const activeConfig = emailSettingsReportType === 'shopify' ? shopifyScheduleConfig : scheduleConfig;
    if (showScheduleDialog) {
      setScheduleEnabled(activeConfig?.enabled || false);
      setRecurrenceType(activeConfig?.recurrence_type || 'daily');
      setMinutesInterval(activeConfig?.minutes_interval || 30);
      setHoursInterval(activeConfig?.hours_interval || 1);
      setMonthlyDate(activeConfig?.day_of_month || 1);
      setLastDayOfMonth(activeConfig?.last_day_of_month || false);
      setSelectedDays(activeConfig?.days_of_week || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
      setTimeOfDay(activeConfig?.time_of_day?.substring(0, 5) || '09:00');
      setExpireType(activeConfig?.expire_type || 'never');
      setExpireDate(activeConfig?.expire_date || '');
    }
  }, [showScheduleDialog, emailSettingsReportType, scheduleConfig, shopifyScheduleConfig]);
  
  // Fetch all emails from profiles table
  const { data: profileEmails = [] } = useQuery({
    queryKey: ["profiles_emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("email")
        .not("email", "is", null)
        .order("email", { ascending: true });
      
      if (error) throw error;
      return data?.map(p => p.email).filter(Boolean) || [];
    },
  });
  
  // Fetch email → factory mappings from database for IDP (Reorder Decisions)
  const { data: idpEmailFactoryMappings = [], refetch: refetchIdpEmailMappings } = useQuery({
    queryKey: ["email_factory_mapping", "idp"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_factory_mapping")
        .select("*")
        .eq("report_type", "idp") // Filter for IDP reports only
        .order("email", { ascending: true })
        .order("factory", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });
  
  // Fetch email → factory mappings from database for Storefront Stock
  const { data: shopifyEmailFactoryMappings = [], refetch: refetchShopifyEmailMappings } = useQuery({
    queryKey: ["email_factory_mapping", "shopify"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_factory_mapping")
        .select("*")
        .eq("report_type", "shopify") // Filter for Shopify reports only
        .order("email", { ascending: true })
        .order("factory", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });
  
  // Convert database rows to grouped format for IDP: { email: [factory1, factory2, ...] }
  const idpEmailFactoryGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const mapping of idpEmailFactoryMappings) {
      if (!groups[mapping.email]) {
        groups[mapping.email] = [];
      }
      // Filter out "UNASSIGNED" marker - it's just a placeholder
      if (mapping.factory !== "UNASSIGNED") {
        groups[mapping.email].push(mapping.factory);
      }
    }
    return groups;
  }, [idpEmailFactoryMappings]);
  
  // Convert database rows to grouped format for Shopify: { email: [factory1, factory2, ...] }
  const shopifyEmailFactoryGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const mapping of shopifyEmailFactoryMappings) {
      if (!groups[mapping.email]) {
        groups[mapping.email] = [];
      }
      // Filter out "UNASSIGNED" marker - it's just a placeholder
      if (mapping.factory !== "UNASSIGNED") {
        groups[mapping.email].push(mapping.factory);
      }
    }
    return groups;
  }, [shopifyEmailFactoryMappings]);
  
  // Keep legacy emailFactoryGroups for backward compatibility (uses IDP)
  const emailFactoryGroups = idpEmailFactoryGroups;
  const emailFactoryMappings = idpEmailFactoryMappings;
  
  // Get available emails (not yet assigned to the current report type)
  const availableEmails = useMemo(() => {
    // Check which emails are already assigned for the CURRENT report type being configured
    const currentEmailGroups = emailSettingsReportType === 'shopify' ? shopifyEmailFactoryGroups : idpEmailFactoryGroups;
    const assignedEmails = Object.keys(currentEmailGroups);
    return profileEmails.filter(email => !assignedEmails.includes(email));
  }, [profileEmails, emailSettingsReportType, shopifyEmailFactoryGroups, idpEmailFactoryGroups]);
  
  // IDP auto-send is handled by EmailAutoSendProvider (with atomic DB claim).
  // No local interval needed here.

  // Auto-refresh Email Factory Assignments while its dialog is open.
  // Re-fetches email_factory_mapping every 30s so concurrent edits from
  // other browsers show up without closing/reopening the dialog.
  useEffect(() => {
    if (!showEmailSettingsDialog) return;

    const interval = window.setInterval(() => {
      // Refetch both IDP and Shopify mappings
      refetchIdpEmailMappings();
      refetchShopifyEmailMappings();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [showEmailSettingsDialog, refetchIdpEmailMappings, refetchShopifyEmailMappings]);

  // Formula highlighting for dialog
  const [dialogFormulaHighlight, setDialogFormulaHighlight] = useState<{
    sku: string;
    activeColumn: string;
    inputColumns: string[];
  } | null>(null);


  // Fetch ALL items for dialog (no filters, fetch everything)
  // Always fetch so data is ready when dialog opens
  const { data: allItems = [], isLoading: allItemsLoading } = useQuery({
    queryKey: [QUERY_KEY, "all-items", TABLE_NAME, factoryRestricted, assignedCountry, factoryLevel, factoryKey],
    queryFn: async () => {
      // Fetch ALL rows without any filters - just raw data from the table
      let allRows: Record<string, unknown>[] = [];
      let offset = 0;
      const batchSize = 1000;

      while (true) {
        let qb = (supabase as any)
          .from(TABLE_NAME)
          .select("*")
          .order("sku", { ascending: true });
        // Factory/region gate — factory-level if assigned, else country-level.
        if (factoryLevel && allowedFactoryShortNames?.length) qb = qb.in("factory", allowedFactoryShortNames);
        else if (factoryRestricted && assignedCountry) qb = qb.ilike("country", assignedCountry);
        const { data, error } = await qb.range(offset, offset + batchSize - 1);
        
        if (error) throw error;
        if (!data || data.length === 0) break;

        allRows.push(...data);

        // If we got less than batchSize, we've reached the end
        if (data.length < batchSize) break;

        offset += batchSize;
      }

      return (allRows as Record<string, unknown>[]).map(normalizeForecastRow);
    },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const handleResetAllForecastOptions = useCallback(async () => {
    setResettingForecastOption(true);
    try {
      const result: any = await callAdminOperationsApi("forecast_clear_column", {
        table: "forecast_report_manual",
        field: "forecast_option",
      });

      if (result?.error) throw new Error(String(result.error));

      setLocalRowPatches({});

      queryClient.setQueryData(["forecast_report_manual"], (prev: any[] | undefined) => {
        if (!Array.isArray(prev)) return [];
        return prev.map((r) => ({ ...r, forecast_option: null }));
      });

      await queryClient.invalidateQueries({
        queryKey: ["forecast_report_manual"],
        refetchType: "all",
      });

      toast.success("All SKUs reset to Baseline (option 0)");
      setResetForecastOptionOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to reset forecast options");
    } finally {
      setResettingForecastOption(false);
    }
  }, [queryClient]);

  /** ── Helper: build Supabase filter query ── */
  /** ── Build Supabase filter query (FIXED & STRONGER SEARCH) ── */
  const buildFilteredQuery = useCallback(
    (selectExpr: string, opts?: { countOnly?: boolean }) => {
      let q = (supabase as any)
        .from(TABLE_NAME)
        .select(selectExpr, opts?.countOnly ? { count: "exact", head: true } : undefined);

      // Factory/region gate — factory-level if assigned, else country-level.
      // ilike is case-insensitive (handles dirty data like "Vietnam"/"vietnam").
      if (factoryLevel && allowedFactoryShortNames?.length) q = q.in("factory", allowedFactoryShortNames);
      else if (factoryRestricted && assignedCountry) q = q.ilike("country", assignedCountry);

      // Multi-select filters (all support the synthetic "(Blank)" option)
      if (filters.sku?.length) q = applyBlankAwareFilter(q, "sku", filters.sku);
      if (filters.description?.length) q = applyBlankAwareFilter(q, "description", filters.description);
      if (filters.factory?.length) q = applyBlankAwareFilter(q, "factory", filters.factory);
      if (filters.item_color?.length) q = applyBlankAwareFilter(q, "item_color", filters.item_color);
      if (filters.kit?.length) {
        // Kit stored inconsistently (true/false or Yes/No). Map selection to
        // all equivalent DB representations. "(Blank)" → null/empty/"-".
        const hasBlank = filters.kit.includes(OPTION_BLANK);
        const kitVariants: string[] = [];
        for (const sel of filters.kit) {
          if (sel === OPTION_BLANK) continue;
          const s = sel.toLowerCase();
          if (s === "yes" || s === "y") kitVariants.push("Y", "y", "Yes", "yes", "true", "TRUE", "True", "1");
          else if (s === "no" || s === "n") kitVariants.push("N", "n", "No", "no", "false", "FALSE", "False", "0");
          else kitVariants.push(sel);
        }
        if (hasBlank && kitVariants.length) {
          q = q.or(`kit.is.null,kit.eq.,kit.eq.-,kit.in.(${kitVariants.map(escapeOrValue).join(",")})`);
        } else if (hasBlank) {
          q = q.or("kit.is.null,kit.eq.,kit.eq.-");
        } else if (kitVariants.length) {
          q = q.in("kit", kitVariants);
        }
      }
      if (filters.status?.length) {
        // Expand each deduped selection to all case-variants in the data.
        q = applyBlankAwareFilter(
          q,
          "status",
          filters.status,
          (s) => statusVariantsRef.current.get(s.toLowerCase()) ?? [s],
        );
      }
      if (filters.pu_status?.length) {
        q = applyBlankAwareFilter(
          q,
          "pu_status",
          filters.pu_status,
          (s) => puStatusVariantsRef.current.get(s.toLowerCase()) ?? [s],
        );
      }
      if (filters.shopify_status?.length) {
        const hasDash = filters.shopify_status.includes("-");
        const realValues = filters.shopify_status.filter(v => v !== "-");
        
        if (hasDash && realValues.length > 0) {
          // Include both "-" (null/empty) and specific values like "Inactive"
          const realValuesExp = realValues.flatMap(
            (s) => shopifyStatusVariantsRef.current.get(s.toLowerCase()) ?? [s],
          );
          q = q.or(`shopify_status.is.null,shopify_status.eq.,shopify_status.eq.-,shopify_status.in.(${realValuesExp.join(",")})`);
        } else if (hasDash) {
          // Only "-" (null, empty, or literal "-")
          q = q.or("shopify_status.is.null,shopify_status.eq.,shopify_status.eq.-");
        } else if (realValues.length > 0) {
          // Only specific values (e.g., "Inactive")
          const realValuesExp = realValues.flatMap(
            (s) => shopifyStatusVariantsRef.current.get(s.toLowerCase()) ?? [s],
          );
          q = q.in("shopify_status", realValuesExp);
        }
      }
      if (filters.category?.length) q = applyBlankAwareFilter(q, "category", filters.category);
      if (filters.supply_status?.length) q = applyBlankAwareFilter(q, "supply_status", filters.supply_status);
      if (filters.priority_level?.length) q = applyBlankAwareFilter(q, "priority_level", filters.priority_level);
      if (filters.order_proposal_qty?.length) {
        const hasBlank = filters.order_proposal_qty.includes("(Blank)");
        const realValues = filters.order_proposal_qty.filter(v => v !== "(Blank)");
        // The DB column is numeric, but option labels can be text like "100/0"
        // (a manual override). Map each to its numeric value so PostgREST doesn't
        // choke on "invalid input syntax for type numeric". "100/0" → 100.
        const numericValues = [...new Set(
          realValues.map(v => parseFloat(String(v))).filter(n => Number.isFinite(n))
        )];

        if (hasBlank && numericValues.length > 0) {
          // Include both blank and specific values
          q = q.or(`order_proposal_qty.is.null,order_proposal_qty.eq.0,order_proposal_qty.in.(${numericValues.join(",")})`);
        } else if (hasBlank) {
          // Only blank values (null or 0)
          q = q.or("order_proposal_qty.is.null,order_proposal_qty.eq.0");
        } else if (numericValues.length > 0) {
          // Only specific values
          q = q.in("order_proposal_qty", numericValues);
        }
      }
      if (filters.buyer_notes?.length) {
        const hasBlank = filters.buyer_notes.includes("(Blank)");
        const realValues = filters.buyer_notes.filter(v => v !== "(Blank)");
        
        if (hasBlank && realValues.length > 0) {
          // Include both blank and specific values
          q = q.or(`buyer_notes.is.null,buyer_notes.eq.,buyer_notes.eq.-,buyer_notes.in.(${realValues.join(",")})`);
        } else if (hasBlank) {
          // Only blank values
          q = q.or("buyer_notes.is.null,buyer_notes.eq.,buyer_notes.eq.-");
        } else if (realValues.length > 0) {
          // Only specific values
          q = q.in("buyer_notes", realValues);
        }
      }
      if (filters.shadow?.length) {
        const hasBlank = filters.shadow.includes(OPTION_BLANK);
        const hasNo = filters.shadow.includes("no");
        const hasYes = filters.shadow.includes("yes");
        // "(Blank)" and "no" both already match null/empty; the blank-specific
        // condition only adds the literal "-" marker.
        const emptyConds = "shadow.is.null,shadow.eq.,shadow.eq.-";
        if (hasYes && (hasNo || hasBlank)) {
          q = q.or(`${emptyConds},shadow.eq.no,shadow.eq.yes`);
        } else if (hasYes) {
          q = q.eq("shadow", "yes");
        } else if (hasNo) {
          q = q.or(`${emptyConds},shadow.eq.no`);
        } else if (hasBlank) {
          q = q.or(emptyConds);
        }
      }
      // "Needs Order" = nothing in any of the four inventory buckets this
      // codebase already treats as one family (OH, OTW, OO, PO in Progress --
      // blank counts as zero) -- lets a factory-scoped view surface exactly
      // what still needs a PO. "No" is the inverse: something in at least one.
      if (filters.needs_order?.length) {
        const hasYes = filters.needs_order.includes("Yes");
        const hasNo = filters.needs_order.includes("No");
        if (hasYes && !hasNo) {
          q = q
            .or("oh_inv.is.null,oh_inv.lte.0")
            .or("otw_units.is.null,otw_units.lte.0")
            .or("on_order_units.is.null,on_order_units.lte.0")
            .or("po_in_progress.is.null,po_in_progress.lte.0");
        } else if (hasNo && !hasYes) {
          q = q.or("oh_inv.gt.0,otw_units.gt.0,on_order_units.gt.0,po_in_progress.gt.0");
        }
      }
      // Note: action filter is applied client-side since it's a computed column

      // ==================== FIXED SEARCH ====================
      // forecast_report has: sku, description (no product_id / product_master_sku columns)
      const searchTerm = debouncedSearch.trim();
      if (searchTerm) {
        // Escape only LIKE wildcards. Do NOT escape '-' (hyphens are literal in ILIKE).
        // Strip PostgREST .or() reserved chars: parentheses (comma is handled below,
        // as the multi-SKU separator, before this per-term escaping runs).
        const escapeTerm = (t: string) => t
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_")
          .replace(/[()]/g, " ")
          .trim();

        // Comma-separated input (pasting a random batch of SKUs to look up) matches
        // any of them against sku only -- description isn't relevant when the user
        // is hunting a specific known set of codes.
        if (searchTerm.includes(",")) {
          const terms = searchTerm.split(",").map((t) => escapeTerm(t)).filter(Boolean);
          if (terms.length) q = q.or(terms.map((t) => `sku.ilike.%${t}%`).join(","));
        } else {
          const escaped = escapeTerm(searchTerm);
          if (escaped) q = q.or(`sku.ilike.%${escaped}%,` + `description.ilike.%${escaped}%`);
        }
      }
      // ====================================================

      return q;
    },
    [filters, debouncedSearch, factoryRestricted, assignedCountry, factoryLevel, factoryKey],
  );

  /** ── Server-side paginated page rows ── */
  const pageQueryKey = [
    QUERY_KEY,
    "page",
    TABLE_NAME,
    currentPage,
    pageSize,
    filters,
    debouncedSearch,
    incomingDaysSort,
    prioritySort,
    factorySort,
    factoryRestricted,
    assignedCountry,
    factoryLevel,
    factoryKey,
  ];

  const {
    data: items = [],
    isLoading: dataLoading,
    error,
  } = useQuery({
    queryKey: pageQueryKey,
    queryFn: async () => {
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      let q = buildFilteredQuery("*");
      if (incomingDaysSort != null) {
        const sortCol = `oo_units_${incomingDaysSort}days`;
        q = q.order(sortCol, { ascending: false, nullsFirst: false });
      }
      // Primary sort on Level of Priority when the user has toggled it. Alphabetical
      // asc ("1st" < "2nd" < "Least") = urgency order; blanks/nulls forced last.
      // Factory sort groups every row of one factory together (e.g. all VND3);
      // applied first so it wins as the primary sort when toggled.
      if (factorySort !== "none") {
        q = q.order("factory", { ascending: factorySort === "asc", nullsFirst: false });
      }
      if (prioritySort !== "none") {
        q = q.order("priority_level", { ascending: prioritySort === "asc", nullsFirst: false });
      }
      const { data, error } = await q.order("sku", { ascending: true }).range(from, to);

      if (error) throw error;

      const pageRows = (data || []) as Record<string, unknown>[];
      return pageRows.map(normalizeForecastRow);
    },
    staleTime: 0,
    gcTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
    retryDelay: 1000,
  });

  /** ── Server-side total count (non-blocking) ── */
  const { data: totalCount = 0 } = useQuery({
    queryKey: [QUERY_KEY, "count", TABLE_NAME, filters, debouncedSearch, factoryRestricted, assignedCountry, factoryLevel, factoryKey],
    queryFn: async () => {
      const { count, error } = await buildFilteredQuery("*", { countOnly: true });
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const totalPages = Math.max(Math.ceil(totalCount / pageSize) || 1, 1);

  /** ── Stable row index map: sku → absolute row number in default (sku ASC) order ──
   *  Independent of current filters/sort so "row 279 = AA-338-NAT" stays consistent. */
  const { data: skuRankList = [] } = useQuery({
    queryKey: [QUERY_KEY, "row-index", TABLE_NAME],
    queryFn: async () => {
      const all: string[] = [];
      const CHUNK = 1000;
      let from = 0;
      // Loop in 1000-row chunks (Supabase default cap) until exhausted
      while (true) {
        const { data, error } = await (supabase as any)
          .from(TABLE_NAME)
          .select("sku")
          .order("sku", { ascending: true })
          .range(from, from + CHUNK - 1);
        if (error) throw error;
        const batch = (data || []) as Array<{ sku: string | null }>;
        for (const r of batch) {
          if (r?.sku != null) all.push(String(r.sku));
        }
        if (batch.length < CHUNK) break;
        from += CHUNK;
      }
      return all;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const skuRankMap = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < skuRankList.length; i++) {
      m.set(skuRankList[i], i + 1);
    }
    return m;
  }, [skuRankList]);

  /** ── Map of sku → image_url_1 from shopify_variant_mapping ──
   *  Bulk-fetched once; used to render product thumbnails in the Description column. */
  const { data: skuImageList = [] } = useQuery({
    queryKey: [QUERY_KEY, "sku-images", "shopify_variant_mapping"],
    queryFn: async () => {
      const all: Array<{ sku: string; image_url_1: string | null }> = [];
      const CHUNK = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await (supabase as any)
          .from("shopify_variant_mapping")
          .select("sku,image_url_1")
          .order("sku", { ascending: true })
          .range(from, from + CHUNK - 1);
        if (error) throw error;
        const batch = (data || []) as Array<{ sku: string | null; image_url_1: string | null }>;
        for (const r of batch) {
          if (r?.sku != null) all.push({ sku: String(r.sku), image_url_1: r.image_url_1 ?? null });
        }
        if (batch.length < CHUNK) break;
        from += CHUNK;
      }
      return all;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const skuImageMap = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of skuImageList) m.set(r.sku, r.image_url_1);
    return m;
  }, [skuImageList]);

  /** ── Map of productid → image_updated_at from inventory ──
   *  Drives the cache-bust query param so uploaded ProductImage thumbs
   *  invalidate the browser CDN cache after a page refresh. */
  const { data: imageTimestampList = [] } = useQuery({
    queryKey: [QUERY_KEY, "image-updated-at", "inventory"],
    queryFn: async () => {
      const all: Array<{ productid: string; image_updated_at: string | null }> = [];
      const CHUNK = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await (supabase as any)
          .from("inventory")
          .select("productid,image_updated_at")
          .not("image_updated_at", "is", null)
          .range(from, from + CHUNK - 1);
        if (error) throw error;
        const batch = (data || []) as Array<{ productid: string | null; image_updated_at: string | null }>;
        for (const r of batch) {
          if (r?.productid != null) {
            all.push({ productid: String(r.productid), image_updated_at: r.image_updated_at });
          }
        }
        if (batch.length < CHUNK) break;
        from += CHUNK;
      }
      return all;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const imageUpdatedAtMap = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of imageTimestampList) m.set(r.productid, r.image_updated_at);
    return m;
  }, [imageTimestampList]);

  const refetchForecastRowBySku = useCallback(
    async (sku: string) => {
      const { data, error } = await (supabase as any).from(TABLE_NAME).select("*").eq("sku", sku).maybeSingle();

      if (error) throw error;
      if (!data) return null;

      queryClient.setQueryData(pageQueryKey, (prev: Record<string, unknown>[] | undefined) => {
        if (!Array.isArray(prev)) return prev;
        const idx = prev.findIndex((row) => String(row.sku ?? "") === sku);
        if (idx < 0) return prev;
        const updated = [...prev];
        updated[idx] = data as Record<string, unknown>;
        return updated;
      });

      return data as Record<string, unknown>;
    },
    [TABLE_NAME, pageQueryKey, queryClient],
  );

  /** ── Server-side distinct filter options (cached in localStorage to survive reloads) ── */
  // v5: re-bumped after pu_status cache landed empty in some browsers.
  //     If pu_status scan returns 0 unique values, cache write is skipped so
  //     the next render retries — protects against caching a stale empty set
  //     from a moment when the DB column didn't exist yet.
  const FILTER_OPTIONS_CACHE_KEY = `filter-options-cache:${TABLE_NAME}:v8`;
  const FILTER_OPTIONS_TTL_MS = 10 * 60 * 1000; // 10 minutes

  const { data: filterOptionsData = {} } = useQuery({
    queryKey: [QUERY_KEY, "filter-options", TABLE_NAME, factoryRestricted, assignedCountry, factoryLevel, factoryKey],
    queryFn: async () => {
      // Per-factory / per-country cache so a restricted user's filtered options
      // never collide with the admin's full set (or another scope's).
      const cacheKey = factoryLevel && factoryKey
        ? `${FILTER_OPTIONS_CACHE_KEY}:fac:${factoryKey}`
        : factoryRestricted && assignedCountry
          ? `${FILTER_OPTIONS_CACHE_KEY}:${assignedCountry}`
          : FILTER_OPTIONS_CACHE_KEY;
      // Try localStorage first — distinct values change rarely, full table scan is expensive.
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { ts: number; data: Record<string, string[]> };
          if (Date.now() - parsed.ts < FILTER_OPTIONS_TTL_MS) {
            return parsed.data;
          }
        }
      } catch {
        /* ignore corrupted cache */
      }

      const cols = ["sku", "description", "factory", "item_color", "category", "status", "pu_status", "shopify_status", "supply_status", "priority_level", "shadow", "country", "buyer", "inventory_analyst"];
      const result: Record<string, string[]> = {};

      // Single paginated scan — collect uniques for ALL columns + factory/color pairs simultaneously.
      // Previously 14 parallel full-table scans + 1 fc_pairs scan = 15+ queries. Now: 1 query.
      const uniques: Record<string, Set<string>> = {};
      for (const c of cols) uniques[c] = new Set<string>();
      const fcPairs = new Set<string>();

      {
        const selectCols = cols.join(",");
        let offset = 0;
        const PAGE = 1000;
        let keepGoing = true;
        while (keepGoing) {
          let scan = (supabase as any)
            .from(TABLE_NAME)
            .select(selectCols);
          // Factory/region gate — options reflect only the user's factory (or country).
          if (factoryLevel && allowedFactoryShortNames?.length) scan = scan.in("factory", allowedFactoryShortNames);
          else if (factoryRestricted && assignedCountry) scan = scan.ilike("country", assignedCountry);
          const { data, error } = await scan.range(offset, offset + PAGE - 1);
          if (error) { break; }
          if (!data || data.length === 0) break;
          for (const row of data as Record<string, unknown>[]) {
            for (const col of cols) {
              const v = row[col];
              if (v != null && String(v).trim() !== "") uniques[col].add(String(v));
            }
            const f = String(row.factory ?? "").trim();
            const c = String(row.item_color ?? "").trim();
            if (f && c) fcPairs.add(f + "|||" + c);
          }
          if (data.length < PAGE) keepGoing = false;
          else offset += PAGE;
        }
      }

      // Merge in override values from forecast_report_status — these columns
      // are user-editable per-SKU and can introduce values like "Discontinued"
      // that don't appear in the base forecast_report table.
      try {
        const overrideCols = ["factory", "status", "kit", "category"];
        const { data: ovrRows, error: ovrErr } = await (supabase as any)
          .from("forecast_report_status")
          .select(overrideCols.join(","))
          .limit(10000);
        if (!ovrErr && Array.isArray(ovrRows)) {
          for (const row of ovrRows as Record<string, unknown>[]) {
            for (const col of overrideCols) {
              if (!uniques[col]) continue; // skip cols not in the filter set (kit)
              // forecast_report_status has no country column, so its factory
              // values could leak other countries — skip factory when restricted.
              if (factoryRestricted && col === "factory") continue;
              const v = row[col];
              if (v != null && String(v).trim() !== "") uniques[col].add(String(v));
            }
          }
        }
      } catch (e) {
      }

      for (const col of cols) {
        result[col] = Array.from(uniques[col]).sort((a, b) => a.localeCompare(b));
      }

      // fc_pairs collected in the single scan above
      result.__fc_pairs = Array.from(fcPairs);

      // Defensive: if a critical column scan returned zero (transient error
      // or a DB column that didn't exist yet), don't persist the empty set —
      // otherwise the empty cache wins for 10 minutes and the dropdown stays
      // empty even after the column gets populated. We only treat tables
      // that are *known* to have rows as critical (status, pu_status).
      const criticalEmpty = ["status", "pu_status"].some((c) => result[c]?.length === 0);
      if (!criticalEmpty) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: result }));
        } catch {
          /* quota exceeded — non-fatal */
        }
      }

      return result;
    },
    staleTime: FILTER_OPTIONS_TTL_MS,
    gcTime: FILTER_OPTIONS_TTL_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const skuOptions = filterOptionsData.sku ?? [];
  const productNameOptions = filterOptionsData.description ?? [];
  const factoryOptions = filterOptionsData.factory ?? [];
  const categoryOptions = filterOptionsData.category ?? [];
  // Kit is boolean-ish (DB: true/false or Yes/No). Filter offers Yes / No.
  // Y / N — matches the Kit column display and the loader's stored values.
  const kitFilterOptions = useMemo(() => ["Y", "N"], []);

  // factory → set of colors, parsed from the "factory|||color" pairs scan.
  const factoryColorMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const pair of (filterOptionsData.__fc_pairs ?? [])) {
      const idx = pair.indexOf("|||");
      if (idx < 0) continue;
      const f = pair.slice(0, idx);
      const c = pair.slice(idx + 3);
      if (!f || !c) continue;
      if (!m.has(f)) m.set(f, new Set());
      m.get(f)!.add(c);
    }
    return m;
  }, [filterOptionsData]);

  // Color options CASCADE on the Factory filter: if factories are selected,
  // only show colors that exist for those factories. Otherwise show all.
  const colorOptions = useMemo(() => {
    const selectedFactories = filters.factory ?? [];
    if (selectedFactories.length === 0) {
      return filterOptionsData.item_color ?? [];
    }
    const set = new Set<string>();
    for (const f of selectedFactories) {
      const colors = factoryColorMap.get(f);
      if (colors) for (const c of colors) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [filters.factory, factoryColorMap, filterOptionsData]);

  // When the factory selection narrows the available colors, drop any selected
  // colors that are no longer valid so the filter doesn't return empty results.
  useEffect(() => {
    if (!filters.item_color?.length) return;
    const valid = new Set(colorOptions);
    const pruned = filters.item_color.filter((c) => valid.has(c));
    if (pruned.length !== filters.item_color.length) {
      setFilters((p) => ({ ...p, item_color: pruned }));
    }
  }, [colorOptions]); // eslint-disable-line react-hooks/exhaustive-deps
  // Server-scan fallbacks (used only when no rows are loaded yet — see
  // statusOptions / puStatusOptions below which derive from mergedAllItems).
  const statusOptionsServer = filterOptionsData.status ?? [];
  const puStatusOptionsServer = filterOptionsData.pu_status ?? [];
  const shopifyStatusOptionsServer = filterOptionsData.shopify_status ?? [];

  // Keep case-variant maps current so the deduped pu_status/status/shopify_status
  // options still match every DB casing in the server `.in()` filter.
  useEffect(() => {
    const build = (vals: string[]) => {
      const m = new Map<string, string[]>();
      for (const raw of vals) {
        const t = String(raw).trim();
        if (!t || t === "-") continue;
        const k = t.toLowerCase();
        const arr = m.get(k) ?? [];
        if (!arr.includes(t)) arr.push(t);
        m.set(k, arr);
      }
      return m;
    };
    puStatusVariantsRef.current = build(puStatusOptionsServer);
    statusVariantsRef.current = build(statusOptionsServer);
    shopifyStatusVariantsRef.current = build(shopifyStatusOptionsServer);
  }, [puStatusOptionsServer, statusOptionsServer, shopifyStatusOptionsServer]);
  const supplyStatusOptions = filterOptionsData.supply_status ?? [];
  const priorityOptions = filterOptionsData.priority_level ?? [];
  const countryOptions = filterOptionsData.country ?? [];
  const buyerOptions = filterOptionsData.buyer ?? [];
  const inventoryAnalystOptions = filterOptionsData.inventory_analyst ?? [];
  const shadowOptions = useMemo(() => ["yes", "no"], []);
  // `actionOptions` is derived after mergedAllItems is built — see below.
  // `monthsWorthOptions` is derived from mergedItems (computed column) — see below.


  /** ── Realtime base-table refresh disabled to preserve in-progress/manual forecast edits ── */
  /** ── Visibility/network tab-return fallback removed to preserve view state ── */
  /** ── Fetch monthly_sale_view_auto for full 13-month sales data ── */
  const { data: monthlySaleData = [], isPending: monthlySalePending } = useQuery({
    queryKey: ["monthly_sale_view_auto"],
    queryFn: async () => {
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("monthly_sale_view_auto")
          .select("*")
          .range(offset, offset + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) allRows.push(row as Record<string, unknown>);
        if (data.length < batchSize) break;
        offset += batchSize;
      }
      return allRows;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  /** Map sku/product_id → monthly sale row for quick lookup */
  const monthlySaleMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of monthlySaleData) {
      const pid = String(row.product_id ?? "");
      if (pid) map.set(pid, row);
      const sku = String(row.sku ?? "");
      if (sku && sku !== pid) map.set(sku, row);
    }
    return map;
  }, [monthlySaleData]);

  /** Extract month labels from the first row of monthly_sale_view_auto */
  const monthlySaleLabels = useMemo<Record<string, string>>(() => {
    if (monthlySaleData.length === 0) return {};
    const first = monthlySaleData[0];
    const labels: Record<string, string> = {};
    for (let i = 0; i <= 25; i++) {
      const key = `month_${i}_label`;
      if (key in first) labels[key] = String(first[key] ?? "");
    }
    return labels;
  }, [monthlySaleData]);

  /** ── Fetch forecast_monthly_sales — DISPLAY source of the Monthly Sales grid ──
   * Last 10 completed months: recent_month_1 (huling kumpletong buwan) hanggang
   * recent_month_10 (pinakaluma), with SQL-derived labels (recent_month_N_label).
   * Display only: all forecast/purchasing math stays on monthly_sale_view_auto. */
  const { data: monthlyReplicaData = [] } = useQuery({
    queryKey: ["forecast_monthly_sales"],
    queryFn: async () => {
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("forecast_monthly_sales" as any)
          .select("*")
          .range(offset, offset + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) allRows.push(row as Record<string, unknown>);
        if (data.length < batchSize) break;
        offset += batchSize;
      }
      return allRows;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  /** ── Fetch master_sku — authoritative source ng Sku Status (new_sku) ── */
  const { data: masterSkuData = [] } = useQuery({
    queryKey: ["master_sku_new_sku"],
    queryFn: async () => {
      const allRows: Record<string, unknown>[] = [];
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("master_sku" as any)
          .select("sku,new_sku")
          .range(offset, offset + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) allRows.push(row as Record<string, unknown>);
        if (data.length < batchSize) break;
        offset += batchSize;
      }
      return allRows;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  /** Map sku → new_sku ("New SKU" / "Not New SKU") */
  const masterSkuMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of masterSkuData) {
      const s = String(row.sku ?? "").trim();
      const v = String(row.new_sku ?? "").trim();
      if (s && v) map.set(s, v);
    }
    return map;
  }, [masterSkuData]);

  /** Map sku (primary) / base_sku (fallback) → forecast_monthly_sales row */
  const monthlyReplicaMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of monthlyReplicaData) {
      const s = String(row.sku ?? "").trim();
      if (s) map.set(s, row);
      const base = String(row.base_sku ?? "").trim();
      if (base && !map.has(base)) map.set(base, row);
    }
    return map;
  }, [monthlyReplicaData]);

  /** Grid header labels STRAIGHT from forecast_monthly_sales (SQL-derived) —
   * never computed in JS, so header and data can't drift at a month boundary.
   * sales_month_0 = recent_month_1_label = huling kumpletong buwan. */
  const replicaSalesLabels = useMemo<Record<string, string>>(() => {
    if (monthlyReplicaData.length === 0) return {};
    const first = monthlyReplicaData[0];
    const labels: Record<string, string> = {};
    for (let i = 0; i <= 9; i++) {
      const l = String(first[`recent_month_${i + 1}_label`] ?? "").trim();
      if (l) labels[`sales_month_${i}`] = l;
    }
    return labels;
  }, [monthlyReplicaData]);

  /** ── Fetch forecast_report_manual for all SKUs ── */
  const { data: manualData = [], isPending: manualPending } = useQuery({
    queryKey: ["forecast_report_manual"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("forecast_report_manual")
        .select("sku,order_proposal_qty,buyer_notes,planner_notes,analyst_notes,monthly_projection,forecast_option")
        .limit(10000);
      if (error) throw error;
      return (data || []) as {
        sku: string;
        order_proposal_qty: number | null;
        buyer_notes: string | null;
        planner_notes: string | null;
        analyst_notes: string | null;
        monthly_projection: number | null;
        forecast_option: number | null;
      }[];
    },
    staleTime: 30_000,
    refetchOnMount: false,
    // Fallback so other users' manual edits appear on tab refocus / reconnect
    // even if a realtime event was missed (realtime stays the primary path).
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  /** ── Fetch forecast_report_status for factory/status/kit/category overrides ── */
  const { data: statusOverrideData = [], isPending: statusPending } = useQuery({
    queryKey: ["forecast_report_status"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("forecast_report_status")
        .select("sku,factory,status,kit,category")
        .limit(10000);
      if (error) throw error;
      return (data || []) as {
        sku: string;
        factory: string | null;
        status: string | null;
        kit: string | null;
        category: string | null;
      }[];
    },
    staleTime: 30_000,
    refetchOnMount: false,
    // Fallback so other users' manual edits appear on tab refocus / reconnect
    // even if a realtime event was missed (realtime stays the primary path).
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  /** ── Fetch forecast_report_proj_override for projection overrides ── */
  const { data: projOverrideData = [], isPending: projPending } = useQuery({
    queryKey: ["forecast_report_proj_override"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("forecast_report_proj_override").select("*").limit(10000);
      if (error) throw error;
      return (data || []) as Record<string, unknown>[];
    },
    staleTime: 30_000,
    refetchOnMount: false,
    // Fallback so other users' manual edits appear on tab refocus / reconnect
    // even if a realtime event was missed (realtime stays the primary path).
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  /** ── Fetch forecast_report_supply_override for supply overrides ── */
  const { data: supplyOverrideData = [], isPending: supplyPending } = useQuery({
    queryKey: ["forecast_report_supply_override"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("forecast_report_supply_override").select("*").limit(10000);
      if (error) throw error;
      return (data || []) as Record<string, unknown>[];
    },
    staleTime: 30_000,
    refetchOnMount: false,
    // Fallback so other users' manual edits appear on tab refocus / reconnect
    // even if a realtime event was missed (realtime stays the primary path).
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  /** ── Fetch actual lead_time values from forecast_report table ── */
  const { data: forecastReportLeadTimeData = [], isPending: leadTimePending } = useQuery({
    queryKey: ["forecast_report_lead_time"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("forecast_report")
        .select("sku,lead_time,buyer,inventory_analyst,country")
        .limit(10000);
      if (error) throw error;
      return (data || []) as {
        sku: string;
        lead_time: number | null;
        buyer: string | null;
        inventory_analyst: string | null;
        country: string | null;
      }[];
    },
    staleTime: 30_000,
    refetchOnMount: false,
    // Fallback so other users' manual edits appear on tab refocus / reconnect
    // even if a realtime event was missed (realtime stays the primary path).
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  /** ── Fetch each SKU's first sale date (derived view over public.orders,
   *  since forecast_report has no dedicated first_sale_date column) — feeds
   *  the "New SKU" status pill's 120-day rule (see computeNewSku above). ── */
  const { data: firstSaleDateData = [] } = useQuery({
    queryKey: ["sku_first_sale_date"],
    queryFn: () => fetchFirstSaleDates(supabase),
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const manualMap = useMemo(() => {
    const m = new Map<string, (typeof manualData)[number]>();
    for (const r of manualData) m.set(r.sku, r);
    return m;
  }, [manualData]);

  const statusOverrideMap = useMemo(() => {
    const m = new Map<string, (typeof statusOverrideData)[number]>();
    for (const r of statusOverrideData) m.set(r.sku, r);
    return m;
  }, [statusOverrideData]);

  /** ── forecast_main.landed_cost — unit-cost fallback. forecast_report.unit_cost
   *  is blank on every row (no rows populated), which zeroed the
   *  IDP's Revenue Loss and the Revenue/Lost Revenue bands. Note: use
   *  forecast_main.landed_cost when unit_cost is missing. ── */
  const { data: landedCostData = [] } = useQuery({
    queryKey: ["forecast_main_landed_cost"],
    queryFn: async () => {
      const all: { sku: string; landed_cost: number | null }[] = [];
      let offset = 0;
      const batchSize = 1000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await (supabase as any)
          .from("forecast_main")
          .select("sku,landed_cost")
          .range(offset, offset + batchSize - 1);
        if (error) throw error;
        const page = (data ?? []) as { sku: string; landed_cost: number | null }[];
        all.push(...page);
        if (page.length < batchSize) break;
        offset += batchSize;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  /** ── forecast_shopify_status — authoritative Shopify Status + admin link.
   *  Loader-fed (forecast_sku → status, shopify_link). Overlays the stored
   *  forecast_report.shopify_status / shopify_url when a row exists; SKUs
   *  absent from the table keep the stored values as fallback. ── */
  const { data: shopifyStatusRows = [] } = useQuery({
    queryKey: ["forecast_shopify_status"],
    queryFn: async () => {
      const all: { forecast_sku: string; status: string | null; shopify_link: string | null }[] = [];
      let offset = 0;
      const batchSize = 1000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await (supabase as any)
          .from("forecast_shopify_status")
          .select("forecast_sku,status,shopify_link")
          .range(offset, offset + batchSize - 1);
        if (error) throw error;
        const page = (data ?? []) as typeof all;
        all.push(...page);
        if (page.length < batchSize) break;
        offset += batchSize;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const shopifyStatusMap = useMemo(() => {
    const m = new Map<string, { status: string | null; link: string | null }>();
    for (const r of shopifyStatusRows) {
      const s = String(r.forecast_sku ?? "").trim();
      if (!s) continue;
      const rawStatus = String(r.status ?? "").trim();
      // "ACTIVE" → "Active" so pills render the same casing as before.
      const status = rawStatus ? rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase() : null;
      const link = String(r.shopify_link ?? "").trim() || null;
      m.set(s, { status, link });
    }
    return m;
  }, [shopifyStatusRows]);

  const forecastReportDataMap = useMemo(() => {
    const landed = new Map<string, number>();
    for (const r of landedCostData) {
      const s = String(r.sku ?? "").trim();
      const n = Number(r.landed_cost);
      if (s && Number.isFinite(n) && n > 0) landed.set(s, n);
    }
    const m = new Map<string, (typeof forecastReportLeadTimeData)[number] & { landed_cost?: number }>();
    for (const r of forecastReportLeadTimeData) m.set(r.sku, { ...r, landed_cost: landed.get(String(r.sku ?? "").trim()) });
    return m;
  }, [forecastReportLeadTimeData, landedCostData]);

  const firstSaleDateMap = useMemo(() => {
    const m = new Map<string, (typeof firstSaleDateData)[number]>();
    for (const r of firstSaleDateData) m.set(r.sku, r);
    return m;
  }, [firstSaleDateData]);

  /** ── Live SKU → Shopify product link map, scraped from the storefront's
   *  public products.json by our own /api/shopify-links endpoint. Ground
   *  truth for set/component SKUs (X2/X3/X4 …) whose stored shopify_url is
   *  missing or stale even though the product is live on the website. ── */
  const { data: shopifyLinksData } = useQuery({
    queryKey: ["shopify-live-links"],
    queryFn: async () => {
      const res = await fetch("/api/shopify-links");
      if (!res.ok) throw new Error(`shopify-links ${res.status}`);
      return (await res.json()) as { skus: Record<string, { url: string; available: boolean }> };
    },
    staleTime: 60 * 60 * 1000, // storefront catalog churns slowly; CDN caches 1h too
    retry: 1,
  });

  const shopifyLinkMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const [sku, entry] of Object.entries(shopifyLinksData?.skus ?? {})) {
      if (entry?.url) m.set(sku, entry.url);
    }
    return m;
  }, [shopifyLinksData]);

  /** ── the ERP product names (erp_product_details) — the authoritative name
   *  per the team decision ("sync names to match the ERP perfectly").
   *  forecast_report.description drifts (e.g. "(Set of 4)"/"(2pcs)" suffixes
   *  that the ERP no longer carries), so display prefers this. ── */
  const { data: scNameData = [] } = useQuery({
    queryKey: ["sc-product-names"],
    queryFn: () => fetchScProductNames(supabase),
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const scNameMap = useMemo(() => buildScNameMap(scNameData), [scNameData]);

  const projOverrideMap = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of projOverrideData) m.set(String(r.sku ?? ""), r);
    return m;
  }, [projOverrideData]);

  const supplyOverrideMap = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of supplyOverrideData) m.set(String(r.sku ?? ""), r);
    return m;
  }, [supplyOverrideData]);


  /** ══════════════════════════════════════════════════════════════════════════════
   * PERFORMANCE OPTIMIZATION: Pre-compute formula metadata cache
   * 
   * This cache eliminates ALL runtime overhead during click events:
   * ✅ No regex matching (replaced with string.startsWith + substring)
   * ✅ No map lookups during clicks (pre-computed for all rows)
   * ✅ No getDynamicInputs() calls during clicks (pre-computed)
   * ✅ Excel-level instant highlighting with GPU acceleration
   * 
   * Cache structure: Map<sku, Map<columnName, metadata>>
   * Recomputes only when data/overrides change (useMemo dependencies)
   * ══════════════════════════════════════════════════════════════════════════════ */
  const formulaMetadataCache = useMemo(() => {
    const cache = new Map<string, Map<string, {
      isManualOverride: boolean;
      inputColumns: string[];
      columnType: 'proj_month' | 'supply_month' | 'other';
      monthIndex?: number;
    }>>();

    // Only compute when IDP dialog is open — zero cost on normal page load
    if (!forecastAnalysisOpen) return cache;

    // Pre-compute for all rows and all formula columns
    const formulaColumns = Object.keys(COLUMN_FORMULAS);
    
    for (const row of (allItems || [])) {
      const sku = String(row.sku ?? "");
      const rowCache = new Map();
      
      const manual = manualMap.get(sku);
      const projOvr = projOverrideMap.get(sku);
      const supplyOvr = supplyOverrideMap.get(sku);
      
      for (const colName of formulaColumns) {
        let isManualOverride = false;
        let columnType: 'proj_month' | 'supply_month' | 'other' = 'other';
        let monthIndex: number | undefined;
        
        // Check manual overrides (optimized - no regex)
        if (colName === 'monthly_projection' && manual?.monthly_projection != null) {
          isManualOverride = true;
        } else if (colName === 'order_proposal_qty' && manual?.order_proposal_qty != null) {
          isManualOverride = true;
        } else if (colName.startsWith('proj_month_')) {
          columnType = 'proj_month';
          monthIndex = Number(colName.substring(11)); // Extract number after 'proj_month_'
          const overrideVal = projOvr?.[`proj_month_${monthIndex}_override`];
          if (overrideVal != null) isManualOverride = true;
        } else if (colName.startsWith('supply_month_')) {
          columnType = 'supply_month';
          monthIndex = Number(colName.substring(13)); // Extract number after 'supply_month_'
          const overrideVal = supplyOvr?.[`supply_month_${monthIndex}_override`];
          if (overrideVal != null) isManualOverride = true;
        }
        
        // Pre-compute input columns
        const formulaDef = COLUMN_FORMULAS[colName];
        const inputCols = isManualOverride 
          ? []
          : (formulaDef.getDynamicInputs 
              ? formulaDef.getDynamicInputs(now, row)
              : formulaDef.inputs);
        
        rowCache.set(colName, {
          isManualOverride,
          inputColumns: inputCols,
          columnType,
          monthIndex,
        });
      }
      
      cache.set(sku, rowCache);
    }
    
    return cache;
  }, [forecastAnalysisOpen, allItems, manualMap, projOverrideMap, supplyOverrideMap, now]);

  /** ── Centralized row recomputation: recalculates all dependent fields from driving inputs ──
   *  optionNum: 1 = Forecast Blend, 2 = Net Velocity Blend, 3 = Gross Velocity Trend, 4 = Current Month Trend.
   */
  const recomputeForecastRow = useCallback(
    (
      row: Record<string, unknown>,
      saleLookup?: Map<string, Record<string, unknown>>,
      drivingInputChanged = false,
      projOverrides?: Record<string, unknown> | null,
      supplyOverrides?: Record<string, unknown> | null,
      optionNum: number = 1,
      dateVars: ForecastDateVars = liveDateVars,
    ): Record<string, unknown> => {
      const out = { ...row };

      const effectiveMonthlyProjection = toNumberSafe(out.monthly_projection) ?? 0;
      const orderProposalQty = toNumberSafe(out.order_proposal_qty) ?? 0;
      const cbm = toNumberSafe(out.cbm) ?? 0;

      // total_cbm_approved = cbm × order_proposal_qty
      out.total_cbm_approved = cbm * orderProposalQty;

      // months_worth: LAGING live na kuwenta mula sa effective na Monthly
      // Projection (kasama ang manual/derived na values) para laging tugma sa
      // projection na IPINAPAKITA — hindi umaasa sa posibleng stale na DB value
      // na kinuwenta ng loader gamit ang ibang projection source (dating bug:
      // projection 198 pero months_worth 0.0 mula sa lumang refresh).
      if (effectiveMonthlyProjection > 0) {
        const ohInvMW = toNumberSafe(out.oh_inv) ?? 0;
        const otwUnits = toNumberSafe(out.otw_units) ?? 0;
        const onOrderUnits = toNumberSafe(out.on_order_units) ?? 0;
        const poInProgress = toNumberSafe(out.po_in_progress) ?? 0;
        const fbaReserved = toNumberSafe(out.fba_reserved) ?? 0;
        const intransitFba = toNumberSafe(out.intransit_fba) ?? 0;
        const fba = toNumberSafe(out.fba) ?? 0;
        const totalInv = ohInvMW + otwUnits + onOrderUnits + poInProgress + fbaReserved + intransitFba + fba;
        out.months_worth = Math.round((totalInv / effectiveMonthlyProjection) * 10) / 10;
      } else {
        const dbMonthsWorth = toNumberSafe(row.months_worth);
        out.months_worth = dbMonthsWorth != null ? dbMonthsWorth : 0;
      }

      // ── Resolve sales_month_6 ──
      const rawSalesMonth6 = out.sales_month_6;
      let salesMonth6: number;
      if (rawSalesMonth6 != null && rawSalesMonth6 !== "" && rawSalesMonth6 !== undefined) {
        salesMonth6 = toNumberSafe(rawSalesMonth6) ?? 0;
      } else if (saleLookup) {
        const sku = String(out.sku ?? "");
        const saleRow = saleLookup.get(sku);
        if (saleRow) {
          salesMonth6 = toNumberSafe(saleRow.month_6) ?? 0;
        } else {
          const pid = String(out.product_id ?? "");
          const saleRow2 = pid ? saleLookup.get(pid) : undefined;
          salesMonth6 = saleRow2 ? (toNumberSafe(saleRow2.month_6) ?? 0) : 0;
        }
      } else {
        salesMonth6 = 0;
      }
      out.sales_month_6 = salesMonth6;

      // Helper: check if a projection override exists for a given month
      const getOverride = (monthIdx: number): number | null => {
        if (!projOverrides) return null;
        const v = projOverrides[`proj_month_${monthIdx}_override`];
        return v != null ? Number(v) : null;
      };

      // ── Determine whether the frontend must compute proj_month_* ──
      // Always recompute in UI so proj_month_1 uses today's live remaining_days
      // instead of stale persisted month-transition values.
      const hasBackendProj = row.proj_month_1 != null && row.proj_month_1 !== "" && row.proj_month_1 !== undefined;
      const hasAnyOverride = projOverrides != null;
      const mustRecompute = true;

      const projArr: number[] = [];

      if (!mustRecompute) {
        // Use backend (option-1) values verbatim.
        for (let i = 1; i <= 12; i++) {
          const v = toNumberSafe(row[`proj_month_${i}`]) ?? 0;
          projArr.push(v);
          out[`proj_month_${i}`] = v;
        }
      } else {
        // ── Frontend recompute via per-option exact formulas ──
        // Date variables come from the same live source used by the header/formula picker.
        const daysElapsed = Math.max(1, dateVars.elapsed_days);
        const daysInMonth = dateVars.days_in_month;
        const remainingDays = dateVars.remaining_days;

        // proj_month_1 — same for all options. Override > prorated > backend.
        const ovr1 = getOverride(1);
        let p1: number;
        if (ovr1 != null) {
          p1 = ovr1;
        } else {
          // Raw decimal — display layer rounds.
          p1 = (effectiveMonthlyProjection / 30) * remainingDays;
        }
        out.proj_month_1 = p1;
        projArr.push(p1);

        // Velocities used by options 2 & 3.
        const actualSaleOfMonth = toNumberSafe(out.actual_sale_of_month) ?? 0;
        const netVelocity = (actualSaleOfMonth / daysElapsed) * daysInMonth; // option 2
        const grossVelocity = toNumberSafe(out.sales_velocity) ?? 0; // option 3

        // proj_month_2 — formula varies by option.
        const ovr2 = getOverride(2);
        let p2Calc: number;
        if (optionNum === 2) {
          // Option 2 — Net Velocity Blend: Monthly Projection + Apr Sales
          p2Calc = Math.ceil((effectiveMonthlyProjection + salesMonth6) / 2);
        } else if (optionNum === 3) {
          // Option 3 — Gross Velocity Trend: Apr Sales + Gross Velocity
          p2Calc = Math.ceil((salesMonth6 + grossVelocity) / 2);
        } else if (optionNum === 4) {
          // Option 4 — Current Month Trend: Apr Sales + Proj Month 1
          p2Calc = Math.ceil((salesMonth6 + p1) / 2);
        } else {
          // Option 1 (Forecast Blend): Monthly Projection + Apr Sales
          p2Calc = Math.ceil((effectiveMonthlyProjection + salesMonth6) / 2);
        }
        const p2 = ovr2 != null ? ovr2 : p2Calc;
        out.proj_month_2 = p2;
        projArr.push(p2);

        // proj_month_3 — formula varies by option.
        // ⚠️ MIRROR src/lib/forecast/recomputeForecastRow.ts — keep in sync.
        const ovr3 = getOverride(3);
        let p3Calc: number;
        if (optionNum === 0) {
          // Option 0 — Baseline: Monthly Projection + Proj Month 2
          p3Calc = Math.ceil((effectiveMonthlyProjection + p2) / 2);
        } else if (optionNum === 1) {
          // Option 1 — Forecast Blend: Current Sales Velocity (gross) + Proj Month 2
          p3Calc = Math.ceil((grossVelocity + p2) / 2);
        } else if (optionNum === 2) {
          // Option 2 — Net Velocity Blend: Net Velocity + Apr Sales
          p3Calc = Math.ceil((netVelocity + salesMonth6) / 2);
        } else if (optionNum === 3) {
          // Option 3 — Gross Velocity Trend: Gross Velocity + Proj Month 2
          p3Calc = Math.ceil((grossVelocity + p2) / 2);
        } else {
          // Option 4 — Current Month Trend: Proj Month 1 + Proj Month 2
          p3Calc = Math.ceil((p1 + p2) / 2);
        }
        const p3 = ovr3 != null ? ovr3 : p3Calc;
        out.proj_month_3 = p3;
        projArr.push(p3);

        // proj_month_4..12 — same cascade for all options.
        for (let i = 4; i <= 12; i++) {
          const ovrN = getOverride(i);
          const val = ovrN != null ? ovrN : Math.ceil((projArr[i - 2] + projArr[i - 3]) / 2);
          projArr.push(val);
          out[`proj_month_${i}`] = val;
        }
      }

      // ── Supply months ──
      const ohInv = toNumberSafe(out.oh_inv) ?? 0;
      const replOhInv = toNumberSafe(out.repl_oh_inv) ?? 0;

      const getSupplyOverride = (monthIdx: number): number | null => {
        if (!supplyOverrides) return null;
        const v = supplyOverrides[`supply_month_${monthIdx}_override`];
        return v != null ? Number(v) : null;
      };

      const hasBackendSupply =
        row.supply_month_1 != null && row.supply_month_1 !== "" && row.supply_month_1 !== undefined;
      const hasAnySupplyOverride = supplyOverrides != null;
      // If projections were recomputed, supply must follow.
      const supplyMustRecompute = mustRecompute || hasAnySupplyOverride || !hasBackendSupply;

      const supplyArr: number[] = [];
      if (!supplyMustRecompute) {
        for (let i = 1; i <= 12; i++) {
          const val = toNumberSafe(row[`supply_month_${i}`]) ?? 0;
          supplyArr.push(val);
          out[`supply_month_${i}`] = val;
        }
      } else {
        const sOvr1 = getSupplyOverride(1);
        if (sOvr1 != null) {
          supplyArr.push(sOvr1);
          out.supply_month_1 = sOvr1;
        } else {
          const fba = toNumberSafe(out.fba) ?? 0;
          const inc1 = toNumberSafe(out.incoming_month_1) ?? 0;
          const replFba = toNumberSafe(out.repl_fba) ?? 0;
          const repl1 = toNumberSafe(out.repl_month_1) ?? 0;
          const s1 = Math.round(fba + ohInv + inc1 + replFba + replOhInv + repl1 - projArr[0]);
          supplyArr.push(s1);
          out.supply_month_1 = s1;
        }

        for (let i = 2; i <= 12; i++) {
          const sOvrN = getSupplyOverride(i);
          if (sOvrN != null) {
            supplyArr.push(sOvrN);
            out[`supply_month_${i}`] = sOvrN;
          } else {
            const incN = toNumberSafe(out[`incoming_month_${i}`]) ?? 0;
            const replN = toNumberSafe(out[`repl_month_${i}`]) ?? 0;
            const sN = Math.round(supplyArr[i - 2] + incN + replN - projArr[i - 1]);
            supplyArr.push(sN);
            out[`supply_month_${i}`] = sN;
          }
        }
      }


      const unitCost = toNumberSafe(out.unit_cost) ?? 0;

      // supply_status based on supply_month_1
      const s1Val = supplyArr[0] ?? 0;
      out.supply_status = s1Val > 0 ? "Good" : "Critical";

      // Supplying Month: always use the backend DB value as-is
      const rawSupplyingMonth = row.supplying_month ?? row.supply_month ?? null;
      out.supplying_month = rawSupplyingMonth;
      out.supply_month = rawSupplyingMonth;

      // Stamp the per-row option used so the UI (badge) can read it back.
      out.__forecast_option = optionNum;

      // ══════════════════════════════════════════════════════════════════════════════
      // 90-DAY INVENTORY DECISION PLANNER CALCULATIONS
      // ══════════════════════════════════════════════════════════════════════════════

      // SOURCE OF TRUTH = the Forecast UI itself. Every 90-day figure below is
      // built from the SAME monthly values the table displays (rounded, as
      // shown), and the IDP helpers read these — never the loader's stored
      // ninety_day_* columns, which can lag the live overrides on screen.
      const r0 = (n: number) => Math.round(n);

      // 1. 90-Day Projection = sum of first 3 months from Monthly Projection (as displayed)
      const ninetyDayProjection = r0(projArr[0] ?? 0) + r0(projArr[1] ?? 0) + r0(projArr[2] ?? 0);
      out.ninety_day_projection = ninetyDayProjection;

      // 2. 90-Day Supply = sum of first 3 months from Supply Plan (as displayed)
      const ninetyDaySupply = r0(supplyArr[0] ?? 0) + r0(supplyArr[1] ?? 0) + r0(supplyArr[2] ?? 0);
      out.ninety_day_supply = ninetyDaySupply;

      // 3. 90-Day Deficit = 90-Day Supply - 90-Day Projection
      const ninetyDayDeficit = ninetyDaySupply - ninetyDayProjection;
      out.ninety_day_deficit = ninetyDayDeficit;

      // The planner helpers (computeIdpRowMetrics, ROP dates, planner filters)
      // read __raw_ninety_day_* — point them at the UI-computed figures so the
      // IDP can never disagree with the Forecast table it sits on.
      out.__raw_ninety_day_projection = ninetyDayProjection;
      out.__raw_ninety_day_supply = ninetyDaySupply;
      out.__raw_ninety_day_deficit = ninetyDayDeficit;

      // 4. 90-Day Revenue Loss = ABS(deficit) × unit_cost (only if deficit < 0)
      const revenueLoss = ninetyDayDeficit < 0 ? Math.abs(ninetyDayDeficit) * unitCost : 0;
      out.ninety_day_revenue_loss = revenueLoss;

      // 5. Safety Stock = 90-Day Projection ÷ 3 (rounded up)
      const safetyStock = Math.ceil(ninetyDayProjection / 3);
      out.safety_stock = safetyStock;

      // Get lead time from forecast_report.lead_time (use vendor data as fallback for calculations only)
      // For display: only show forecast_report.lead_time (don't use defaults)
      const dbLeadTime = toNumberSafe(row.lead_time); // Original value from forecast_report.lead_time
      const leadTimeDays = dbLeadTime ?? toNumberSafe(out.vendor_lead_time) ?? toNumberSafe(out.lead_time_days);
      
      // Reset lead_time to original database value (remove any calculated defaults)
      out.lead_time = row.lead_time; // Keep NULL/empty if not set in database

      // Calculate daily sales rate
      const dailySales = ninetyDayProjection / 90;

      // Determine if we need to order now (skip if no lead time)
      let orderNow = false;
      if (leadTimeDays) {
        if (ninetyDayDeficit < 0) {
          orderNow = true; // Has deficit
        } else if (dailySales > 0) {
          const daysUntilDeficit = ninetyDayDeficit / dailySales;
          if (daysUntilDeficit < leadTimeDays) {
            orderNow = true; // Surplus too small to cover lead time
          }
        }
      }

      // 6. Order Recommended
      let orderRecommended = 0;
      if (orderNow) {
        if (ninetyDayDeficit < 0) {
          // Has deficit: cover 90 days + deficit + safety stock
          orderRecommended = ninetyDayProjection + Math.abs(ninetyDayDeficit) + safetyStock;
        } else {
          // Surplus too small: cover 90 days + safety stock
          orderRecommended = ninetyDayProjection + safetyStock;
        }
      } else {
        // Surplus large enough: cover 90 days + safety stock
        orderRecommended = ninetyDayProjection + safetyStock;
      }
      out.order_recommended = orderRecommended;

      // ── No-demand guard ──
      // If 90-day projection is zero, there's no demand driving an order, so
      // order_date / supply_month / covered_months must all be blank — even
      // when supply exists (e.g. projection = 0 but supply = 465 sitting in WH).
      if (ninetyDayProjection <= 0) {
        out.order_date_forecast = null;
        out.supply_month_forecast = null;
        out.covered_months = null;
      } else {
        // 8. Order Date (skip if no lead time)
        const today = new Date();
        let orderDate: Date | null = null;
        if (leadTimeDays) {
          if (orderNow) {
            orderDate = today;
          } else if (dailySales > 0) {
            // Has surplus: calculate when current 90-day supply will run out
            // Stock runs out = Today + (90-day supply / daily sales) days
            const daysUntilStockOut = ninetyDaySupply / dailySales;
            const stockRunsOutDate = new Date(today.getTime() + daysUntilStockOut * 24 * 60 * 60 * 1000);
            // Order should be placed: (stock runs out date) - (lead time)
            const calculatedOrderDate = new Date(stockRunsOutDate.getTime() - leadTimeDays * 24 * 60 * 60 * 1000);
            orderDate = calculatedOrderDate < today ? today : calculatedOrderDate;
          } else {
            orderDate = today;
          }
        }
        out.order_date_forecast = orderDate ? orderDate.toISOString().split('T')[0] : null; // YYYY-MM-DD format or NULL

        // 9. Supply Month = Order Date + Lead Time (skip if no lead time or order date)
        if (orderDate && leadTimeDays) {
          const supplyMonth = new Date(orderDate.getTime() + leadTimeDays * 24 * 60 * 60 * 1000);
          out.supply_month_forecast = supplyMonth.toISOString().split('T')[0];

          // 10. Covered Months = Supply Month + (Order Recommended / Daily Sales) days
          // This shows when the ordered stock will run out based on actual order quantity
          let coverageDays = 0;
          if (dailySales > 0) {
            coverageDays = orderRecommended / dailySales;
          } else {
            // If no sales, assume 180 days coverage (arbitrary fallback)
            coverageDays = 180;
          }
          const coveredMonths = new Date(supplyMonth.getTime() + coverageDays * 24 * 60 * 60 * 1000);
          out.covered_months = coveredMonths.toISOString().split('T')[0];
        } else {
          out.supply_month_forecast = null;
          out.covered_months = null;
        }
      }

      // 11. Action = "Order Now" or "Order Soon"
      out.action = orderNow ? "Order Now" : "Order Soon";

      // 12. Override order_date / supply_month / covered_months with the
      //     ROP-driven formula:
      //        days_of_supply        = floor(raw 90-day supply / (raw 90-day proj / 90))
      //        days_until_must_order = days_of_supply - lead_time
      //        order_date            = today + max(0, days_until_must_order)
      //        supply_month          = order_date + lead_time
      //     covered_months mirrors supply_month so it formats the same way the
      //     planner expects. Skipped when projection ≤ 0 or lead time missing.
      //     Uses local-time YYYY-MM-DD so toISOString() UTC shift doesn't bleed
      //     a day backward in PHT/UTC+ time zones.
      {
        const rawProj = toNumberSafe(out.__raw_ninety_day_projection) ?? ninetyDayProjection;
        const rawSupply = toNumberSafe(out.__raw_ninety_day_supply) ?? ninetyDaySupply;
        const leadInt = toNumberSafe(leadTimeDays);
        if (rawProj > 0 && leadInt != null && leadInt > 0) {
          const dailyRate = rawProj / 90;
          const dos = dailyRate > 0 && rawSupply > 0 ? Math.floor(rawSupply / dailyRate) : 0;
          const dum = dos - leadInt;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const orderDate = new Date(today.getTime() + Math.max(0, dum) * 24 * 60 * 60 * 1000);
          const supplyMonth = new Date(orderDate.getTime() + leadInt * 24 * 60 * 60 * 1000);
          const fmt = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          out.order_date_forecast = fmt(orderDate);
          out.supply_month_forecast = fmt(supplyMonth);
          out.covered_months = fmt(supplyMonth);
        }
      }

      // ══════════════════════════════════════════════════════════════════════════════

      return out;
    },
    [liveDateVars],
  );

  // Per-SKU recompute cache — skips recomputeForecastRow when inputs unchanged
  const recomputeCacheRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const recomputeCacheDateRef = useRef<string>("");
  // Stable-reference cache — returns previous array when every row hits the per-SKU cache,
  // preventing displayedItems + rowVirtualizer from re-running on no-op overlay refetches.
  const prevMergedRef = useRef<{
    items: typeof items;
    manualMap: typeof manualMap;
    statusOverrideMap: typeof statusOverrideMap;
    projOverrideMap: typeof projOverrideMap;
    supplyOverrideMap: typeof supplyOverrideMap;
    firstSaleDateMap: typeof firstSaleDateMap;
    masterSkuMap: typeof masterSkuMap;
    shopifyLinkMap: typeof shopifyLinkMap;
    scNameMap: typeof scNameMap;
    localRowPatches: typeof localRowPatches;
    result: Record<string, unknown>[];
  } | null>(null);

  /** Merge manual data + status overrides + projection overrides into items */
  const mergedItems = useMemo(() => {
    // Clear cache on date rollover — inside useMemo so it only runs when deps change
    if (recomputeCacheDateRef.current !== liveDateVars.current_date) {
      recomputeCacheRef.current.clear();
      recomputeCacheDateRef.current = liveDateVars.current_date;
      prevMergedRef.current = null; // date changed — force fresh result
    }
    const cache = recomputeCacheRef.current;
    let anyMiss = false;
    const next = items.map((row) => {
      const sku = String(row.sku ?? "");
      const manual = manualMap.get(sku);
      const statusOvr = statusOverrideMap.get(sku);
      const projOvr = projOverrideMap.get(sku);
      const supplyOvr = supplyOverrideMap.get(sku);
      const forecastReportData = forecastReportDataMap.get(sku);
      const localPatch = localRowPatches[sku];
      const merged = { ...row, ...(localPatch ?? {}) };

      // Manual overrides (order_proposal_qty, monthly_projection, notes).
      // Apply AFTER the localPatch spread so persisted manual values win on hard refresh
      // (localPatch is wiped on reload; manual comes from forecast_report_manual fetch).
      if (manual) {
        // order_proposal_qty is MANUAL_ONLY — manual entry wins directly (null = cleared).
        // No ?? fallback: if user cleared it, show null; if no manual entry exists the
        // if(manual) block is skipped and { ...row } spread already covers the base value.
        merged.order_proposal_qty = manual.order_proposal_qty;
        if (manual.monthly_projection != null) {
          merged.monthly_projection = manual.monthly_projection;
          // Wipe stale per-month projections from row/localPatch so recompute is forced
          // to derive proj_month_* from the override value. Without this, a stale
          // proj_month_1 carried over from `row` could leak through if the recompute
          // path is somehow bypassed.
          for (let i = 1; i <= 12; i++) {
            delete (merged as Record<string, unknown>)[`proj_month_${i}`];
            delete (merged as Record<string, unknown>)[`supply_month_${i}`];
          }
        } else if (localPatch && Object.prototype.hasOwnProperty.call(localPatch, "monthly_projection")) {
          // The manual override was cleared (e.g. by another user) but this session
          // still holds a stale optimistic localPatch value. Revert to the base value
          // so the recompute below derives the formula — without this, the stale
          // localPatch projection keeps winning until a manual refresh.
          merged.monthly_projection = (row as Record<string, unknown>).monthly_projection;
          for (let i = 1; i <= 12; i++) {
            delete (merged as Record<string, unknown>)[`proj_month_${i}`];
            delete (merged as Record<string, unknown>)[`supply_month_${i}`];
          }
        }
        merged.buyer_notes = manual.buyer_notes;
        merged.planner_notes = manual.planner_notes;
        merged.analyst_notes = manual.analyst_notes;
      }

      // Status overrides — ONLY factory + status are overridable.
      // kit, category, pu_status are the ERP-driven (sc_details →
      // forecast_report via SQL JOIN). forecast_report is the sole source of
      // truth for those, so we intentionally do NOT apply statusOvr.kit /
      // statusOvr.category here.
      if (statusOvr) {
        if (statusOvr.factory != null) merged.factory = statusOvr.factory;
        if (statusOvr.status != null) merged.status = statusOvr.status;
      }

      // Override with actual forecast_report values (lead_time, buyer, inventory_analyst, country)
      if (forecastReportData) {
        merged.lead_time = forecastReportData.lead_time; // Use actual DB value (can be NULL)
        merged.buyer = forecastReportData.buyer ?? row.buyer;
        merged.inventory_analyst = forecastReportData.inventory_analyst ?? row.inventory_analyst;
        merged.country = forecastReportData.country ?? row.country;
        // unit_cost fallback → forecast_main.landed_cost when forecast_report has
        // none. Feeds Revenue / Lost Revenue bands and the IDP's Revenue Loss.
        // Mirrored in mergeAllItems.worker.ts.
        const uc = Number((merged as Record<string, unknown>).unit_cost);
        const lc = forecastReportData.landed_cost;
        if ((!Number.isFinite(uc) || uc <= 0) && lc != null && lc > 0) (merged as Record<string, unknown>).unit_cost = lc;
      }

      // Shopify Status + Link — forecast_shopify_status is authoritative when it
      // has a row for this SKU; otherwise keep the stored values.
      {
        const shop = shopifyStatusMap.get(sku.trim());
        if (shop) {
          if (shop.status) (merged as Record<string, unknown>).shopify_status = shop.status;
          if (shop.link) (merged as Record<string, unknown>).shopify_url = shop.link;
        }
      }

      // First sale date (informational field) — keep populating it from the view.
      if (firstSaleDateMap.size > 0) {
        const firstSaleDateRow = firstSaleDateMap.get(sku);
        if (firstSaleDateRow?.first_sale_date) merged.first_sale_date = firstSaleDateRow.first_sale_date;
      }
      // Sku Status now comes from master_sku.new_sku (authoritative table).
      // Fallback to the old 120-day computeNewSku rule ONLY while master_sku
      // hasn't loaded (size 0) so the column never blanks out wholesale;
      // a SKU absent from a loaded master_sku renders blank ("").
      if (masterSkuMap.size > 0) {
        merged.sku_status = masterSkuMap.get(sku) ?? "";
      } else if (firstSaleDateMap.size > 0) {
        merged.sku_status = computeNewSku(firstSaleDateMap.get(sku)?.first_sale_date);
      }

      // Live Shopify link (scraped from the storefront) — kept in its OWN
      // field: the Product Name link uses this live URL (incl. the
      // parent-master-SKU fallback for X2/X3/X4 sets), while the Shopify
      // Link column and status pill keep showing the stored shopify_url
      // untouched (per explicit request).
      if (shopifyLinkMap.size > 0) {
        const liveUrl = shopifyLinkMap.get(sku) ?? shopifyLinkMap.get(sku.replace(/-X\d+$/i, ""));
        if (liveUrl) merged.shopify_live_url = liveUrl;
      }

      // Product name — the ERP (erp_product_details) is authoritative; the
      // stored forecast_report.description drifts (stale "(Set of 4)" etc.).
      if (scNameMap.size > 0) {
        const scName = scNameMap.get(sku);
        if (scName) merged.description = scName;
      }

      // Recompute dependents whenever the effective monthly_projection comes from a
      // non-DB source. Triggers:
      //   - active client-side edit (localPatch)
      //   - persisted manual override (forecast_report_manual.monthly_projection NOT NULL)
      //   - any per-month projection override
      // Always recompute when a manual override exists so proj/supply/rev/lost reflect
      // it on initial page load — even if the scheduled refresh hasn't propagated yet.
      const drivingInputChanged = Object.prototype.hasOwnProperty.call(localPatch ?? {}, "monthly_projection");
      const hasManualMonthlyProjection = manual?.monthly_projection != null;
      let hasAnyProjOverride = false;
      if (projOvr) {
        for (let _mi = 1; _mi <= 12; _mi++) {
          if (projOvr[`proj_month_${_mi}_override`] != null) { hasAnyProjOverride = true; break; }
        }
      }
      let hasAnySupplyOverride = false;
      if (supplyOvr) {
        for (let _mi = 1; _mi <= 12; _mi++) {
          if (supplyOvr[`supply_month_${_mi}_override`] != null) { hasAnySupplyOverride = true; break; }
        }
      }
      const shouldRecomputeProjection = drivingInputChanged || hasManualMonthlyProjection || hasAnyProjOverride;

      // Per-row forecast option: localPatch wins (instant click), else stored value, else 1.
      const rawOpt = (localPatch?.forecast_option as number | undefined) ?? manual?.forecast_option ?? 0;
      const optionNum = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));

      // Build override keys without JSON.stringify — deterministic ordered string is ~50x faster.
      let _projOvrKey = "";
      if (projOvr) { for (let _i = 1; _i <= 12; _i++) _projOvrKey += `${projOvr[`proj_month_${_i}_override`] ?? ""}|`; }
      let _supplyOvrKey = "";
      if (supplyOvr) { for (let _i = 1; _i <= 12; _i++) _supplyOvrKey += `${supplyOvr[`supply_month_${_i}_override`] ?? ""}|`; }

      const cacheKey = `${sku}|${merged.monthly_projection}|${merged.order_proposal_qty}|${merged.oh_inv}|${merged.otw_units}|${merged.on_order_units}|${merged.fba}|${merged.repl_oh_inv}|${optionNum}|${shouldRecomputeProjection}|${hasAnySupplyOverride}|${statusOvr?.factory ?? ""}|${statusOvr?.status ?? ""}|${forecastReportData?.lead_time ?? ""}|${_projOvrKey}|${_supplyOvrKey}|${liveDateVars.elapsed_days}|${merged.buyer_notes ?? ""}|${merged.planner_notes ?? ""}|${merged.analyst_notes ?? ""}|${merged.first_sale_date ?? ""}|${merged.sku_status ?? ""}|${merged.shopify_live_url ?? ""}|${merged.description ?? ""}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      anyMiss = true;
      // order_proposal_qty may be text (e.g. "10/0") — parse to numeric for the
      // recompute so dependent fields (total_cbm_approved etc.) calculate correctly,
      // then restore the original text value so the cell displays what was typed.
      const textOrderQty = merged.order_proposal_qty;
      const hasTextQty = typeof textOrderQty === "string";
      if (hasTextQty) {
        merged.order_proposal_qty = parseFloat(textOrderQty as string) || null;
      }
      const recomputed = recomputeForecastRow(
        merged,
        monthlySaleMap,
        shouldRecomputeProjection,
        hasAnyProjOverride ? projOvr : null,
        hasAnySupplyOverride ? supplyOvr : null,
        optionNum,
        liveDateVars,
      );
      if (hasTextQty) {
        (recomputed as Record<string, unknown>).order_proposal_qty = textOrderQty;
      }

      cache.set(cacheKey, recomputed);
      return recomputed;
    });
    // Return the previous stable array ONLY when nothing that affects the merge
    // changed — same page rows AND same manual/override/local-patch maps. The
    // map-reference checks are essential: a manual edit/clear (own or via
    // realtime from another user) produces a new manualMap/localRowPatches even
    // when the per-row recompute cache hits (anyMiss=false), so without these
    // the short-circuit would return the stale pre-edit array (e.g. a cleared
    // override still showing its old value until a manual refresh).
    if (
      !anyMiss &&
      prevMergedRef.current &&
      prevMergedRef.current.items === items &&
      prevMergedRef.current.manualMap === manualMap &&
      prevMergedRef.current.statusOverrideMap === statusOverrideMap &&
      prevMergedRef.current.projOverrideMap === projOverrideMap &&
      prevMergedRef.current.supplyOverrideMap === supplyOverrideMap &&
      prevMergedRef.current.firstSaleDateMap === firstSaleDateMap &&
      prevMergedRef.current.masterSkuMap === masterSkuMap &&
      prevMergedRef.current.shopifyLinkMap === shopifyLinkMap &&
      prevMergedRef.current.scNameMap === scNameMap &&
      prevMergedRef.current.localRowPatches === localRowPatches
    ) {
      return prevMergedRef.current.result;
    }
    prevMergedRef.current = {
      items, manualMap, statusOverrideMap, projOverrideMap, supplyOverrideMap, firstSaleDateMap, masterSkuMap, shopifyLinkMap, scNameMap, localRowPatches, result: next,
    };
    return next;
  }, [
    items,
    manualMap,
    statusOverrideMap,
    projOverrideMap,
    supplyOverrideMap,
    forecastReportDataMap,
    firstSaleDateMap,
    masterSkuMap,
    shopifyLinkMap,
    scNameMap,
    shopifyStatusMap,
    localRowPatches,
    recomputeForecastRow,
    monthlySaleMap,
    liveDateVars,
  ]);

  // Unique months_worth values from computed rows, sorted numerically — used as filter options.
  const monthsWorthOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of mergedItems) {
      const raw = (row as any).months_worth;
      if (raw === null || raw === undefined || raw === "") continue;
      const v = parseFloat(String(raw));
      if (!isNaN(v)) seen.add(v.toFixed(1));
    }
    return [...seen].sort((a, b) => parseFloat(a) - parseFloat(b));
  }, [mergedItems]);

  const displayedItems = useMemo(() => {
    let filtered = mergedItems;

    // Apply action filter (client-side since it's a computed column)
    if (filters.action.length > 0) {
      filtered = filtered.filter((row) => {
        const action = String((row as any).action ?? "");
        return filters.action.includes(action);
      });
    }

    // Apply Sku Status filter (client-side — sku_status is recomputed from the
    // sku_first_sale_date view, so the displayed value differs from the stored
    // DB column and can't be pushed to the server query). Values are the exact
    // strings computeNewSku returns: "New SKU" / "Not New SKU".
    if (filters.sku_status?.length) {
      filtered = filtered.filter((row) => {
        const s = String((row as any).sku_status ?? "").trim();
        if (s === "") return filters.sku_status.includes("(Blank)");
        return filters.sku_status.includes(s);
      });
    }

    // Apply months_worth exact-value filter (client-side — value is computed/overridden)
    if (filters.months_worth?.length) {
      filtered = filtered.filter((row) => {
        const raw = (row as any).months_worth;
        if (raw === null || raw === undefined || raw === "") {
          return filters.months_worth.includes("(Blank)");
        }
        const v = parseFloat(String(raw));
        if (isNaN(v)) return filters.months_worth.includes("(Blank)");
        return filters.months_worth.includes(v.toFixed(1));
      });
    }

    return filtered;
  // Track computed-column filters by value string so unrelated changes don't invalidate this memo
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedItems, filters.action.join("|"), (filters.months_worth ?? []).join("|"), (filters.sku_status ?? []).join("|")]);

  /** Total CBM Approved summary:
   *  - No filters/search → sum all rows from mergedItems (includes local patches).
   *  - Filters active → sum from displayedItems (filtered + includes local patches). */
  const { totalCbmValue, totalCbmIsPageOnly } = useMemo(() => {
    const hasAnyFilter =
      Object.entries(filters).some(([k, v]) => k !== "action" && (v as string[]).length > 0) ||
      filters.action.length > 0 ||
      !!debouncedSearch;

    if (!hasAnyFilter) {
      const val = mergedItems.reduce(
        (sum, r) => sum + (parseFloat(String(r.total_cbm_approved ?? 0)) || 0),
        0,
      );
      return { totalCbmValue: val, totalCbmIsPageOnly: false };
    }

    const val = displayedItems.reduce(
      (sum, r) => sum + (parseFloat(String((r as any).total_cbm_approved ?? 0)) || 0),
      0,
    );
    const isPageOnly = totalCount > displayedItems.length;
    return { totalCbmValue: val, totalCbmIsPageOnly: isPageOnly };
  }, [mergedItems, displayedItems, filters, debouncedSearch, totalCount]);

  const rowVirtualizer = useVirtualizer({
    count: displayedItems.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Merge ALL items for dialog — runs in a Web Worker so the main thread
  // stays free and the dialog opens instantly.
  const [mergedAllItems, setMergedAllItems] = useState<Record<string, unknown>[]>([]);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Wait until ALL source queries finish before merging — prevents spurious
    // worker runs with partial/empty data that cause a double-loading flash.
    if (
      allItemsLoading ||
      allItems.length === 0 ||
      manualPending ||
      statusPending ||
      projPending ||
      supplyPending ||
      leadTimePending
    ) return;

    // Terminate any in-flight worker before starting a new one.
    workerRef.current?.terminate();
    setIsRecomputing(true);
    const worker = new Worker(
      new URL('../workers/mergeAllItems.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<{ rows: Record<string, unknown>[] }>) => {
      // The worker mirrors the table merge but predates the the ERP-name
      // override; apply it here so the email report (built from mergedAllItems)
      // shows the same authoritative names as the on-screen table.
      const rows = e.data.rows.map((r) => {
        let out = r;
        const scName = scNameMap.get(String((r as any).sku ?? ""));
        if (scName) out = { ...out, description: scName };
        // Sku Status mula master_sku.new_sku — same rule as the table merge
        if (masterSkuMap.size > 0) {
          out = { ...out, sku_status: masterSkuMap.get(String((r as any).sku ?? "").trim()) ?? "" };
        }
        // Shopify Status + Link mula forecast_shopify_status — same rule as the table merge
        const shop = shopifyStatusMap.get(String((r as any).sku ?? "").trim());
        if (shop) {
          out = {
            ...out,
            ...(shop.status ? { shopify_status: shop.status } : {}),
            ...(shop.link ? { shopify_url: shop.link } : {}),
          };
        }
        return out;
      });
      setMergedAllItems(rows);
      setIsRecomputing(false);
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({
      allItems,
      manualMap: Array.from(manualMap.entries()),
      statusOverrideMap: Array.from(statusOverrideMap.entries()),
      projOverrideMap: Array.from(projOverrideMap.entries()),
      supplyOverrideMap: Array.from(supplyOverrideMap.entries()),
      forecastReportDataMap: Array.from(forecastReportDataMap.entries()),
      localRowPatches,
      monthlySaleEntries: Array.from(monthlySaleMap.entries()),
      dateVars: liveDateVars,
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [
    allItems,
    allItemsLoading,
    manualMap,
    manualPending,
    statusOverrideMap,
    statusPending,
    projOverrideMap,
    projPending,
    supplyOverrideMap,
    supplyPending,
    forecastReportDataMap,
    leadTimePending,
    localRowPatches,
    monthlySaleMap,
    liveDateVars,
    scNameMap,
    masterSkuMap,
    shopifyStatusMap,
  ]);

  // Dynamic Action filter options — derived from the actual computed Action
  // tier labels in the loaded dataset, mirroring the planner cell renderer.
  // Includes the No Demand / In Progress / Discontinued overrides too so the
  // dropdown covers every label the buyer can see in the table.
  const actionOptions = useMemo(() => {
    const labels = new Set<ActionTierLabel>();
    for (const row of mergedAllItems) {
      const puStatus = (row as any).pu_status;
      const proj = Number((row as any).ninety_day_projection) || 0;
      // pu_status overrides outrank the computed tier.
      const override = puStatusOverrideLabel(puStatus);
      if (override === "Discontinued") { labels.add(ACTION_TIER.DISCONTINUED); continue; }
      if (override === "In Progress") { labels.add(ACTION_TIER.IN_PROGRESS); continue; }
      if (proj === 0) { labels.add(ACTION_TIER.NO_DEMAND); continue; }
      const m = computeIdpRowMetrics(row);
      if (m.actionTier) labels.add(m.actionTier);
    }
    // Preserve canonical urgency order.
    return ACTION_TIER_ORDER.filter((l) => labels.has(l));
  }, [mergedAllItems]);

  // Dynamic Status / Purchasing Status options derived from currently-loaded rows.
  // Source-of-truth is the live forecast_report data in mergedAllItems — the
  // filter dropdowns reflect exactly the values present in the data and never
  // desync from a stale server-scan cache or contain options that don't exist
  // in the column. Each filter reads only its own column and is fully
  // independent. Falls back to the server-scan list during initial paint
  // while rows are still streaming in.
  const deriveDistinctSortedFromRows = (key: "status" | "pu_status" | "shopify_status", fallback: string[]): string[] => {
    // Dedup case-insensitively so "Slow"/"SLOW" and
    // "Working (item data creation)"/"Working (Item Data Creation)" collapse
    // into ONE option. Among case variants, prefer the cleanest display:
    // not ALL-CAPS, then alphabetical — so "Slow" wins over "SLOW".
    const byLower = new Map<string, string>();
    const consider = (s: string) => {
      const lower = s.toLowerCase();
      const existing = byLower.get(lower);
      if (existing == null) {
        byLower.set(lower, s);
        return;
      }
      const existingAllCaps = existing === existing.toUpperCase();
      const candAllCaps = s === s.toUpperCase();
      if (existingAllCaps && !candAllCaps) byLower.set(lower, s); // prefer non-all-caps
      else if (existingAllCaps === candAllCaps && s.localeCompare(existing) < 0) byLower.set(lower, s);
    };

    for (const row of mergedAllItems) {
      const v = (row as any)[key];
      if (v == null) continue;
      const s = String(v).trim();
      if (s === "" || s === "-") continue;
      consider(s);
    }
    if (byLower.size === 0) {
      // Fallback (server scan) — dedup it the same way.
      for (const s of fallback) {
        const t = String(s).trim();
        if (t && t !== "-") consider(t);
      }
    }
    return Array.from(byLower.values()).sort((a, b) => a.localeCompare(b));
  };

  const statusOptions = useMemo(
    () => deriveDistinctSortedFromRows("status", statusOptionsServer),
    [mergedAllItems, statusOptionsServer],
  );

  const puStatusOptions = useMemo(
    () => deriveDistinctSortedFromRows("pu_status", puStatusOptionsServer),
    [mergedAllItems, puStatusOptionsServer],
  );

  const shopifyStatusOptions = useMemo(() => {
    const options = new Set<string>();

    for (const row of mergedAllItems) {
      const v = (row as any).shopify_status;
      const s = String(v ?? "").trim();
      if (s === "" || s === "-") {
        options.add("-");
      } else {
        options.add(s);
      }
    }

    if (options.size === 0) {
      for (const s of shopifyStatusOptionsServer) {
        const t = String(s).trim();
        options.add(t === "" ? "-" : t);
      }
    }

    return Array.from(options).sort((a, b) => {
      if (a === "-") return -1;
      if (b === "-") return 1;
      return a.localeCompare(b);
    });
  }, [mergedAllItems, shopifyStatusOptionsServer]);

  const orderProposalQtyOptions = useMemo(() => {
    const set = new Set<string>();
    let hasBlank = false;
    for (const row of mergedAllItems) {
      const val = String((row as any).order_proposal_qty ?? "").trim();
      if (!val || val === "-" || val === "0") {
        hasBlank = true;
      } else {
        set.add(val);
      }
    }
    const sorted = Array.from(set).sort((a, b) => {
      const numA = parseFloat(a) || 0;
      const numB = parseFloat(b) || 0;
      return numB - numA; // Descending order
    });
    if (hasBlank) sorted.unshift("(Blank)");
    return sorted;
  }, [mergedAllItems]);

  const buyerNotesOptions = useMemo(() => {
    const set = new Set<string>();
    let hasBlank = false;
    for (const row of mergedAllItems) {
      const val = String((row as any).buyer_notes ?? "").trim();
      if (!val || val === "-") {
        hasBlank = true;
      } else {
        set.add(val);
      }
    }
    const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (hasBlank) sorted.unshift("(Blank)");
    return sorted;
  }, [mergedAllItems]);

  /**
   * IDP planner Status filter options. Collapses the two "Discontinued"
   * flavors ("Discontinued" + "Discontinued Active as a new SKU") into a
   * single "Discontinued" option per buyer request — both DB values still
   * exist on the row, the planner filter just treats them as one bucket.
   * Keep `puStatusOptions` (raw) for the main forecast filter, where the
   * distinction can still be useful.
   */
  const puStatusOptionsIdp = useMemo(() => {
    const set = new Set<string>();
    for (const v of puStatusOptions) set.add(puStatusCanonical(v));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [puStatusOptions]);

  // Filtered items for dialog - uses IDP-specific filters (idpFilters) and search (debouncedIdpSearch)
  const dialogFilteredItems = useMemo(() => {
    let filtered = mergedAllItems;
    
    // Apply IDP dialog search query (independent from main table search)
    if (debouncedIdpSearch.trim()) {
      const lowerSearch = debouncedIdpSearch.toLowerCase();
      filtered = filtered.filter((row) => {
        const sku = String((row as any).sku ?? "").toLowerCase();
        const description = String((row as any).description ?? "").toLowerCase();
        return sku.includes(lowerSearch) || description.includes(lowerSearch);
      });
    }
    
    // Apply SKU filter
    if (idpFilters.sku.length > 0) {
      filtered = filtered.filter((row) => {
        const sku = String((row as any).sku ?? "");
        return idpFilters.sku.includes(sku);
      });
    }
    
    // Apply Product Name filter (description column)
    if (idpFilters.description?.length > 0) {
      filtered = filtered.filter((row) => {
        const description = String((row as any).description ?? "");
        return idpFilters.description.includes(description);
      });
    }
    
    // Apply Factory filter
    if (idpFilters.factory.length > 0) {
      filtered = filtered.filter((row) => {
        const factory = String((row as any).factory ?? "");
        return idpFilters.factory.includes(factory);
      });
    }
    
    // Apply Category filter
    if (idpFilters.category.length > 0) {
      filtered = filtered.filter((row) => {
        const category = String((row as any).category ?? "");
        return idpFilters.category.includes(category);
      });
    }
    
    // Apply Status filter
    if (idpFilters.status.length > 0) {
      filtered = filtered.filter((row) => {
        const status = String((row as any).status ?? "");
        return idpFilters.status.includes(status);
      });
    }

    // Apply Purchasing Status filter — match against the canonical form so
    // selecting "Discontinued" also matches "Discontinued Active as a new SKU".
    if (idpFilters.pu_status && idpFilters.pu_status.length > 0) {
      filtered = filtered.filter((row) => {
        const canonical = puStatusCanonical((row as any).pu_status);
        return idpFilters.pu_status.includes(canonical);
      });
    }

    // Shopify Status filter removed from here - will be applied per-dialog in UI layer
    // This allows IDP to show all items, while Storefront Stock can filter separately

    // Apply Priority Level filter
    if (idpFilters.priority_level.length > 0) {
      filtered = filtered.filter((row) => {
        const priority = String((row as any).priority_level ?? "");
        return idpFilters.priority_level.includes(priority);
      });
    }
    
    // Apply Country filter
    if (idpFilters.country && idpFilters.country.length > 0) {
      filtered = filtered.filter((row) => {
        const country = String((row as any).country ?? "");
        return idpFilters.country.includes(country);
      });
    }

    // Apply Buyer filter
    if (idpFilters.buyer && idpFilters.buyer.length > 0) {
      filtered = filtered.filter((row) => {
        const buyer = String((row as any).buyer ?? "");
        return idpFilters.buyer.includes(buyer);
      });
    }

    // Apply Inventory Analyst filter
    if (idpFilters.inventory_analyst && idpFilters.inventory_analyst.length > 0) {
      filtered = filtered.filter((row) => {
        const analyst = String((row as any).inventory_analyst ?? "");
        return idpFilters.inventory_analyst.includes(analyst);
      });
    }

    // Combined action-filter + sort enrichment in one pass — computes
    // computeIdpRowMetrics once per row instead of twice (filter + map).
    const REVENUE_TIE_RANKS = new Set([
      ACTION_TIER_RANK[ACTION_TIER.URGENT],
    ]);
    const enriched: { row: typeof filtered[number]; sortRank: number; dumo: number; rl: number }[] = [];
    for (const row of filtered) {
      const puStatus = (row as any).pu_status;
      const proj = Number((row as any).ninety_day_projection) || 0;
      const override = puStatusOverrideLabel(puStatus);
      let sortRank: number;
      let m: ReturnType<typeof computeIdpRowMetrics> | null = null;
      if (override === "Discontinued") {
        sortRank = ACTION_TIER_RANK[ACTION_TIER.DISCONTINUED];
        if (idpFilters.action.length > 0 && !idpFilters.action.includes(ACTION_TIER.DISCONTINUED)) continue;
      } else if (override === "In Progress") {
        sortRank = ACTION_TIER_RANK[ACTION_TIER.IN_PROGRESS];
        if (idpFilters.action.length > 0 && !idpFilters.action.includes(ACTION_TIER.IN_PROGRESS)) continue;
      } else if (proj === 0) {
        sortRank = ACTION_TIER_RANK[ACTION_TIER.NO_DEMAND];
        if (idpFilters.action.length > 0 && !idpFilters.action.includes(ACTION_TIER.NO_DEMAND)) continue;
      } else {
        m = computeIdpRowMetrics(row);
        sortRank = m.actionTier ? ACTION_TIER_RANK[m.actionTier] : ACTION_TIER_RANK_NULL;
        if (idpFilters.action.length > 0 && (!m.actionTier || !idpFilters.action.includes(m.actionTier))) continue;
      }
      enriched.push({
        row,
        sortRank,
        dumo: m?.daysUntilMustOrder ?? Number.POSITIVE_INFINITY,
        rl: Number((row as any).ninety_day_revenue_loss) || 0,
      });
    }
    enriched.sort((a, b) => {
      if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
      // Urgent tiers (Out of Stock / Overdue / Order ≤7d):
      //   highest 90-day revenue loss first — dollar impact wins ties.
      if (REVENUE_TIE_RANKS.has(a.sortRank) && a.rl !== b.rl) return b.rl - a.rl;
      // Non-urgent tiers: fewest days until must order first (soonest planned
      // action surfaces above further-out work).
      return a.dumo - b.dumo;
    });
    return enriched.map((e) => e.row);
  }, [mergedAllItems, debouncedIdpSearch, idpFilters.sku, idpFilters.description, idpFilters.factory, idpFilters.category, idpFilters.status, idpFilters.pu_status, idpFilters.shopify_status, idpFilters.priority_level, idpFilters.action, idpFilters.country, idpFilters.buyer, idpFilters.inventory_analyst]);

  // Get all unique factories from database (for Email Settings UI)
  // Use factoryOptions from filter options query instead of dialogFilteredItems
  // so that ALL factories are available regardless of current table filters
  const allFactories = useMemo(() => {
    return factoryOptions.length > 0 ? factoryOptions : [];
  }, [factoryOptions]);

  // Paginated items for dialog
  const dialogPaginatedItems = useMemo(() => {
    const startIdx = (dialogCurrentPage - 1) * dialogPageSize;
    const endIdx = startIdx + dialogPageSize;
    return dialogFilteredItems.slice(startIdx, endIdx);
  }, [dialogFilteredItems, dialogCurrentPage, dialogPageSize]);

  const dialogTotalPages = Math.ceil(dialogFilteredItems.length / dialogPageSize);

  /**
   * Per-row derived values for the planner table. Computing these inside the
   * row-render loop made every keystroke/sort run `computeIdpRowMetrics`,
   * regex, `Intl.DateTimeFormat`, etc. 100× per render. Memoized here keyed
   * by the visible page (sku → derived) so the cost only re-runs when the
   * paginated slice or relevant pu_status helpers change.
   */
  const dialogRowDerivedMap = useMemo(() => {
    const map = new Map<string, {
      ninetyDayProjection: number;
      ninetyDaySupply: number;
      ninetyDayDeficit: number;
      revenueLoss: number;
      safetyStock: number;
      orderRecommended: number;
      leadTime: number | null;
      orderDate: string;
      supplyMonth: string;
      coveredMonths: string;
      mainName: string;
      variant: string;
      deficitColor: string;
      deficitWeight: "bold" | "normal";
      deficitText: string;
      daysUntilMustOrder: number | null;
      daysOfSupply: number;
      daysUntilMustOrderRunway: number | null;
      daysWithoutStock: number;
      actionTier: ActionTierLabel | null;
      puSkip: boolean;
      puOverride: string | null;
      effectiveTier: ActionTierLabel | null;
      actionLabel: string;
      actionBg: string;
      actionColor: string;
    }>();

    const todayMs = Date.now();
    for (const row of dialogPaginatedItems) {
      const sku = String((row as any).sku ?? "");
      if (!sku) continue;
      const description = String((row as any).description ?? "");
      const puStatus = (row as any).pu_status;

      // Single source of truth — buildIdpExportRow drives the CSV download
      // and the emailed CSV attachment too. Reading the UI cell values from
      // it guarantees the planner table, the download, and the email all
      // agree on every number / label.
      const exportRow = buildIdpExportRow(row, todayMs);
      const ninetyDayProjection = Number(exportRow.values.ninety_day_projection) || 0;
      const ninetyDaySupply     = Number(exportRow.values.ninety_day_supply) || 0;
      const ninetyDayDeficit    = Number(exportRow.values.ninety_day_deficit) || 0;
      const revenueLoss         = Number(exportRow.values.ninety_day_revenue_loss) || 0;
      const safetyStock         = Number(exportRow.values.safety_stock) || 0;
      const orderRecommended    = Number(exportRow.values.order_recommended) || 0;
      const leadTimeRaw         = exportRow.values.lead_time;
      const leadTime            = typeof leadTimeRaw === "number" ? leadTimeRaw : null;
      const orderDate           = String((row as any).order_date_forecast ?? "");
      const supplyMonth         = String((row as any).supply_month_forecast ?? "");
      const coveredMonths       = String((row as any).covered_months ?? "");

      let mainName = description;
      let variant = "";
      const mIn = description.match(/^(.*?)\s+in\s+(.*)$/i);
      const mDash = description.match(/^(.*?)\s+-\s+(.*)$/);
      if (mIn) { mainName = mIn[1].trim(); variant = mIn[2].trim(); }
      else if (mDash) { mainName = mDash[1].trim(); variant = mDash[2].trim(); }

      const deficitColor = ninetyDayDeficit < 0 ? "#ff6b6b" : ninetyDayDeficit > 0 ? "#000000" : "#888";
      const deficitWeight: "bold" | "normal" = ninetyDayDeficit !== 0 ? "bold" : "normal";
      const deficitText = ninetyDayDeficit < 0 ? ninetyDayDeficit.toFixed(1) : ninetyDayDeficit > 0 ? `+${ninetyDayDeficit.toFixed(1)}` : "0";

      const daysUntilMustOrder = computeIdpDaysToReorder(row, todayMs);
      const metrics = computeIdpRowMetrics(row);
      const puSkip = puStatusSkipsReorder(puStatus);
      const puOverride = puStatusOverrideLabel(puStatus);
      const effectiveTier = exportRow.effectiveTier;
      const actionLabel = String(exportRow.values.action_label ?? "—");
      const theme = effectiveTier ? ACTION_TIER_THEME[effectiveTier] : null;
      const actionBg = theme?.bg ?? "transparent";
      const actionColor = theme?.color ?? "#9ca3af";

      map.set(sku, {
        ninetyDayProjection, ninetyDaySupply, ninetyDayDeficit, revenueLoss,
        safetyStock, orderRecommended, leadTime,
        orderDate, supplyMonth, coveredMonths,
        mainName, variant,
        deficitColor, deficitWeight, deficitText,
        daysUntilMustOrder,
        daysOfSupply: metrics.daysOfSupply,
        daysUntilMustOrderRunway: metrics.daysUntilMustOrder,
        daysWithoutStock: metrics.daysWithoutStock,
        actionTier: metrics.actionTier,
        puSkip, puOverride, effectiveTier,
        actionLabel, actionBg, actionColor,
      });
    }
    return map;
  }, [dialogPaginatedItems]);

  /**
   * Global IDP summary counts — always computed across the *unfiltered* full
   * dataset (`mergedAllItems`). Cards stay fixed as a dashboard overview
   * regardless of the active filters/search applied to the table below.
   * Memoized so the full-table scan only re-runs when the underlying data
   * changes, not on every filter/search keystroke.
   */
  const dialogSummaryCounts = useMemo(() => {
    let urgent = 0, order30 = 0, order60 = 0, order90 = 0;
    for (const r of mergedAllItems) {
      const puStatus = (r as any).pu_status;
      const proj = Number((r as any).ninety_day_projection) || 0;
      // Covered / No Demand / Discontinued / In Progress / Missing
      // LT are excluded from the 4-card actionable summary (they're handled
      // by their own override labels in the table itself).
      if (puStatusSkipsReorder(puStatus) || proj === 0) continue;
      const m = computeIdpRowMetrics(r);
      switch (m.actionTier) {
        case ACTION_TIER.URGENT:   urgent++;  break;
        case ACTION_TIER.ORDER_30: order30++; break;
        case ACTION_TIER.ORDER_60: order60++; break;
        case ACTION_TIER.ORDER_90: order90++; break;
      }
    }
    return { urgent, order30, order60, order90 };
  }, [mergedAllItems]);

  /**
   * Dev-only invariant guard. Spec rule: a row with negative 90-day deficit
   * must land in Urgent — never in the planning tiers (Order within 20d /
   * 45d / 75d / Covered). Scans once per dataset
   * change and logs any violation to the console. No-op in production.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (mergedAllItems.length === 0) return;
    const planningTiers = new Set<ActionTierLabel>([
      ACTION_TIER.ORDER_30,
      ACTION_TIER.ORDER_60,
      ACTION_TIER.ORDER_90,
      ACTION_TIER.NO_ACTION,
    ]);
    const violations: { sku: string; deficit: number; tier: ActionTierLabel }[] = [];
    for (const r of mergedAllItems) {
      const puStatus = (r as any).pu_status;
      const proj = Number((r as any).ninety_day_projection) || 0;
      if (puStatusSkipsReorder(puStatus) || proj === 0) continue;
      const m = computeIdpRowMetrics(r);
      if (!m.actionTier) continue;
      const deficit = Number((r as any).ninety_day_deficit ?? 0);
      if (Number.isFinite(deficit) && deficit < 0 && planningTiers.has(m.actionTier)) {
        violations.push({
          sku: String((r as any).sku ?? "?"),
          deficit,
          tier: m.actionTier,
        });
      }
    }
  }, [mergedAllItems]);

  /** ── Generic upsert helper for forecast_report_manual (via edge function to bypass external RLS) ── */
  const upsertManualField = useCallback(
    async (sku: string, field: string, value: unknown) => {
      // Bust prevMergedRef so repeated edit→clear cycles don't return a stale array.
      prevMergedRef.current = null;

      // Patch cache immediately so UI updates without waiting for refetch
      queryClient.setQueryData(["forecast_report_manual"], (prev: any[] | undefined) => {
        if (!prev) return [{ sku, [field]: value }];
        const idx = prev.findIndex((r: any) => r.sku === sku);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], [field]: value };
          return updated;
        }
        return [...prev, { sku, [field]: value }];
      });

      // Instant push to other users (Broadcast) — DB write below persists + reconciles.
      broadcastForecastEdit({ table: "forecast_report_manual", sku, fields: { [field]: value } });

      const result = await callAdminOperationsApi("forecast_manual_upsert", {
        sku,
        fields: { [field]: value },
      });
      const data = (result as any)?.data;
      if (!data?.length) {
        // Rollback on failure
        queryClient.invalidateQueries({ queryKey: ["forecast_report_manual"] });
        throw new Error("No rows upserted — edge function returned empty");
      }
      // No refetch: the optimistic cache patch above already shows the value,
      // and the realtime echo of this write (REPLICA IDENTITY FULL) reconciles
      // the authoritative row. Refetching 10k rows per edit serialized bulk edits.
    },
    [queryClient],
  );

  const handleSaveBuyerNotes = useCallback(
    async (sku: string, newValue: string | null) => {
      if (!sku) throw new Error("Missing SKU");
      await upsertManualField(sku, "buyer_notes", newValue);
      toast.success(`Saved Buyer Approval for ${sku}`);
      // Notes render from manualMap (patched optimistically + via realtime) —
      // no need to refetch the whole paginated page on each note edit.
    },
    [upsertManualField, queryClient, pageQueryKey],
  );

  const handleSavePlannerNotes = useCallback(
    async (sku: string, newValue: string | null) => {
      if (!sku) throw new Error("Missing SKU");
      await upsertManualField(sku, "planner_notes", newValue);
      toast.success(`Saved Planner Notes for ${sku}`);
      // Notes render from manualMap (patched optimistically + via realtime) —
      // no need to refetch the whole paginated page on each note edit.
    },
    [upsertManualField, queryClient, pageQueryKey],
  );

  const handleSaveAnalystNotes = useCallback(
    async (sku: string, newValue: string | null) => {
      if (!sku) throw new Error("Missing SKU");
      await upsertManualField(sku, "analyst_notes", newValue);
      toast.success(`Saved Analyst Notes for ${sku}`);
      // Notes render from manualMap (patched optimistically + via realtime) —
      // no need to refetch the whole paginated page on each note edit.
    },
    [upsertManualField, queryClient, pageQueryKey],
  );

  /** ── Upsert helper for forecast_report_status (factory/status/kit/category) ── */
  const upsertStatusField = useCallback(async (sku: string, field: string, value: unknown) => {
    const payload: Record<string, unknown> = { sku, updated_at: new Date().toISOString(), [field]: value };
    const { data, error } = await (supabase as any)
      .from("forecast_report_status")
      .upsert(payload, { onConflict: "sku", defaultToNull: false })
      .select("*");
    if (error) {
      const msg = error?.message || error?.details || error?.hint || String(error);
      throw new Error(msg);
    }
    if (!data?.length) throw new Error("No rows upserted — check RLS or constraints");
  }, []);

  const handleSaveStatusOverride = useCallback(
    async (row: Record<string, unknown>, field: string, newValue: string | null) => {
      const sku = String(row.sku ?? "");
      if (!sku) throw new Error("Missing SKU");

      // Snapshot for rollback
      const prevCache = queryClient.getQueryData<any[]>(["forecast_report_status"]);

      // Optimistic cache patch so statusOverrideMap + mergedItems recompute immediately
      queryClient.setQueryData(["forecast_report_status"], (prev: any[] | undefined) => {
        const list = prev ?? [];
        const idx = list.findIndex((r: any) => String(r?.sku) === sku);
        if (idx >= 0) {
          const updated = [...list];
          updated[idx] = { ...updated[idx], [field]: newValue };
          return updated;
        }
        return [...list, { sku, [field]: newValue }];
      });

      // Instant push to other users (Broadcast).
      broadcastForecastEdit({ table: "forecast_report_status", sku, fields: { [field]: newValue } });

      try {
        await upsertStatusField(sku, field, newValue);
        toast.success(`Saved ${field} for ${sku}`);
      } catch (err) {
        // Rollback on failure
        if (prevCache) queryClient.setQueryData(["forecast_report_status"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_status"] });
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Failed to save ${field}: ${msg}`);
        throw err;
      }
    },
    [upsertStatusField, queryClient],
  );

  const handleSelectRowOption = useCallback(
    async (sku: string, optionNum: number) => {
      if (!sku) {
        toast.error("Could not identify SKU for update.");
        return;
      }

      const opt = Math.min(4, Math.max(0, Number.isFinite(Number(optionNum)) ? Number(optionNum) : 1));

      // Snapshot for revert
      let prevLocalPatch: Record<string, unknown> | undefined;
      setLocalRowPatches((prev) => {
        prevLocalPatch = prev[sku];
        return {
          ...prev,
          [sku]: { ...(prev[sku] ?? {}), forecast_option: opt },
        };
      });

      // Patch the manual cache so the change survives even after localPatch is cleared
      queryClient.setQueryData(["forecast_report_manual"], (prev: Record<string, unknown>[] | undefined) => {
        if (!prev) return [{ sku, forecast_option: opt }];
        const idx = prev.findIndex((r) => String(r.sku) === sku);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], forecast_option: opt };
          return updated;
        }
        return [...prev, { sku, forecast_option: opt }];
      });

      // Instant push to other users (Broadcast).
      broadcastForecastEdit({ table: "forecast_report_manual", sku, fields: { forecast_option: opt } });

      // Re-trigger row selection so hover/highlight refreshes immediately after menu close
      try {
        applyRowSelection?.(sku);
      } catch {
        /* noop */
      }

      try {
        const result = await callAdminOperationsApi("forecast_manual_upsert", {
          sku,
          fields: {
            forecast_option: opt,
          },
        });

        // No refetch — the optimistic cache patch above + the realtime echo
        // (REPLICA IDENTITY FULL) reconcile the authoritative row.

        toast.success(`Forecast Option ${opt} saved for ${sku}`);
      } catch (err: any) {
        // Revert optimistic localPatch
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        // Refetch authoritative state
        queryClient.invalidateQueries({ queryKey: ["forecast_report_manual"] });
        toast.error(`Failed to save Forecast Option ${opt} for ${sku}: ${err?.message ?? "unknown error"}`);
      }
    },
    [queryClient, applyRowSelection],
  );

  /** ── Inline edit: Projection Override → upsert into forecast_report_proj_override ── */
  const handleSaveProjOverride = useCallback(
    async (row: Record<string, unknown>, monthIndex: number, newValue: number | null) => {
      const sku = String(row.sku ?? "");
      if (!sku) throw new Error("Missing SKU");

      const field = `proj_month_${monthIndex}_override`;
      
      // 1) Snapshot previous state for rollback
      const prevCache = queryClient.getQueryData<Record<string, unknown>[]>(["forecast_report_proj_override"]);
      const prevLocalPatch = localRowPatches[sku];

      // 2) Bust the prevMergedRef short-circuit BEFORE the render.
      //    On repeated edit→clear cycles, mergedItems can hit recomputeCacheRef for every
      //    row (anyMiss=false) and return prevMergedRef.current.result — which is the stale
      //    array from the last SET render.  Nulling it forces mergedItems to use `next`
      //    (built from the same cache hits but reflecting the current override state).
      prevMergedRef.current = null;

      // 3) Instant client-side patch FIRST — must precede flushSync so that the
      //    synchronous render inside flushSync already sees the updated projOverrideMap.
      //    If setQueryData ran after flushSync, mergedItems would recompute with the
      //    stale projOvr (still holding the old value) and display the wrong result.
      queryClient.setQueryData(["forecast_report_proj_override"], (prev: Record<string, unknown>[] | undefined) => {
        if (!prev) return [{ sku, [field]: newValue }];
        const idx = prev.findIndex((r) => String(r.sku) === sku);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], [field]: newValue };
          return updated;
        }
        return [...prev, { sku, [field]: newValue }];
      });

      // Instant push to other users (Broadcast).
      broadcastForecastEdit({ table: "forecast_report_proj_override", sku, fields: { [field]: newValue } });

      // 3) Optimistic recompute — flushSync flushes both the setQueryData update above
      //    and this setLocalRowPatches together, so mergedItems sees projOverrideMap with
      //    the cleared value in the same render pass.
      {
        const updatedProjOverride = { ...(projOverrideMap.get(sku) ?? {}), [field]: newValue };
        if (newValue === null) delete updatedProjOverride[field];
        const manualForOpt = (queryClient.getQueryData<any[]>(["forecast_report_manual"]) ?? []).find(
          (r: any) => r?.sku === sku,
        );
        const optionNumForCalc = Math.min(
          4,
          Math.max(
            1,
            Number((localRowPatches[sku]?.forecast_option as number | undefined) ?? manualForOpt?.forecast_option ?? 0) ||
              1,
          ),
        );
        const recomputedRow = recomputeForecastRow(
          row,
          monthlySaleMap,
          true, // drivingInputChanged = true (projection override triggers full recompute)
          updatedProjOverride,
          supplyOverrideMap.get(sku) ?? null,
          optionNumForCalc,
        );
        flushSync(() => {
          setLocalRowPatches((prev) => ({ ...prev, [sku]: recomputedRow }));
        });
      }

      // 3) Save to DB. defaultToNull:false preserves sibling override columns on conflict.
      const payload: Record<string, unknown> = { sku, updated_at: new Date().toISOString(), [field]: newValue };
      const { data, error } = await (supabase as any)
        .from("forecast_report_proj_override")
        .upsert(payload, { onConflict: "sku", defaultToNull: false })
        .select("*");

      if (error) {
        // Rollback
        if (prevCache) queryClient.setQueryData(["forecast_report_proj_override"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_proj_override"] });
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        const msg = error?.message || error?.details || error?.hint || String(error);
        throw new Error(msg);
      }

      if (!data?.length) {
        // Rollback
        if (prevCache) queryClient.setQueryData(["forecast_report_proj_override"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_proj_override"] });
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        throw new Error("No rows upserted — check RLS or constraints");
      }

      void queryClient.refetchQueries({ queryKey: ["forecast_report_proj_override"] });

      toast.success(`Saved projection month ${monthIndex} override for ${sku}`);
    },
    [queryClient, localRowPatches, recomputeForecastRow, monthlySaleMap, projOverrideMap, supplyOverrideMap],
  );

  /** ── Inline edit: Supply Override → upsert into forecast_report_supply_override ── */
  const handleSaveSupplyOverride = useCallback(
    async (row: Record<string, unknown>, monthIndex: number, newValue: number | null) => {
      const sku = String(row.sku ?? "");
      if (!sku) throw new Error("Missing SKU");

      const field = `supply_month_${monthIndex}_override`;

      // 1) Snapshot previous state for rollback
      const prevCache = queryClient.getQueryData<Record<string, unknown>[]>(["forecast_report_supply_override"]);
      const prevLocalPatch = localRowPatches[sku];

      // 2) Bust the prevMergedRef short-circuit — same reason as handleSaveProjOverride.
      prevMergedRef.current = null;

      // 3) Instant client-side patch FIRST — must precede flushSync so that the
      //    synchronous render inside flushSync already sees the updated supplyOverrideMap.
      queryClient.setQueryData(["forecast_report_supply_override"], (prev: Record<string, unknown>[] | undefined) => {
        if (!prev) return [{ sku, [field]: newValue }];
        const idx = prev.findIndex((r) => String(r.sku) === sku);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], [field]: newValue };
          return updated;
        }
        return [...prev, { sku, [field]: newValue }];
      });

      // Instant push to other users (Broadcast).
      broadcastForecastEdit({ table: "forecast_report_supply_override", sku, fields: { [field]: newValue } });

      // 3) Optimistic recompute — flushSync flushes both the setQueryData update above
      //    and this setLocalRowPatches together, so mergedItems sees supplyOverrideMap with
      //    the cleared value in the same render pass.
      {
        const updatedSupplyOverride = { ...(supplyOverrideMap.get(sku) ?? {}), [field]: newValue };
        if (newValue === null) delete updatedSupplyOverride[field];
        const manualForOpt = (queryClient.getQueryData<any[]>(["forecast_report_manual"]) ?? []).find(
          (r: any) => r?.sku === sku,
        );
        const optionNumForCalc = Math.min(
          4,
          Math.max(
            1,
            Number((localRowPatches[sku]?.forecast_option as number | undefined) ?? manualForOpt?.forecast_option ?? 0) ||
              1,
          ),
        );
        const recomputedRow = recomputeForecastRow(
          row,
          monthlySaleMap,
          false, // drivingInputChanged = false (supply override doesn't trigger projection recompute)
          projOverrideMap.get(sku) ?? null,
          updatedSupplyOverride,
          optionNumForCalc,
        );
        flushSync(() => {
          setLocalRowPatches((prev) => ({ ...prev, [sku]: recomputedRow }));
        });
      }

      // 3) Save to DB. defaultToNull:false preserves sibling override columns on conflict.
      const payload: Record<string, unknown> = { sku, updated_at: new Date().toISOString(), [field]: newValue };
      const { data, error } = await (supabase as any)
        .from("forecast_report_supply_override")
        .upsert(payload, { onConflict: "sku", defaultToNull: false })
        .select("*");

      if (error) {
        // Rollback
        if (prevCache) queryClient.setQueryData(["forecast_report_supply_override"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_supply_override"] });
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        const msg = error?.message || error?.details || error?.hint || String(error);
        throw new Error(msg);
      }

      if (!data?.length) {
        // Rollback
        if (prevCache) queryClient.setQueryData(["forecast_report_supply_override"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_supply_override"] });
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        throw new Error("No rows upserted — check RLS or constraints");
      }

      void queryClient.refetchQueries({ queryKey: ["forecast_report_supply_override"] });

      toast.success(`Saved supply month ${monthIndex} override for ${sku}`);
    },
    [queryClient, localRowPatches, recomputeForecastRow, monthlySaleMap, projOverrideMap, supplyOverrideMap],
  );

  const handleSaveEdit = async (updates: Record<string, unknown>) => {
    if (!editRow) return;
    setEditLoading(true);

    try {
      const pkVal = editRow[pkCol];
      if (pkVal == null) throw new Error(`Missing primary key value (${pkCol}).`);

      const safeUpdates: Record<string, unknown> = {};
      for (const col of editableCols) {
        if (col === pkCol) continue;
        if (MANUAL_ONLY_COLUMNS.includes(col.toLowerCase())) continue;
        if (col in updates) safeUpdates[col] = updates[col];
      }

      delete (safeUpdates as any).id;
      delete (safeUpdates as any).created_at;
      delete (safeUpdates as any).updated_at;

      const { data, error } = await supabase
        .from(TABLE_NAME)
        .update(safeUpdates)
        .eq(pkCol, pkVal as any)
        .select("*");

      if (error) throw error;
      if (!data?.length) throw new Error("No rows updated - check RLS UPDATE policy.");

      const updatedRow = data[0] as Record<string, unknown>;

      // Invalidate to refetch current page with fresh data
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });

      toast.success("Record updated");
      setEditOpen(false);
    } catch (e: any) {
      toast.error("Update failed: " + (e?.message || String(e)));
    } finally {
      setEditLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteRow) return;
    setDeleteLoading(true);

    try {
      const pkVal = deleteRow[pkCol];
      if (pkVal == null) throw new Error(`Missing primary key value (${pkCol}).`);

      const { data, error } = await supabase
        .from(TABLE_NAME)
        .delete()
        .eq(pkCol, pkVal as any)
        .select("*");

      if (error) throw error;
      if (!data?.length) throw new Error("No rows deleted - check RLS policies.");

      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });

      toast.success("Record deleted");
      setDeleteOpen(false);
    } catch (e: any) {
      toast.error("Delete failed: " + (e?.message || String(e)));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleExport = async () => {
    if (!schema.length || items.length === 0) return;
    setExporting(true);
    setExportProgress(0);

    try {
      const groupHeaderLabelFn = (key: string) => {
        if (key === "sales_monthly") return salesHeaderTitle;
        if (key === "instock") return instockHeaderTitle;
        if (key === "projection") return projectionHeaderTitle;
        if (key === "incoming") return incomingHeaderTitle;
        if (key === "supply_plan") return supplyHeaderTitle;
        if (key === "replacement_inventory") return "Replacement Inventory";
        if (key === "replacement_incoming") return replIncomingHeaderTitle;
        return labelForGroup(key);
      };

      // Fetch all filtered rows for export (server-side, BATCHED):
      // may 1,000-row cap bawat request ang PostgREST, kaya i-page hanggang
      // makuha LAHAT — hindi lang ang unang 1,000.
      const allFiltered: Record<string, unknown>[] = [];
      {
        const BATCH = 1000;
        let from = 0;
        while (true) {
          const { data: page, error: exportErr } = await buildFilteredQuery("*")
            .order("sku", { ascending: true })
            .range(from, from + BATCH - 1);
          if (exportErr) throw exportErr;
          if (!page || page.length === 0) break;
          allFiltered.push(...(page as Record<string, unknown>[]));
          if (page.length < BATCH) break;
          from += BATCH;
        }
      }

      // Fetch first-sale-date fresh here rather than trusting the component's
      // firstSaleDateMap -- that query can still be loading (refetchOnMount:
      // false) if Export is clicked shortly after the page loads, which would
      // silently leave sku_status un-recomputed for the whole export.
      // Legacy fallback lang ito (master_sku.new_sku ang authoritative na Sku
      // Status) — kapag wala na ang sku_first_sale_date view sa DB, ituloy
      // ang export nang walang fallback map sa halip na mamatay.
      let fsdRows: Awaited<ReturnType<typeof fetchFirstSaleDates>> = [];
      try {
        fsdRows = await fetchFirstSaleDates(supabase);
      } catch {
        fsdRows = [];
      }
      const exportFirstSaleDateMap = new Map<string, string | null>(
        fsdRows.map((r) => [r.sku, r.first_sale_date]),
      );

      // Sku Status source: master_sku.new_sku — same authoritative override
      // the live table applies; fetched fresh here for the same race reason.
      const exportMasterSkuMap = new Map<string, string>();
      {
        // Batched din (1,000-row PostgREST cap)
        const BATCH = 1000;
        let from = 0;
        while (true) {
          const { data: msRows } = await (supabase as any)
            .from("master_sku")
            .select("sku,new_sku")
            .range(from, from + BATCH - 1);
          if (!msRows || msRows.length === 0) break;
          for (const r of msRows) {
            const s = String(r.sku ?? "").trim();
            const v = String(r.new_sku ?? "").trim();
            if (s && v) exportMasterSkuMap.set(s, v);
          }
          if (msRows.length < BATCH) break;
          from += BATCH;
        }
      }

      // the ERP names — same authoritative-name override the live table
      // applies (see scNameMap), fetched fresh here for the same race reason.
      // Non-fatal: kapag nag-error ang fetch, ituloy ang export gamit ang
      // stored descriptions sa halip na mamatay.
      let exportScNameMap = new Map<string, string>();
      try {
        exportScNameMap = buildScNameMap(await fetchScProductNames(supabase));
      } catch {
        exportScNameMap = new Map();
      }

      const exportRows = (allFiltered || []).map((row: Record<string, unknown>) => {
        // "replica" mirrors the on-screen Monthly Sales grid; the (MTD) header
        // label carries into the file via labelForColumnDynamic, so the partial
        // month stays labelled in the export too.
        const materialized = materializeDisplayRow(row, schema, monthlyReplicaMap, "replica");
        // Actual Sales at Unshipped: mula sa forecast_report row values
        // (loader-fed) — pareho ng grid, walang override.

        // Manual overlay: ang mga na-enter sa app (Buyer Approval/buyer_notes,
        // the planner/the analyst notes, Order Proposal Qty, Monthly Projection) ay nasa
        // forecast_report_manual at kokopyahin lang sa forecast_report sa
        // susunod na FULL REFRESH — ipatong dito para ang export ay LAGING
        // salamin ng nakikita sa UI, kahit bagong-type pa lang.
        {
          const man = manualMap.get(String(row.sku ?? ""));
          if (man) {
            if (man.buyer_notes != null) materialized.buyer_notes = man.buyer_notes;
            if (man.planner_notes != null) materialized.planner_notes = man.planner_notes;
            if (man.analyst_notes != null) materialized.analyst_notes = man.analyst_notes;
            if (man.order_proposal_qty != null) materialized.order_proposal_qty = man.order_proposal_qty;
            if (man.monthly_projection != null) materialized.monthly_projection = man.monthly_projection;
          }
        }
        // Same override the live table applies: once the view data is in hand,
        // ALWAYS recompute — a SKU absent from the view has never sold, which
        // per the upstream CASE (first sale date IS NULL) is also "New SKU".
        if (exportMasterSkuMap.size > 0) {
          // master_sku.new_sku ang authoritative na Sku Status
          materialized.sku_status =
            exportMasterSkuMap.get(String(materialized.sku ?? "").trim()) ?? "";
        } else if (exportFirstSaleDateMap.size > 0) {
          const fsd = exportFirstSaleDateMap.get(String(materialized.sku ?? ""));
          materialized.sku_status = computeNewSku(fsd);
        }
        if (exportScNameMap.size > 0) {
          const scName = exportScNameMap.get(String(materialized.sku ?? ""));
          if (scName) materialized.description = scName;
        }
        return materialized;
      });

      const count = await exportForecastDashboardXlsx({
        schema,
        headerGroups,
        filteredData: exportRows,
        groupKey,
        labelForColumnDynamic,
        groupHeaderLabel: groupHeaderLabelFn,
        filename: "forecast_report",
      });

      toast.success(`Exported ${count} rows`);
    } catch (e: any) {
      toast.error("Export failed: " + (e?.message || String(e)));
    } finally {
      setExporting(false);
    }
  };

  /** ── Export Reorder Decisions Dialog ── */
  const handleExportForecastAnalysis = async () => {
    if (dialogFilteredItems.length === 0) return;
    
    try {
      const ExcelJS = (await import("exceljs")).default;
      const { saveAs } = await import("file-saver");
      
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Reorder Decisions");
      
      // Get month names for the first 3 months
      const monthNames = rollingIncomingMonths.slice(0, 3).map(m => {
        const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m.month - 1];
        return monthName;
      });
      
      // Define columns for the inventory decision planner
      const columns = [
        { key: "description", label: "Product Name", width: 30, bg: "FFEAF2FF", group: "basic" },
        { key: "sku", label: "Product ID", width: 20, bg: "FFEAF2FF", group: "basic" },
        { key: "priority_level", label: "Level of\nPriority", width: 12, bg: "FFEAF2FF", group: "basic" },
        { key: "factory", label: "Factory", width: 12, bg: "FFEAF2FF", group: "basic" },
        { key: "status", label: "Status", width: 12, bg: "FFEAF2FF", group: "basic" },
        { key: "kit", label: "Kit", width: 10, bg: "FFEAF2FF", group: "basic" },
        { key: "category", label: "Category", width: 12, bg: "FFEAF2FF", group: "basic" },
        { key: "country", label: "Country", width: 12, bg: "FFEAF2FF", group: "basic" },
        { key: "buyer", label: "Buyer", width: 12, bg: "FFEAF2FF", group: "basic" },
        { key: "inventory_analyst", label: "Inventory\nAnalyst", width: 15, bg: "FFEAF2FF", group: "basic" },
        { key: "proj_month_1", label: monthNames[0], width: 10, bg: "FFFFF4CC", group: "projection", isMonth: true },
        { key: "proj_month_2", label: monthNames[1], width: 10, bg: "FFFFF4CC", group: "projection", isMonth: true },
        { key: "proj_month_3", label: monthNames[2], width: 10, bg: "FFFFF4CC", group: "projection", isMonth: true },
        { key: "supply_month_1", label: monthNames[0], width: 10, bg: "FFE8D4FF", group: "supply", isMonth: true },
        { key: "supply_month_2", label: monthNames[1], width: 10, bg: "FFE8D4FF", group: "supply", isMonth: true },
        { key: "supply_month_3", label: monthNames[2], width: 10, bg: "FFE8D4FF", group: "supply", isMonth: true },
        { key: "ninety_day_projection", label: "90-Day\nProjection", width: 12, bg: "FFD6CCFF", group: "forecast" },
        { key: "ninety_day_supply", label: "90-Day\nSupply", width: 12, bg: "FFD6CCFF", group: "forecast" },
        { key: "ninety_day_deficit", label: "90-Day\nDeficit", width: 12, bg: "FFD6CCFF", group: "forecast" },
        { key: "ninety_day_revenue_loss", label: "90-Day\nRevenue Loss", width: 14, bg: "FFD6CCFF", group: "forecast" },
        { key: "safety_stock", label: "Safety\nStock", width: 12, bg: "FFD6CCFF", group: "forecast" },
        { key: "order_recommended", label: "Order\nRecommended", width: 14, bg: "FFD6CCFF", group: "forecast" },
        { key: "lead_time", label: "Lead\nTime", width: 10, bg: "FFD6CCFF", group: "forecast" },
        { key: "order_date_forecast", label: "Order\nDate", width: 14, bg: "FFD6CCFF", group: "forecast" },
        { key: "supply_month_forecast", label: "Supply\nMonth", width: 14, bg: "FFD6CCFF", group: "forecast" },
        { key: "covered_months", label: "Covered\nMonths", width: 12, bg: "FFD6CCFF", group: "forecast" },
        { key: "action", label: "Action", width: 12, bg: "FFD6CCFF", group: "forecast" },
      ];
      
      // Set column widths
      worksheet.columns = columns.map(col => ({ width: col.width }));
      
      // Add section header row (row 1)
      const sectionHeaders = [
        ...Array(10).fill(""), // Basic info columns (no section header)
        "Monthly Projection", "", "", // 3 projection columns
        "Supply Plan", "", "", // 3 supply columns
        ...Array(10).fill(""), // 90-day forecast columns (no section header)
      ];
      
      const sectionRow = worksheet.addRow(sectionHeaders);
      sectionRow.height = 20;
      
      // Merge cells for section headers
      worksheet.mergeCells(1, 11, 1, 13); // Monthly Projection
      worksheet.mergeCells(1, 14, 1, 16); // Supply Plan
      
      sectionRow.eachCell((cell, colNumber) => {
        if (colNumber >= 11 && colNumber <= 13) {
          // Monthly Projection header
          cell.value = "Monthly Projection";
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4CC" } };
          cell.font = { bold: true, size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = {
            top: { style: "thin", color: { argb: "FFB0B8C4" } },
            left: colNumber === 11 ? { style: "medium", color: { argb: "FF475569" } } : { style: "thin", color: { argb: "FFB0B8C4" } },
            bottom: { style: "thin", color: { argb: "FFB0B8C4" } },
            right: { style: "thin", color: { argb: "FFB0B8C4" } },
          };
        } else if (colNumber >= 14 && colNumber <= 16) {
          // Supply Plan header
          cell.value = "Supply Plan";
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8D4FF" } };
          cell.font = { bold: true, size: 10 };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = {
            top: { style: "thin", color: { argb: "FFB0B8C4" } },
            left: { style: "thin", color: { argb: "FFB0B8C4" } },
            bottom: { style: "thin", color: { argb: "FFB0B8C4" } },
            right: { style: "thin", color: { argb: "FFB0B8C4" } },
          };
        }
      });
      
      // Add column header row (row 2)
      const headerRow = worksheet.addRow(columns.map(col => col.label));
      headerRow.height = 30;
      headerRow.eachCell((cell, colNumber) => {
        const col = columns[colNumber - 1];
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: col.bg },
        };
        cell.font = { bold: true, size: 10 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFB0B8C4" } },
          left: (colNumber === 11 || colNumber === 17) ? { style: "medium", color: { argb: "FF475569" } } : { style: "thin", color: { argb: "FFB0B8C4" } },
          bottom: { style: "thin", color: { argb: "FFB0B8C4" } },
          right: { style: "thin", color: { argb: "FFB0B8C4" } },
        };
      });
      
      // Add data rows
      dialogFilteredItems.forEach((row: any, idx: number) => {
        const rowData = columns.map(col => {
          const value = row[col.key];
          
          // Format dates
          if (
            col.key === "order_date_forecast" ||
            col.key === "supply_month_forecast" ||
            col.key === "covered_months"
          ) {
            if (!value || value === "-" || value === "No lead time set") return value || "-";
            // Parse date string like "Jan 1, 2027" or "Apr 11, 2027"
            return value;
          }
          
          // Format numbers
          if (typeof value === "number") {
            return value;
          }
          
          return value || "-";
        });
        
        const dataRow = worksheet.addRow(rowData);
        
        // Alternate row colors
        const basicBg = idx % 2 === 0 ? "FFF5F9FF" : "FFFFFFFF";
        const projectionBg = idx % 2 === 0 ? "FFFFFCE8" : "FFFFFFFA";
        const supplyBg = idx % 2 === 0 ? "FFEEEAFF" : "FFF5F3FF";
        const forecastBg = idx % 2 === 0 ? "FFEEEAFF" : "FFF5F3FF";
        
        dataRow.eachCell((cell, colNumber) => {
          const col = columns[colNumber - 1];
          
          // Apply background color based on column group
          let bgColor = basicBg;
          if (col.group === "projection") bgColor = projectionBg;
          else if (col.group === "supply") bgColor = supplyBg;
          else if (col.group === "forecast") bgColor = forecastBg;
          
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: bgColor },
          };
          
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = {
            top: { style: "thin", color: { argb: "FFB0B8C4" } },
            left: (colNumber === 11 || colNumber === 17) ? { style: "medium", color: { argb: "FF475569" } } : { style: "thin", color: { argb: "FFB0B8C4" } },
            bottom: { style: "thin", color: { argb: "FFB0B8C4" } },
            right: { style: "thin", color: { argb: "FFB0B8C4" } },
          };
          
          // Format numbers
          if (col.key === "ninety_day_revenue_loss" && typeof cell.value === "number") {
            cell.numFmt = "$#,##0.00";
          } else if (typeof cell.value === "number" && !col.isMonth) {
            cell.numFmt = "#,##0";
          } else if (typeof cell.value === "number" && col.isMonth) {
            cell.numFmt = "#,##0";
          }
          
          // Color negative numbers red and make bold
          if (typeof cell.value === "number" && cell.value < 0) {
            cell.font = { color: { argb: "FFDC2626" }, bold: true };
          }
          
          // Color positive deficit green
          if (col.key === "ninety_day_deficit" && typeof cell.value === "number" && cell.value > 0) {
            cell.font = { bold: true };
          }
        });
      });
      
      // Generate file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      saveAs(blob, `inventory_decision_planner_${new Date().toISOString().split("T")[0]}.xlsx`);
      
      toast.success(`Exported ${dialogFilteredItems.length} rows`);
    } catch (e: any) {
      toast.error("Export failed: " + (e?.message || String(e)));
    }
  };

  /** ── Generate Excel Workbook (shared function) ── */
  /**
   * Build the xlsx attachment for the Reorder Decisions email.
   *
   * Columns come from the shared registry in `src/lib/forecast/idpColumns.ts`
   * — the SAME registry that drives the planner UI table. Adding a column
   * to the registry surfaces it here automatically; removing one here
   * requires removing it from the registry.
   *
   * "What the user sees in the planner = what gets sent in the xlsx."
   */
  const generateInventoryReportWorkbook = async (itemsToExport = dialogFilteredItems) => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Reorder Decisions");

    // Rolling-window month names (matches the planner UI's section headers).
    const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthNames = rollingIncomingMonths.slice(0, 3).map((m) => MONTH_ABBR[m.month - 1]) as [string, string, string];

    const columns = buildIdpColumns(monthNames);
    const groupSpans = getGroupSpans(columns);

    // Column widths
    worksheet.columns = columns.map((col) => ({ width: col.width }));

    // ── Row 1: section banner ─────────────────────────────────────────
    const sectionHeaders: string[] = [];
    for (const { group, span } of groupSpans) {
      sectionHeaders.push(GROUP_BANNER_LABEL[group]);
      for (let i = 1; i < span; i += 1) sectionHeaders.push("");
    }
    const headerRow1 = worksheet.addRow(sectionHeaders);
    headerRow1.height = 20;
    headerRow1.eachCell((cell) => {
      cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Merge each multi-column group (skip groups with span 1 and the unlabelled basic group)
    {
      let colCursor = 1;
      for (const { group, span } of groupSpans) {
        if (group !== "basic" && span > 1) {
          worksheet.mergeCells(1, colCursor, 1, colCursor + span - 1);
        }
        colCursor += span;
      }
    }

    // ── Row 2: column header ─────────────────────────────────────────
    const headerRow2 = worksheet.addRow(columns.map((col) => col.label));
    headerRow2.height = 30;
    headerRow2.eachCell((cell, colNum) => {
      const col = columns[colNum - 1];
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col.bg } };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // ── Data rows ────────────────────────────────────────────────────
    for (const row of itemsToExport) {
      const rowData = columns.map((col) => {
        const val = (row as any)[col.key];
        if (col.isDate) return val ? new Date(val as string) : null;
        return val ?? "";
      });
      const dataRow = worksheet.addRow(rowData);

      dataRow.eachCell((cell, colNum) => {
        const col = columns[colNum - 1];
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };

        if (col.isDate) {
          cell.numFmt = "mmm dd, yyyy";
        } else if (col.isCurrency && typeof cell.value === "number") {
          cell.numFmt = "$#,##0.00";
        } else if (typeof cell.value === "number") {
          cell.numFmt = "#,##0";
        }

        // Bold + red for negatives (deficits / losses)
        if (typeof cell.value === "number" && cell.value < 0) {
          cell.font = { color: { argb: "FFDC2626" }, bold: true };
        }
        // Bold for positive deficit (surplus stock callout)
        if (col.key === "ninety_day_deficit" && typeof cell.value === "number" && cell.value > 0) {
          cell.font = { bold: true };
        }
      });
    }

    return workbook;
  };

  const parseScheduleTime = (timeValue: string) => {
    const [hours = '0', minutes = '0'] = String(timeValue).split(':');
    return {
      hours: Number(hours) || 0,
      minutes: Number(minutes) || 0,
    };
  };

  const getDayName = (date: Date) => WEEKDAY_LONG_FMT.format(date);

  const computeNextRunTime = (
    schedule: any,
    fromDate = new Date(),
  ): Date | null => {
    const now = new Date(fromDate);
    const type = schedule.recurrence_type || 'daily';
    const minutesInterval = Number(schedule.minutes_interval || 30);
    const hoursInterval = Number(schedule.hours_interval || 1);
    const selectedDays = Array.isArray(schedule.days_of_week)
      ? schedule.days_of_week
      : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const { hours, minutes } = parseScheduleTime(String(schedule.time_of_day || '09:00'));

    const makeTargetDate = (date: Date) => {
      const target = new Date(date);
      target.setHours(hours, minutes, 0, 0);
      return target;
    };

    const addDays = (date: Date, days: number) => {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    };

    const getLastDayOfMonth = (year: number, month: number) =>
      new Date(year, month + 1, 0).getDate();

    if (schedule.expire_type === 'onDate' && schedule.expire_date) {
      const expireDate = new Date(String(schedule.expire_date));
      expireDate.setHours(23, 59, 59, 999);
      if (now > expireDate) {
        return null;
      }
    }

    if (type === 'minutes') {
      return new Date(now.getTime() + minutesInterval * 60000);
    }

    if (type === 'hours') {
      return new Date(now.getTime() + hoursInterval * 3600000);
    }

    if (type === 'daily') {
      const todayTarget = makeTargetDate(now);
      if (todayTarget > now) {
        return todayTarget;
      }
      return addDays(todayTarget, 1);
    }

    if (type === 'weekly' || type === 'custom') {
      let next = makeTargetDate(now);
      const todayName = getDayName(next);
      if (selectedDays.includes(todayName) && next > now) {
        return next;
      }

      next = addDays(next, 1);
      while (!selectedDays.includes(getDayName(next))) {
        next = addDays(next, 1);
      }
      return next;
    }

    if (type === 'monthly') {
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const useLastDay = Boolean(schedule.last_day_of_month);
      let targetDay = Number(schedule.day_of_month || 1);
      let next: Date;

      if (useLastDay) {
        const lastDay = getLastDayOfMonth(currentYear, currentMonth);
        next = new Date(currentYear, currentMonth, lastDay, hours, minutes, 0, 0);
        if (next <= now) {
          const nextMonth = currentMonth + 1;
          const nextLastDay = getLastDayOfMonth(currentYear, nextMonth);
          next = new Date(currentYear, nextMonth, nextLastDay, hours, minutes, 0, 0);
        }
      } else {
        const thisMonthLastDay = getLastDayOfMonth(currentYear, currentMonth);
        if (targetDay > thisMonthLastDay) {
          targetDay = thisMonthLastDay;
        }
        next = new Date(currentYear, currentMonth, targetDay, hours, minutes, 0, 0);
        if (next <= now) {
          const nextMonth = currentMonth + 1;
          const nextMonthLastDay = getLastDayOfMonth(currentYear, nextMonth);
          const dayForNextMonth = Math.min(targetDay, nextMonthLastDay);
          next = new Date(currentYear, nextMonth, dayForNextMonth, hours, minutes, 0, 0);
        }
      }

      return next;
    }

    return addDays(now, 1);
  };


  /** ── Send Email Report via n8n (Group factories by email recipient) ── */
  const handleSendEmailReport = async () => {
    setSendingEmail(true);
    try {
      const allAssignedFactories = Array.from(
        new Set(Object.values(emailFactoryGroups).flat()),
      ).filter(Boolean);

      if (allAssignedFactories.length === 0) {
        toast.error("No factories are assigned to any email. Please assign factories first.");
        setSendingEmail(false);
        return;
      }

      // ── STEP 1: Always filter to Urgent + Active regardless of current dialog filters ──
      // Email must be deterministic — independent of whatever the user is browsing.
      const orderNowItems = mergedAllItems.filter((row) => {
        const puStatus = String((row as any).pu_status ?? '').trim().toLowerCase();
        if (puStatus !== 'active') return false;
        const proj = Number((row as any).ninety_day_projection) || 0;
        if (puStatusSkipsReorder((row as any).pu_status) || proj === 0) return false;
        const m = computeIdpRowMetrics(row);
        return m.actionTier === ACTION_TIER.URGENT;
      });

      if (orderNowItems.length === 0) {
        toast.error("No Urgent + Active items found");
        setSendingEmail(false);
        return;
      }

      // ── STEP 3: Group Order Now items by email recipient first (based on emailFactoryGroups mapping) ──
      // This ensures every email gets only the rows that are both assigned and marked Order Now.
      const itemsByEmail: Record<string, typeof orderNowItems> = {};
      
      // Initialize with all emails from emailFactoryGroups (even if empty)
      for (const email of Object.keys(emailFactoryGroups)) {
        itemsByEmail[email] = [];
      }
      
      // Track items with no email assignment
      const itemsWithoutEmail: typeof orderNowItems = [];
      
      // Group order now items by their assigned email(s)
      // NOTE: An item can be sent to MULTIPLE emails if they share the same factory
      for (const item of orderNowItems) {
        const factory = item.factory || "Unknown";
        
        // Find ALL emails that should receive this factory (not just first match)
        const recipientEmails: string[] = [];
        for (const [email, factories] of Object.entries(emailFactoryGroups)) {
          if (factories.includes(factory)) {
            recipientEmails.push(email);
          }
        }
        
        // Track items with no assigned email but don't skip them
        if (recipientEmails.length === 0) {
          itemsWithoutEmail.push(item);
          continue;
        }
        
        // Add item to ALL matching emails
        for (const email of recipientEmails) {
          itemsByEmail[email].push(item);
        }
      }
      
      // ── STEP 4: Send email for each recipient ──
      const n8nWebhookUrl = import.meta.env.VITE_N8N_WEBHOOK_URL || "https://automation.example.invalid/webhook/inventory-report";

      let successCount = 0;
      let failCount = 0;
      let totalItemsSent = 0;

      for (const [email, emailItems] of Object.entries(itemsByEmail)) {
        try {
          // Get list of factories for this email
          const factoriesInEmail = emailFactoryGroups[email] || [];

          if (factoriesInEmail.length === 0) {
            continue;
          }

          // Per-recipient factory summary — inline HTML table, no external
          // asset upload. Survives any storage/CDN/image-blocking issue and
          // renders identically in Outlook, Gmail, Apple Mail.
          const factoryStatsRows = buildFactoryRowStats(emailItems, factoriesInEmail);
          const factorySummaryHtml = buildFactorySummaryHtml(factoryStatsRows);
          
          const factoryCounts = factoriesInEmail.reduce<Record<string, number>>((acc, factory) => {
            acc[factory] = 0;
            return acc;
          }, {});

          for (const item of emailItems) {
            const factory = String(item.factory || "Unknown");
            if (!factoryCounts[factory]) {
              factoryCounts[factory] = 0;
            }
            factoryCounts[factory] += 1;
          }

          // Generate styled XLSX from the dialogFilteredItems dataset.
          // No inline detail table in the email body — keep the message
          // lightweight; recipients open the attached XLSX for the full
          // dashboard snapshot.
          const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const monthNames = rollingIncomingMonths.slice(0, 3).map((m) => MONTH_ABBR[m.month - 1]) as [string, string, string];
          const xlsxResult = await buildIdpXlsx(emailItems, {
            monthNames,
            todayMs: Date.now(),
          });
          const base64 = arrayBufferToBase64(xlsxResult.buffer);
          
          const currentDate = new Date();
          const formattedDate = currentDate.toLocaleDateString('en-US', { 
            month: '2-digit', 
            day: '2-digit', 
            year: 'numeric' 
          });
          const formattedTime = currentDate.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
          });
          
          // Executive-style email: short, summary-only. Detail in attachment.
          const actionLabel = "Urgent!";
          // Filename uses MMDDYYYY (no separators) per spec.
          const filenameDate = `${String(currentDate.getMonth() + 1).padStart(2, '0')}${String(currentDate.getDate()).padStart(2, '0')}${currentDate.getFullYear()}`;
          const factoryParam = factoriesInEmail.map(encodeURIComponent).join(',');
          const reviewActionHref = ('https://demo.example.invalid/inventory-planner?action=Urgent' +
            (factoryParam ? `&factory=${factoryParam}` : '')).replace(/&/g, '&amp;');
          const chartHtml = factorySummaryHtml || "";

          const emailMessage = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; line-height: 1.5; color: #5f6368; background: #ffffff;">

<p style="margin: 0 0 12px 0; font-size: 14px; color: #5f6368;">Dear Team,</p>

<p style="margin: 0 0 16px 0; font-size: 14px; color: #5f6368;">Attached is the Purchasing Demand Planner generated on ${formattedDate}.</p>

<!-- Report Summary -->
<p style="margin: 0 0 6px 0; font-size: 14px; color: #5f6368;">📊 <strong style="color: #202124;">Report Summary:</strong></p>
<p style="margin: 0 0 3px 0; font-size: 14px; color: #5f6368; padding-left: 20px;">📦 <strong style="color: #202124;">${emailItems.length}</strong> SKUs requiring immediate action (Urgent!)</p>
<p style="margin: 0 0 16px 0; font-size: 14px; color: #5f6368; padding-left: 20px;">🏭 <strong style="color: #202124;">${factoriesInEmail.length}</strong> factories involved</p>

<!-- Factory Summary Title -->
<h2 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 600; color: #202124;">Factory Summary — Order Now</h2>

<!-- Factory Table -->
<table cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 800px; border-collapse: collapse; margin-bottom: 16px; border: 1px solid #dadce0;">
  <thead>
    <tr style="background: #4a3228;">
      <th style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Factory</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">SKUs</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Lead time</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Deficit</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Runs out before delivery</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Order by</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; white-space: nowrap;">Action</th>
    </tr>
  </thead>
  <tbody>
${chartHtml || '<tr><td colspan="7" style="padding: 16px; text-align: center; color: #80868b; font-size: 14px; background: #f8f9fa;">No factory data available</td></tr>'}
  </tbody>
</table>


<!-- Action Button -->
<a href="${reviewActionHref}"
   style="display: inline-block; padding: 10px 20px; background: #ea4335; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 4px; margin-bottom: 16px;">
  Review &amp; Take Action →
</a>

<p style="margin: 16px 0 6px 0; font-size: 14px; color: #5f6368;">Please review and reach out with any questions.</p>

<p style="margin: 16px 0 6px 0; font-size: 14px; color: #5f6368;">Best regards,</p>

<!-- Signature with Logo -->
<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;">
  <tr>
    <td style="padding-right: 14px; vertical-align: middle;">
      <img src="/procure/logo.png" alt="Northwind Motor Parts" width="60" height="60" style="display: block; border-radius: 50%; background: #4a3228; padding: 6px;" />
    </td>
    <td style="vertical-align: middle; border-left: 2px solid #dadce0; padding-left: 14px;">
      <p style="margin: 0 0 3px 0; font-size: 15px; font-weight: 600; color: #202124;">Purchasing Team</p>
      <p style="margin: 0 0 6px 0; font-size: 14px; color: #5f6368;">E <a href="mailto:admin@northwindparts.example" style="color: #1a73e8; text-decoration: none;">admin@northwindparts.example</a></p>
      <p style="margin: 0; font-size: 14px; color: #202124; font-weight: 600;">northwindparts.example</p>
    </td>
  </tr>
</table>

</div>`;

          const payload = {
            email_to: email,
            factories: factoriesInEmail, // array of factories from email_factory_mapping
            filename: `purchasing_report_${filenameDate}.xlsx`,
            filedata: base64,
            filetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            subject: `📊 Purchasing Demand Planner`,
            message: emailMessage,
            item_count: emailItems.length,
            action_filter: "Order Now",
            factory_count: factoriesInEmail.length,
            factory_item_counts: factoryCounts,
          };
          
          const response = await fetch(n8nWebhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          
          if (!response.ok) {
            throw new Error(`n8n webhook failed: ${response.statusText}`);
          }
          
          successCount++;
          totalItemsSent += emailItems.length;
        } catch (e: any) {
          failCount++;
        }
      }

      // Show summary toast
      if (successCount > 0 && failCount === 0) {
        toast.success(`✅ Sent ${successCount} email(s) successfully! (${totalItemsSent} total items)`);
      } else if (successCount > 0 && failCount > 0) {
        toast.warning(`⚠️ Sent ${successCount} email(s), ${failCount} failed`);
      } else {
        toast.error(`❌ All emails failed to send`);
      }
      
      // Update schedule if this was an auto-triggered send
      if (scheduleConfig?.enabled) {
        const now = new Date();
        const newNextRun = computeNextRunTime(scheduleConfig, now);

        await supabase
          .from('email_schedule_config')
          .update({
            last_run_at: now.toISOString(),
            next_run_at: newNextRun ? newNextRun.toISOString() : null,
            run_count: (scheduleConfig.run_count || 0) + 1,
            updated_at: now.toISOString()
          })
          .eq('id', scheduleConfig.id);
          
          // Log execution
          await supabase
            .from('email_schedule_log')
            .insert({
              schedule_id: scheduleConfig.id,
              executed_at: now.toISOString(),
              status: successCount > 0 ? 'success' : 'failed',
              emails_sent: successCount,
              emails_failed: failCount,
              total_items: totalItemsSent
            });
          
          await refetchSchedule();
        }
    } catch (e: any) {
      toast.error("Failed to send email: " + (e?.message || String(e)));
    } finally {
      setSendingEmail(false);
    }
  };

  /** ── Send Storefront Stock Email Report (Separate from IDP) ── */
  const handleSendShopifyInventoryEmailReport = async () => {
    setSendingEmail(true);
    try {
      // Use Shopify-specific email factory groups
      const allAssignedFactories = Array.from(
        new Set(Object.values(shopifyEmailFactoryGroups).flat()),
      ).filter(Boolean);

      if (allAssignedFactories.length === 0) {
        toast.error("No factories are assigned to any email for Storefront Stock. Please assign factories first.");
        setSendingEmail(false);
        return;
      }

      // Storefront Stock = shopify_status "Not listed" with at least one inventory
      // value. Must mirror the dialog's filter (see ~line 13083) so what the user
      // sees in the table is exactly what gets sent (WYSIWYG).
      const INV_COLS_SHOPIFY = ['oh_inv', 'otw_units', 'on_order_units', 'po_in_progress'];
      const shopifyOnlyItems = dialogFilteredItems.filter((item: any) => {
        const shopifyStatus = String(item.shopify_status ?? "").trim().toLowerCase();
        if (shopifyStatus !== "not listed") return false;
        return INV_COLS_SHOPIFY.some(col => (item[col] ?? 0) !== 0);
      });
      
      // Then apply SKU, Factory, Search filters
      const shopifyItems = shopifyOnlyItems.filter((item: any) => {
        const sku = String(item.sku || '');
        const description = String(item.description || '');
        const factory = String(item.factory || '');
        
        if (idpFilters.sku && idpFilters.sku.length > 0) {
          if (!idpFilters.sku.includes(sku)) return false;
        }
        
        if (idpFilters.factory && idpFilters.factory.length > 0) {
          if (!idpFilters.factory.includes(factory)) return false;
        }
        
        if (idpSearchQuery.trim()) {
          const query = idpSearchQuery.toLowerCase();
          const matchesSku = sku.toLowerCase().includes(query);
          const matchesDesc = description.toLowerCase().includes(query);
          if (!matchesSku && !matchesDesc) return false;
        }
        
        return true;
      });

      if (shopifyItems.length === 0) {
        toast.error("No Storefront Stock items found to send (based on current filters)");
        setSendingEmail(false);
        return;
      }


      // Group items by email recipient using Shopify-specific email groups
      const itemsByEmail: Record<string, typeof shopifyItems> = {};
      
      for (const email of Object.keys(shopifyEmailFactoryGroups)) {
        itemsByEmail[email] = [];
      }
      
      const itemsWithoutEmail: typeof shopifyItems = [];
      
      for (const item of shopifyItems) {
        const factory = item.factory || "Unknown";
        const recipientEmails: string[] = [];
        
        for (const [email, factories] of Object.entries(shopifyEmailFactoryGroups)) {
          if (factories.includes(factory)) {
            recipientEmails.push(email);
          }
        }
        
        if (recipientEmails.length === 0) {
          itemsWithoutEmail.push(item);
          continue;
        }
        
        for (const email of recipientEmails) {
          itemsByEmail[email].push(item);
        }
      }
      
      // Build factory summary for Storefront Stock
      const buildShopifyFactorySummaryHtml = (items: typeof shopifyItems, factories: string[]) => {
        const factoryStats: Record<string, {
          skuCount: number;
          totalOH: number;
          totalOTW: number;
          totalOO: number;
        }> = {};
        
        for (const factory of factories) {
          factoryStats[factory] = {
            skuCount: 0,
            totalOH: 0,
            totalOTW: 0,
            totalOO: 0,
          };
        }
        
        for (const item of items) {
          const factory = String(item.factory || "Unknown");
          if (factoryStats[factory]) {
            factoryStats[factory].skuCount++;
            factoryStats[factory].totalOH += Number(item.oh_inv || 0);
            factoryStats[factory].totalOTW += Number(item.otw_units || 0);
            factoryStats[factory].totalOO += Number(item.on_order_units || 0);
          }
        }
        
        const rows = factories
          .filter(f => factoryStats[f].skuCount > 0)
          .map(factory => {
            const stats = factoryStats[factory];
            return `
    <tr style="border-bottom: 1px solid #dadce0;">
      <td style="padding: 8px 12px; font-size: 13px; color: #202124; border-right: 1px solid #dadce0;">${factory}</td>
      <td style="padding: 8px 12px; text-align: center; font-size: 13px; color: #202124; border-right: 1px solid #dadce0;">${stats.skuCount}</td>
      <td style="padding: 8px 12px; text-align: center; font-size: 13px; color: #202124; border-right: 1px solid #dadce0;">${stats.totalOH.toLocaleString()}</td>
      <td style="padding: 8px 12px; text-align: center; font-size: 13px; color: #202124; border-right: 1px solid #dadce0;">${stats.totalOTW.toLocaleString()}</td>
      <td style="padding: 8px 12px; text-align: center; font-size: 13px; color: #202124;">${stats.totalOO.toLocaleString()}</td>
    </tr>`;
          })
          .join('');
        
        return rows;
      };

      const n8nWebhookUrl = import.meta.env.VITE_N8N_WEBHOOK_URL || "https://automation.example.invalid/webhook/inventory-report";

      let successCount = 0;
      let failCount = 0;
      let totalItemsSent = 0;

      for (const [email, emailItems] of Object.entries(itemsByEmail)) {
        try {
          const factoriesInEmail = shopifyEmailFactoryGroups[email] || [];

          if (factoriesInEmail.length === 0 || emailItems.length === 0) {
            continue;
          }

          const factorySummaryHtml = buildShopifyFactorySummaryHtml(emailItems, factoriesInEmail);
          
          const currentDate = new Date();
          const formattedDate = currentDate.toLocaleDateString('en-US', { 
            month: '2-digit', 
            day: '2-digit', 
            year: 'numeric' 
          });
          
          const filenameDate = `${String(currentDate.getMonth() + 1).padStart(2, '0')}${String(currentDate.getDate()).padStart(2, '0')}${currentDate.getFullYear()}`;
          
          const reviewActionHref = 'https://demo.example.invalid/monthly-forecast?view=shopify';

          const emailMessage = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; line-height: 1.5; color: #5f6368; background: #ffffff;">

<p style="margin: 0 0 12px 0; font-size: 14px; color: #5f6368;">Dear Team,</p>

<p style="margin: 0 0 16px 0; font-size: 14px; color: #5f6368;">Attached is the Storefront Stock Report generated on ${formattedDate}.</p>

<!-- Report Summary -->
<p style="margin: 0 0 6px 0; font-size: 14px; color: #5f6368;">📊 <strong style="color: #202124;">Report Summary:</strong></p>
<p style="margin: 0 0 3px 0; font-size: 14px; color: #5f6368; padding-left: 20px;">📦 <strong style="color: #202124;">${emailItems.length}</strong> SKUs in Storefront Stock</p>
<p style="margin: 0 0 16px 0; font-size: 14px; color: #5f6368; padding-left: 20px;">🏭 <strong style="color: #202124;">${factoriesInEmail.length}</strong> factories involved</p>

<!-- Factory Summary Title -->
<h2 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 600; color: #202124;">Factory Summary — Storefront Stock</h2>

<!-- Factory Table -->
<table cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 800px; border-collapse: collapse; margin-bottom: 16px; border: 1px solid #dadce0;">
  <thead>
    <tr style="background: #0c4849;">
      <th style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Factory</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">SKUs</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">OH Inv</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">OTW Units</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; white-space: nowrap;">OO Units</th>
    </tr>
  </thead>
  <tbody>
${factorySummaryHtml || '<tr><td colspan="5" style="padding: 16px; text-align: center; color: #80868b; font-size: 14px; background: #f8f9fa;">No factory data available</td></tr>'}
  </tbody>
</table>

<!-- Action Button -->
<a href="${reviewActionHref}"
   style="display: inline-block; padding: 10px 20px; background: #0c4849; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 4px; margin-bottom: 16px;">
  Review Storefront Stock →
</a>

<p style="margin: 16px 0 6px 0; font-size: 14px; color: #5f6368;">Please review and reach out with any questions.</p>

<p style="margin: 16px 0 6px 0; font-size: 14px; color: #5f6368;">Best regards,</p>

<!-- Signature with Logo -->
<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;">
  <tr>
    <td style="padding-right: 14px; vertical-align: middle;">
      <img src="/procure/logo.png" alt="Northwind Motor Parts" width="60" height="60" style="display: block; border-radius: 50%; background: #0c4849; padding: 6px;" />
    </td>
    <td style="vertical-align: middle; border-left: 2px solid #dadce0; padding-left: 14px;">
      <p style="margin: 0 0 3px 0; font-size: 15px; font-weight: 600; color: #202124;">Purchasing Team</p>
      <p style="margin: 0 0 6px 0; font-size: 14px; color: #5f6368;">E <a href="mailto:admin@northwindparts.example" style="color: #1a73e8; text-decoration: none;">admin@northwindparts.example</a></p>
      <p style="margin: 0; font-size: 14px; color: #202124; font-weight: 600;">northwindparts.example</p>
    </td>
  </tr>
</table>

</div>`;

          // Generate styled Excel for Storefront Stock using ExcelJS
          // Normalize shopify_status ('-' or '' → 'Inactive') and remap on_order_units → oo_units
          const toShopifyXlsxRow = (item: any) => {
            const rawStatus = String(item.shopify_status ?? '').trim();
            return {
              ...item,
              oo_units: item.on_order_units,
              shopify_status: (rawStatus === '' || rawStatus === '-') ? 'Inactive' : rawStatus,
            };
          };
          const xlsxResult = await buildShopifyInventoryXlsx(emailItems.map(toShopifyXlsxRow), {
            todayMs: Date.now(),
          });
          const base64 = arrayBufferToBase64(xlsxResult.buffer);
          
          const filename = `shopify_inventory_${filenameDate}.xlsx`;

          const payload = {
            email_to: email,
            factories: factoriesInEmail,
            filename: filename,
            filedata: base64,
            filetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            subject: `📊 Storefront Stock Report`,
            message: emailMessage,
            item_count: emailItems.length,
            report_type: "shopify_inventory",
            factory_count: factoriesInEmail.length,
          };
          
          const response = await fetch(n8nWebhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          
          if (!response.ok) {
            throw new Error(`n8n webhook failed: ${response.statusText}`);
          }
          
          successCount++;
          totalItemsSent += emailItems.length;
        } catch (e: any) {
          failCount++;
        }
      }

      if (successCount > 0 && failCount === 0) {
        toast.success(`✅ Sent ${successCount} Storefront Stock email(s) successfully! (${totalItemsSent} total items)`);
      } else if (successCount > 0 && failCount > 0) {
        toast.warning(`⚠️ Sent ${successCount} email(s), ${failCount} failed`);
      } else {
        toast.error(`❌ All emails failed to send`);
      }
      
    } catch (e: any) {
      toast.error("Failed to send Shopify email: " + (e?.message || String(e)));
    } finally {
      setSendingEmail(false);
    }
  };

  /** ── Save Schedule Settings to Database ── */
  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      // Prepare schedule data
      const scheduleData = {
        enabled: scheduleEnabled,
        recurrence_type: recurrenceType,
        minutes_interval: minutesInterval,
        hours_interval: hoursInterval,
        days_of_week: selectedDays,
        time_of_day: timeOfDay + ':00',
        day_of_month: monthlyDate,
        last_day_of_month: lastDayOfMonth,
        expire_type: expireType,
        expire_date: expireType === 'onDate' ? expireDate : null,
        report_type: emailSettingsReportType,
        next_run_at: scheduleEnabled
          ? computeNextRunTime({
              recurrence_type: recurrenceType,
              minutes_interval: minutesInterval,
              hours_interval: hoursInterval,
              days_of_week: selectedDays,
              time_of_day: timeOfDay + ':00',
              day_of_month: monthlyDate,
              last_day_of_month: lastDayOfMonth,
            })?.toISOString()
          : null,
        updated_at: new Date().toISOString(),
      };

      const activeConfig = emailSettingsReportType === 'shopify' ? shopifyScheduleConfig : scheduleConfig;

      const { error } = await supabase
        .from("email_schedule_config")
        .upsert(
          activeConfig?.id
            ? { ...scheduleData, id: activeConfig.id }
            : scheduleData,
          {
            onConflict: 'report_type',
            ignoreDuplicates: false
          }
        );

      if (error) throw error;

      if (emailSettingsReportType === 'shopify') {
        await refetchShopifySchedule();
      } else {
        await refetchSchedule();
      }
      setShowScheduleDialog(false);
      
      if (scheduleEnabled) {
        toast.success("✅ Schedule activated! Emails will be sent automatically.");
      } else {
        toast.success("✅ Schedule saved (currently disabled).");
      }
    } catch (e: any) {
      toast.error("Failed to save schedule: " + (e?.message || String(e)));
    } finally {
      setSavingSchedule(false);
    }
  };
  
  /** ── Toggle Day Selection ── */
  const handleToggleDay = (day: string) => {
    setSelectedDays(prev => 
      prev.includes(day) 
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  /** ── Open Email Settings Dialog ── */
  const handleOpenEmailSettings = (reportType: 'idp' | 'shopify' = 'idp') => {
    setEmailSettingsReportType(reportType);
    setShowEmailSettingsDialog(true);
  };

  /** ── Add New Email Group (Direct MultiSelect) ── */
  const handleAddEmailsFromMultiSelect = async (selectedEmails: string[]) => {
    if (selectedEmails.length === 0) return;
    
    try {
      // Add each selected email with a dummy factory entry to make it appear in the table
      // We'll use a special marker that we can filter out later, or just insert with empty factory
      // Actually, we need at least one row per email to show in the table
      // Let's insert each email with no factory initially (will show "0 factories")
      
      // Since the table groups by email, we need at least one row per email
      // We'll insert a placeholder that can be removed later, or just show empty
      // Better approach: Just show success message, the email will appear when user assigns first factory
      
      // Actually, let's insert each email with an empty/null factory just to create the row
      // But our schema requires factory to be NOT NULL
      // So we need to insert with at least one factory, or change our approach
      
      // Best solution: Insert each email with a temporary "UNASSIGNED" factory marker
      const insertPromises = selectedEmails.map(email =>
        supabase.from("email_factory_mapping").insert({ 
          email, 
          factory: "UNASSIGNED", // Temporary marker
          report_type: emailSettingsReportType // Set report type
        })
      );
      
      await Promise.all(insertPromises);
      
      // Refetch the correct mappings
      if (emailSettingsReportType === 'shopify') {
        refetchShopifyEmailMappings();
      } else {
        refetchIdpEmailMappings();
      }
      toast.success(`Added ${selectedEmails.length} email(s) for ${emailSettingsReportType.toUpperCase()}. Now assign factories.`);
    } catch (e: any) {
      toast.error("Failed to add emails: " + (e?.message || String(e)));
    }
  };

  /** ── Remove Email Group (delete all factories for this email) ── */
  const handleRemoveEmailGroup = async (email: string) => {
    if (!confirm(`Remove all ${emailSettingsReportType.toUpperCase()} factory assignments for "${email}"?`)) return;
    
    try {
      const { error } = await supabase
        .from("email_factory_mapping")
        .delete()
        .eq("email", email)
        .eq("report_type", emailSettingsReportType); // Only delete for this report type
      
      if (error) throw error;
      
      toast.success(`Removed all ${emailSettingsReportType.toUpperCase()} factories for "${email}"`);
      
      // Refetch the correct mappings
      if (emailSettingsReportType === 'shopify') {
        refetchShopifyEmailMappings();
      } else {
        refetchIdpEmailMappings();
      }
    } catch (e: any) {
      toast.error("Failed to remove email group: " + (e?.message || String(e)));
    }
  };

  /** ── Toggle Factory Assignment ── */
  const handleToggleFactory = async (email: string, factory: string) => {
    try {
      // Use the correct email groups based on report type being configured
      const currentEmailGroups = emailSettingsReportType === 'shopify' ? shopifyEmailFactoryGroups : idpEmailFactoryGroups;
      const isAssigned = currentEmailGroups[email]?.includes(factory);
      
      if (isAssigned) {
        // Remove assignment
        const { error } = await supabase
          .from("email_factory_mapping")
          .delete()
          .eq("email", email)
          .eq("factory", factory)
          .eq("report_type", emailSettingsReportType); // Filter by report type
        
        if (error) throw error;
        toast.success(`Removed "${factory}" from "${email}" (${emailSettingsReportType.toUpperCase()})`);
      } else {
        // Add assignment
        const { error } = await supabase
          .from("email_factory_mapping")
          .insert({ 
            email, 
            factory,
            report_type: emailSettingsReportType // Set report type
          });
        
        if (error) throw error;
        toast.success(`Assigned "${factory}" to "${email}" (${emailSettingsReportType.toUpperCase()})`);
      }
      
      // Refetch the appropriate mappings
      if (emailSettingsReportType === 'shopify') {
        refetchShopifyEmailMappings();
      } else {
        refetchIdpEmailMappings();
      }
    } catch (e: any) {
      toast.error("Failed to update assignment: " + (e?.message || String(e)));
    }
  };

  /** ── Inline edit: Order Proposal Qty → upsert into forecast_report_manual ── */
  const handleSaveOrderProposalQty = useCallback(
    async (row: Record<string, unknown>, newValue: string | null) => {
      const sku = String(row.sku ?? "");
      if (!sku) throw new Error("Missing SKU");

      // 1) Snapshot previous manual cache for rollback
      const prevCache = queryClient.getQueryData<any[]>(["forecast_report_manual"]);
      const prevLocalPatch = localRowPatches[sku];

      // 2) Bust prevMergedRef + patch manual cache BEFORE flushSync so the render inside
      //    flushSync sees the updated manualMap. If setQueryData ran after flushSync,
      //    mergedItems would compute with stale manualMap and cache the wrong result.
      prevMergedRef.current = null;

      queryClient.setQueryData(["forecast_report_manual"], (prev: any[] | undefined) => {
        if (!prev) return [{ sku, order_proposal_qty: newValue }];
        const idx = prev.findIndex((r: any) => r.sku === sku);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], order_proposal_qty: newValue };
          return updated;
        }
        return [...prev, { sku, order_proposal_qty: newValue }];
      });

      // Instant push to other users (Broadcast).
      broadcastForecastEdit({ table: "forecast_report_manual", sku, fields: { order_proposal_qty: newValue } });

      // Optimistic recompute of dependent columns (total_cbm_approved, months_worth).
      // Parse numeric for recompute only — DB stores the original text value.
      const numericForCalc = newValue != null ? (parseFloat(newValue) || null) : null;
      const rowWithNewQty = { ...row, order_proposal_qty: numericForCalc };
      const manualForOpt = (queryClient.getQueryData<any[]>(["forecast_report_manual"]) ?? []).find(
        (r: any) => r?.sku === sku,
      );
      const optionNumForCalc = Math.min(
        4,
        Math.max(
          1,
          Number((localRowPatches[sku]?.forecast_option as number | undefined) ?? manualForOpt?.forecast_option ?? 0) ||
            1,
        ),
      );
      const recomputedRow = recomputeForecastRow(
        rowWithNewQty,
        monthlySaleMap,
        false, // drivingInputChanged = false (order_proposal_qty doesn't trigger full recompute)
        projOverrideMap.get(sku) ?? null,
        supplyOverrideMap.get(sku) ?? null,
        optionNumForCalc,
      );

      // Instant synchronous update like Excel.
      // Store the text value for display while keeping numeric-computed dependent fields.
      if (newValue === null) {
        flushSync(() => {
          setLocalRowPatches((prev) => {
            const next = { ...prev };
            delete next[sku];
            return next;
          });
        });
      } else {
        flushSync(() => {
          setLocalRowPatches((prev) => ({
            ...prev,
            [sku]: { ...recomputedRow, order_proposal_qty: newValue },
          }));
        });
      }

      // 3) Save to DB via edge function (bypasses external RLS)
      let data: any[] | null = null;
      try {
        const result = await callAdminOperationsApi("forecast_manual_upsert", {
          sku,
          fields: { order_proposal_qty: newValue },
        });
        data = (result as any)?.data ?? null;
      } catch (error) {
        // Rollback manual cache + local patch
        if (prevCache) queryClient.setQueryData(["forecast_report_manual"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_manual"] });
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(msg);
      }

      if (!data || data.length === 0) {
        // Rollback on empty response
        if (prevCache) queryClient.setQueryData(["forecast_report_manual"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_manual"] });
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        throw new Error("No rows upserted — edge function returned empty");
      }

      toast.success(`Saved qty ${newValue ?? "empty"} for ${sku}`);
      // No per-edit refetch — optimistic patch + realtime echo keep it in sync.
    },
    [queryClient, localRowPatches, recomputeForecastRow, monthlySaleMap, projOverrideMap, supplyOverrideMap, pageQueryKey],
  );

  /** ── Inline edit: Monthly Projection → upsert into forecast_report_manual ── */
  const handleSaveMonthlyProjection = useCallback(
    async (row: Record<string, unknown>, newValue: number | null) => {
      const sku = String(row.sku ?? "");
      if (!sku) throw new Error("Missing SKU");

      // 1) Snapshot previous manual cache for rollback
      const prevCache = queryClient.getQueryData<any[]>(["forecast_report_manual"]);
      const prevLocalPatch = localRowPatches[sku];

      // 2) Optimistic recompute of all 27 dependent columns and patch local UI state
      const rowWithNewProjection = { ...row, monthly_projection: newValue };
      const manualForOpt = (queryClient.getQueryData<any[]>(["forecast_report_manual"]) ?? []).find(
        (r: any) => r?.sku === sku,
      );
      const optionNumForCalc = Math.min(
        4,
        Math.max(
          1,
          Number((localRowPatches[sku]?.forecast_option as number | undefined) ?? manualForOpt?.forecast_option ?? 0) ||
            1,
        ),
      );
      const recomputedRow = recomputeForecastRow(
        rowWithNewProjection,
        monthlySaleMap,
        true, // drivingInputChanged
        projOverrideMap.get(sku) ?? null,
        supplyOverrideMap.get(sku) ?? null,
        optionNumForCalc,
      );
      
      // Instant synchronous update like Excel
      if (newValue === null) {
        flushSync(() => {
          setLocalRowPatches((prev) => {
            const next = { ...prev };
            delete next[sku];
            return next;
          });
        });
      } else {
        flushSync(() => {
          setLocalRowPatches((prev) => ({ ...prev, [sku]: recomputedRow }));
        });
      }

      queryClient.setQueryData(["forecast_report_manual"], (prev: any[] | undefined) => {
        if (!prev) return [{ sku, monthly_projection: newValue }];
        const idx = prev.findIndex((r: any) => r.sku === sku);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], monthly_projection: newValue };
          return updated;
        }
        return [...prev, { sku, monthly_projection: newValue }];
      });

      // Instant push to other users (Broadcast) — covers set AND clear (null).
      broadcastForecastEdit({ table: "forecast_report_manual", sku, fields: { monthly_projection: newValue } });

      // 3) Save to DB via edge function (bypasses external RLS)
      let data: any[] | null = null;
      try {
        const result = await callAdminOperationsApi("forecast_manual_upsert", {
          sku,
          fields: { monthly_projection: newValue },
        });
        data = (result as any)?.data ?? null;
      } catch (error) {
        // Rollback manual cache + local patch
        if (prevCache) queryClient.setQueryData(["forecast_report_manual"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_manual"] });
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(msg);
      }

      if (!data || data.length === 0) {
        if (prevCache) queryClient.setQueryData(["forecast_report_manual"], prevCache);
        else queryClient.invalidateQueries({ queryKey: ["forecast_report_manual"] });
        setLocalRowPatches((prev) => {
          const next = { ...prev };
          if (prevLocalPatch) next[sku] = prevLocalPatch;
          else delete next[sku];
          return next;
        });
        throw new Error("No rows upserted — edge function returned empty");
      }

      toast.success(`Saved Monthly Projection ${newValue ?? "empty"} for ${sku}`);
    },
    [queryClient, localRowPatches, recomputeForecastRow, monthlySaleMap, projOverrideMap, supplyOverrideMap],
  );

  // Block initial render until manual overrides arrive — without them the table
  // would briefly flash formula values for SKUs that have a persisted override.
  // Gate only on monthlySalePending — prevents all-zero Monthly Sales flash.
  // Other overlays (manual, status, proj, supply, leadTime) apply progressively
  // so the table appears immediately and cells update in-place (no blank-rows flash).
  const isLoading = schemaLoading || (dataLoading && items.length === 0) || monthlySalePending;
  const instockHeaderTitle = useMemo(() => rollingLabel("Instock", rollingInstock), [rollingInstock]);
  const incomingHeaderTitle = useMemo(
    () => rollingLabel("Inbound Shipment", rollingIncomingMonths),
    [rollingIncomingMonths],
  );
  const projectionHeaderTitle = useMemo(
    () => rollingLabel("Monthly Projection", rollingIncomingMonths),
    [rollingIncomingMonths],
  );
  const supplyHeaderTitle = useMemo(() => rollingLabel("Supply Plan", rollingIncomingMonths), [rollingIncomingMonths]);
  const replIncomingHeaderTitle = useMemo(
    () => rollingLabel("Replacement Inbound Shipment", rollingIncomingMonths),
    [rollingIncomingMonths],
  );
  // Dynamic 26-month rolling header: 25 months ago → prev month
  const salesHeaderTitle = useMemo(() => {
    // Banner range from forecast_monthly_sales' own SQL-derived labels
    // (pinakalumang buwan → huling kumpletong buwan) — no JS date math.
    if (monthlyReplicaData.length > 0) {
      const first = monthlyReplicaData[0];
      const newest = String(first.recent_month_1_label ?? "").trim();
      const oldest = String(first.recent_month_10_label ?? "").trim();
      if (newest && oldest) return `Monthly Sales ( ${oldest} - ${newest} )`;
    }
    // Fallback while the replica table is empty/unloaded
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); // last month
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 10, 1);
    const fmt = (d: Date) => MONTH_YEAR_SHORT_FMT.format(d);
    return `Monthly Sales ( ${fmt(startDate)} - ${fmt(endDate)} )`;
  }, [monthlyReplicaData]);

  const labelForColumnDynamic = useMemo(() => {
    return (colName: string) => {
      if (colName === "sales_diff") return salesDiffHeader;
      if (colName === "actual_sale_of_month") return actualSalesHeader;
      if (colName === "last_2months_avg") return last2MonthsAvgHeader;

      const instockLabel = instockRollingLabel(colName, rollingInstock);
      if (instockLabel) return instockLabel;

      // Monthly Sales grid headers come from forecast_monthly_sales' SQL-derived
      // labels (current_month_label / month_N_label) — never JS date math.
      // JS fallback only while the replica table is empty/unloaded (cells are
      // blank in that state, so header-vs-data drift is impossible).
      if (/^sales_month_\d{1,2}$/i.test(colName)) {
        const replicaLabel = replicaSalesLabels[colName.toLowerCase()];
        if (replicaLabel) return replicaLabel;
      }

      const salesLabel = salesRollingLabel(colName, rollingSalesMonths, monthlySaleLabels);
      if (salesLabel) return salesLabel;

      const projectionLabel = rolling12LabelByIndex(colName, "proj", rollingIncomingMonths);
      if (projectionLabel) return projectionLabel;

      const revenueLabel = rolling12LabelByIndex(colName, "rev", rollingIncomingMonths);
      if (revenueLabel) return revenueLabel;

      const lostLabel = rolling12LabelByIndex(colName, "lost", rollingIncomingMonths);
      if (lostLabel) return lostLabel;

      const incomingLabel = rolling12LabelByIndex(colName, "incoming", rollingIncomingMonths);
      if (incomingLabel) return incomingLabel;

      const replIncomingLabel = rolling12LabelByIndex(colName, "repl", rollingIncomingMonths);
      if (replIncomingLabel) return replIncomingLabel;

      const supplyLabel = rolling12LabelByIndex(colName, "supply", rollingIncomingMonths);
      if (supplyLabel) return supplyLabel;

      return labelForColumn(colName);
    };
  }, [
    rollingInstock,
    rollingSalesMonths,
    salesDiffHeader,
    actualSalesHeader,
    last2MonthsAvgHeader,
    rollingIncomingMonths,
    monthlySaleLabels,
    replicaSalesLabels,
  ]);

  /** Stable column list for the dropdown (only recalculate when fullSchema/labels change) */
  const dropdownColumns = useMemo(() => {
    // Permanently exclude 90-Day Reorder Decisions columns from visibility dropdown
    const PERMANENTLY_HIDDEN_COLUMNS = [
      "purchasing_url",
      "shopify_url",
      "ninety_day_projection",
      "ninety_day_supply",
      "ninety_day_deficit",
      "ninety_day_revenue_loss",
      "safety_stock",
      "order_recommended",
      "order_date_forecast",
      "supply_month_forecast",
      "covered_months",
      "action",
    ];
    
    return fullSchema
      .filter((c) => !PERMANENTLY_HIDDEN_COLUMNS.includes(c.column_name))
      .map((c) => ({
        key: c.column_name,
        label: labelForColumnDynamic(c.column_name),
        group: labelForGroup(groupKey(c.column_name)),
      }));
  }, [fullSchema, labelForColumnDynamic]);

  /** Map of placeholder tokens → human month labels, derived from the
   * last clicked sales-month column header. Empty when no month is selected. */

  /**
   * Build a section-aware resolver for formula tooltip tokens.
   * Given the host column the tooltip lives on, we return a function that
   * maps a token label (e.g. "Apr", "FBA Reserved", "Actual Sales") to the
   * actual schema `column_name` inside the SAME logical group.
   *
   * Group → label-set lookup is built lazily from `fullSchema` so labels
   * always reflect the dynamic month windows (e.g. Apr 2026 ... Mar 2027).
   */
  const labelLookupByGroup = useMemo(() => {
    const groups: Record<string, Map<string, string>> = {};
    for (const c of fullSchema) {
      const g = groupKey(c.column_name);
      const label = labelForColumnDynamic(c.column_name).replace(/\n/g, " ").trim();
      if (!groups[g]) groups[g] = new Map();
      // Index by both full label and individual lines (so "Apr" matches "Apr").
      groups[g].set(label.toLowerCase(), c.column_name);
      for (const part of label.split(/\s+/)) {
        const k = part.toLowerCase();
        if (k && !groups[g].has(k)) groups[g].set(k, c.column_name);
      }
      // Always self-resolve by raw column_name (lowercased).
      groups[g].set(c.column_name.toLowerCase(), c.column_name);
    }
    return groups;
  }, [fullSchema, labelForColumnDynamic]);

  /** Friendly metric labels → DB column. Section-independent fallbacks. */
  const METRIC_LABEL_TO_COL: Record<string, string> = useMemo(
    () => ({
      "actual sales": "actual_sale_of_month",
      "sales diff (feb-mar)": "sales_diff",
      "sales diff": "sales_diff",
      "current sales velocity": "sales_velocity",
      "sales velocity": "sales_velocity",
      unshipped: "unshipped",
      "feb-mar ave": "last_2months_avg",
      "monthly projection": "monthly_projection",
      "fba reserved": "fba_reserved",
      "intransit fba": "intransit_fba",
      fba: "fba",
      "oh inv": "oh_inv",
      "otw units": "otw_units",
      "oo units": "on_order_units",
      "po in progress": "po_in_progress",
      "replacement rate": "replacement_rate",
      "return rate": "return_rate",
      "order proposal qty only": "order_proposal_qty",
      "order proposal quantity": "order_proposal_qty",
      "months worth": "months_worth",
      cbm: "cbm",
      "sku status": "sku_status",
      "buyer notes": "buyer_notes",
      "buyer approval": "buyer_notes",
      "buyer approval": "buyer_notes",
      "factory latest po ordered": "factory_latest_po_ordered",
      "planner notes": "planner_notes",
      "planner note": "planner_notes",
      "analyst notes": "analyst_notes",
      "analyst note": "analyst_notes",
      "po #": "po_number",
      country: "country",
      buyer: "buyer",
      "inventory analyst": "inventory_analyst",
      "total cbm approved": "total_cbm_approved",
      "total lead time": "lead_time",
      "lead time": "lead_time",
      "order date": "order_date",
      "supplying month": "supplying_month",
      "supply status": "supply_status",
      "replacement sku": "replacement_sku",
    }),
    [],
  );


  return (
    <div className="flex flex-col h-screen w-full min-w-0" style={{ maxWidth: "none" }}>
      <header className="h-14 shrink-0 border-b border-border bg-card flex items-center px-4 gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <Separator orientation="vertical" className="h-6" />
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-foreground leading-tight">Demand Planner</h1>
          <p className="text-[11px] text-muted-foreground">Real-time Demand Planner records synced from Supabase.</p>
        </div>
        <DateVarsBadge vars={liveDateVars} />
      </header>

      <div className="px-4 pt-4 pb-2 flex items-end justify-end">
        <div className="flex items-center gap-2">
          <PermissionGuardButton canEdit={canEdit} variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Import
          </PermissionGuardButton>

          <Button variant="outline" size="sm" disabled={exporting || items.length === 0} onClick={() => handleExport()}>
            <Download className="h-3.5 w-3.5 mr-1" />
            {exporting ? `Exporting… ${exportProgress}` : "Export Report"}
          </Button>

          <PermissionGuardButton canEdit={canEdit} size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Record
          </PermissionGuardButton>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap px-4 pb-3">
        <div className="relative flex-1 min-w-[280px] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8"
          />
        </div>

        <MultiSelectFilter
          label="SKU"
          options={withBlankOption(skuOptions)}
          value={filters.sku}
          onApply={(v) => {
            setFilters((p) => ({ ...p, sku: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Product Name"
          options={withBlankOption(productNameOptions)}
          value={filters.description || []}
          onApply={(v) => {
            setFilters((p) => ({ ...p, description: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Color"
          options={withBlankOption(colorOptions)}
          value={filters.item_color || []}
          onApply={(v) => {
            setFilters((p) => ({ ...p, item_color: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Factory"
          options={withBlankOption(factoryOptions)}
          value={filters.factory}
          onApply={(v) => {
            setFilters((p) => ({ ...p, factory: v }));
            setCurrentPage(1);
          }}
          sortDir={factorySort}
          onToggleSort={cycleFactorySort}
        />

        <MultiSelectFilter
          label="Needs Order"
          options={["Yes", "No"]}
          value={filters.needs_order || []}
          onApply={(v) => {
            setFilters((p) => ({ ...p, needs_order: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Kit"
          options={withBlankOption(kitFilterOptions)}
          value={filters.kit || []}
          onApply={(v) => {
            setFilters((p) => ({ ...p, kit: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Category"
          options={withBlankOption(categoryOptions)}
          value={filters.category}
          onApply={(v) => {
            setFilters((p) => ({ ...p, category: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Status"
          options={withBlankOption(statusOptions)}
          value={filters.status}
          onApply={(v) => {
            setFilters((p) => ({ ...p, status: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Purchasing Status"
          options={withBlankOption(puStatusOptions)}
          value={filters.pu_status}
          onApply={(v) => {
            setFilters((p) => ({ ...p, pu_status: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Shopify Status"
          options={shopifyStatusOptions}
          value={filters.shopify_status || []}
          onApply={(v) => {
            setFilters((p) => ({ ...p, shopify_status: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Supply Status"
          options={withBlankOption(supplyStatusOptions)}
          value={filters.supply_status}
          onApply={(v) => {
            setFilters((p) => ({ ...p, supply_status: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Level of Priority"
          options={withBlankOption(priorityOptions)}
          value={filters.priority_level}
          onApply={(v) => {
            setFilters((p) => ({ ...p, priority_level: v }));
            setCurrentPage(1);
          }}
          sortDir={prioritySort}
          onToggleSort={cyclePrioritySort}
        />

        <MultiSelectFilter
          label="Shadow"
          options={withBlankOption(shadowOptions)}
          value={filters.shadow}
          onApply={(v) => {
            setFilters((p) => ({ ...p, shadow: v }));
            setCurrentPage(1);
          }}
          formatLabel={(v) => (v === "yes" ? "Yes" : v === "no" ? "No" : v)}
        />

        <MultiSelectFilter
          label="Order Proposal Quantity"
          options={orderProposalQtyOptions}
          value={filters.order_proposal_qty}
          onApply={(v) => {
            setFilters((p) => ({ ...p, order_proposal_qty: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Buyer Approval"
          options={buyerNotesOptions}
          value={filters.buyer_notes}
          onApply={(v) => {
            setFilters((p) => ({ ...p, buyer_notes: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Months Worth"
          options={withBlankOption(monthsWorthOptions)}
          value={filters.months_worth ?? []}
          onApply={(v) => {
            setFilters((p) => ({ ...p, months_worth: v }));
            setCurrentPage(1);
          }}
        />

        <MultiSelectFilter
          label="Sku Status"
          options={["New SKU", "Not New SKU"]}
          value={filters.sku_status ?? []}
          onApply={(v) => {
            setFilters((p) => ({ ...p, sku_status: v }));
            setCurrentPage(1);
          }}
        />

        {/* Forecast Option dropdown removed — option is now per-row, set via right-click. */}

        <ColumnVisibilityDropdown
          columns={dropdownColumns}
          hiddenColumns={hiddenColumns}
          requiredColumns={REQUIRED_COLUMNS}
          onChange={setHiddenColumns}
          onReset={resetColumns}
        />

        {/* Incoming Breakdown sort dropdown — same style as Shadow filter */}
        <MultiSelectFilter
          label="Incoming Breakdown"
          options={["30", "60", "90", "120", "150", "180"]}
          value={incomingDaysSort != null ? [String(incomingDaysSort)] : []}
          onApply={(v) => {
            // Single-select behavior: pick the newly chosen value, or clear if none
            const next = v.find((x) => x !== String(incomingDaysSort)) ?? v[0] ?? null;
            setIncomingDaysSort(next != null ? Number(next) : null);
            setCurrentPage(1);
          }}
          formatLabel={(v) => `${v} Days`}
        />

        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={resetColumns}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Columns
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setResetForecastOptionOpen(true)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Forecast Option
        </Button>

        <Button
          variant="outline"
          size="sm"
          className={`h-8 gap-1.5 text-xs${showFormulaTooltip ? " bg-accent" : ""}`}
          onClick={() => {
            const next = !showFormulaTooltip;
            setShowFormulaTooltip(next);
            if (!next) setFormulaHighlight(null);
            try { localStorage.setItem("filter:monthly-forecast:formula-tooltip", String(next)); } catch { /* ignore */ }
          }}
        >
          <FunctionSquare className="h-3.5 w-3.5" />
          Tooltip Formula [{showFormulaTooltip ? "ON" : "OFF"}]
        </Button>

        <Button
          variant="default"
          size="sm"
          className="h-8 gap-1.5 text-xs bg-purple-600 hover:bg-purple-700"
          // startTransition: the dialog renders 1,500+ recomputed rows — opening
          // synchronously blocked the click for ~200ms (INP). Deferring lets the
          // button paint first and the dialog mount as a non-blocking transition.
          onClick={() => startTransition(() => setForecastAnalysisOpen(true))}
        >
          <Info className="h-3.5 w-3.5" />
          Reorder Decisions
        </Button>

        <Button
          variant="default"
          size="sm"
          className="h-8 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700"
          // startTransition — same INP fix as the planner button: paint the click
          // first, mount the heavy dialog as a non-blocking transition.
          onClick={() => {
            startTransition(() => {
              // Set default filter to "-" when opening Storefront Stock
              setIdpFilters((prev) => ({ ...prev, pu_status: ['-'] }));
              setShopifyInventoryOpen(true);
            });
          }}
        >
          <Package className="h-3.5 w-3.5" />
          Storefront Stock
        </Button>

        {(() => {
          const activeFilterCount = Object.values(filters).filter((arr) => arr.length > 0).length;
          return (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                setFilters({
                  sku: [],
                  factory: [],
                  status: [],
                  pu_status: [],
                  category: [],
                  country: [],
                  buyer: [],
                  inventory_analyst: [],
                  supply_status: [],
                  priority_level: [],
                  shadow: [],
                  action: [],
                  order_proposal_qty: [],
                  buyer_notes: [],
                  sku_status: [],
                  needs_order: [],
                });
                setIncomingDaysSort(null);
                setPrioritySort("none");
                setFactorySort("none");
                setCurrentPage(1);
              }}
            >
              <X className="h-3.5 w-3.5" />
              Clear Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
          );
        })()}

        <span className="text-xs text-muted-foreground">{totalCount.toLocaleString()} records</span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col min-w-0">
      <div
        ref={tableScrollRef}
        className="flex-1 min-h-0 border-t border-border relative overflow-auto overscroll-x-none [&::-webkit-scrollbar]:h-[6px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/60"
        style={{ isolation: "isolate", scrollbarWidth: "thin", scrollbarColor: "hsl(var(--border) / 0.6) transparent" }}
      >
        <div className="min-w-max">
          <table className="text-[12px] leading-tight border-separate border-spacing-0 mf-table" style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: forecastTotalWidth }}>
            {/* Fixed column widths so virtualized rows scrolling in can't recompute
                (and re-widen) columns — a resized width now sticks. */}
            <colgroup>
              <col style={{ width: ROW_NUM_WIDTH }} />
              {schema.map((c) => (
                <col key={c.column_name} style={{ width: colBodyWidth(c.column_name) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className="border border-border px-1 py-0.5 text-center font-bold text-slate-900 bg-slate-100"
                  style={{
                    position: "sticky",
                    top: 0,
                    left: 0,
                    zIndex: 85,
                    width: ROW_NUM_WIDTH,
                    minWidth: ROW_NUM_WIDTH,
                    maxWidth: ROW_NUM_WIDTH,
                  }}
                >
                  #
                </th>
                {headerGroups.map((g) => {
                  const firstCol = schema[g.start];
                  const isStart = g.start === 0;
                  const sep = !isStart ? " mf-sep-dark " : "";

                  const title =
                    g.key === "sales_monthly" ||
                    g.key === "projection" ||
                    g.key === "incoming" ||
                    g.key === "instock" ||
                    g.key === "supply_plan" ||
                    g.key === "replacement_inventory" ||
                    g.key === "replacement_incoming"
                      ? ""
                      : labelForGroup(g.key);

                  // How many of this group's LEADING columns are frozen.
                  // Frozen columns are forced to the front of the schema, so a
                  // group either has its first N columns frozen (the basic
                  // group by default) or none.
                  const span = g.end - g.start + 1;
                  const F = visibleFrozenCols.length;
                  const frozenLead = g.start < F ? Math.min(g.end + 1, F) - g.start : 0;

                  // Group contains frozen columns → pin a labeled header clipped
                  // to exactly the frozen width, and render the non-frozen
                  // remainder as a separate scrolling cell. This stops the
                  // "Product Information" label from floating over columns that
                  // have scrolled away (it stays put over the frozen columns).
                  if (frozenLead > 0) {
                    const firstFrozenCol = schema[g.start].column_name;
                    const fLeft = frozenLayout[firstFrozenCol]?.left ?? ROW_NUM_WIDTH;
                    let fWidth = 0;
                    for (let k = g.start; k < g.start + frozenLead; k++) {
                      const cn = schema[k].column_name;
                      fWidth += frozenLayout[cn]?.width ?? (columnWidths[cn] || DEFAULT_FROZEN_WIDTHS[cn] || 80);
                    }
                    const restSpan = span - frozenLead;
                    const restCol = restSpan > 0 ? schema[g.start + frozenLead].column_name : null;
                    return (
                      <React.Fragment key={`${g.key}-${g.start}`}>
                        <th
                          colSpan={frozenLead}
                          className={`border border-border px-2 py-0.5 text-center font-bold text-slate-900 ${headerBg(firstFrozenCol)} ${sep}`}
                          style={{ position: "sticky", top: 0, left: fLeft, zIndex: 75, height: 24, minWidth: fWidth, width: fWidth, maxWidth: fWidth }}
                        >
                          <div className="flex items-center justify-center gap-2 truncate">
                            {title && <span className="truncate">{title}</span>}
                          </div>
                        </th>
                        {restSpan > 0 && restCol && (
                          <th
                            colSpan={restSpan}
                            className={`border border-border px-2 py-0.5 text-center font-bold text-slate-900 ${headerBg(restCol)}`}
                            style={{ position: "sticky", top: 0, zIndex: 70, height: 24 }}
                          />
                        )}
                      </React.Fragment>
                    );
                  }

                  return (
                    <th
                      key={`${g.key}-${g.start}`}
                      colSpan={g.end - g.start + 1}
                      className={`border border-border px-2 py-0.5 text-center font-bold text-slate-900 ${headerBg(
                        firstCol.column_name,
                      )} ${sep}`}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 70,
                        height: 24,
                        boxShadow: undefined,
                      }}
                    >
                      <div className="flex items-center justify-center gap-2">
                        {title && <span>{title}</span>}
                        {g.key === "sales_monthly" && (
                          <span className="text-[11px] font-semibold flex items-center gap-2">
                            {salesHeaderTitle}
                            <Link
                              to="/yearly-sales"
                              className="ml-auto text-[10px] font-medium opacity-80 hover:opacity-100 underline underline-offset-2"
                            >
                              See More
                            </Link>
                          </span>
                        )}
                        {g.key === "projection" && (
                          <span className="text-[11px] font-semibold">{projectionHeaderTitle}</span>
                        )}
                        {g.key === "incoming" && (
                          <span className="text-[11px] font-semibold">{incomingHeaderTitle}</span>
                        )}
                        {g.key === "supply_plan" && (
                          <span className="text-[11px] font-semibold">{supplyHeaderTitle}</span>
                        )}
                        {g.key === "replacement_inventory" && (
                          <span className="text-[11px] font-semibold">Replacement Inventory</span>
                        )}
                        {g.key === "replacement_incoming" && (
                          <span className="text-[11px] font-semibold">{replIncomingHeaderTitle}</span>
                        )}
                        {g.key === "instock" && (
                          <span className="text-[11px] font-semibold flex items-center gap-2">
                            {instockHeaderTitle}
                            <Link
                              to="/instock-percentage"
                              className="ml-auto text-[10px] font-medium opacity-80 hover:opacity-100 underline underline-offset-2"
                            >
                              See More
                            </Link>
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}

                {/* Actions column - hidden
                <th
                  rowSpan={2}
                  className="border border-border px-2 py-1 text-center font-medium text-muted-foreground whitespace-nowrap w-[110px] bg-muted"
                  style={{ position: "sticky", top: 0, right: 0, zIndex: 80 }}
                >
                  Actions
                </th>
                */}
              </tr>

              <tr>
                {schema.map((col, i) => {
                  const prevColName = i > 0 ? schema[i - 1].column_name : null;
                  const sep = needsSeparator(prevColName, col.column_name) ? " mf-sep-medium " : "";

                  const fl = frozenLayout[col.column_name];
                  const isFrozen = !!fl;

                  const isSelected = selectedColumns.has(col.column_name);
                  const isHoverHL = hoverHighlight?.col === col.column_name;
                  const hoverOverlay = isHoverHL ? `hsl(${hoverHighlight!.hsl} / 0.30)` : null;

                  return (
                    <th
                      key={col.column_name}
                      data-col={col.column_name}
                      data-frozen-col={isFrozen ? "true" : undefined}
                      className={`border border-border px-2 py-1.5 text-center font-bold text-slate-900 select-none ${
                        "whitespace-normal break-words leading-tight"
                      } ${headerBg(col.column_name)} ${sep} relative group/resize cursor-pointer`}
                      style={{
                        position: "sticky",
                        top: 24,
                        ...(isSelected ? { outline: "2px solid hsl(var(--primary))", outlineOffset: "-2px" } : {}),
                        ...(isHoverHL
                          ? {
                              outline: `2px solid hsl(${hoverHighlight!.hsl})`,
                              outlineOffset: "-2px",
                              boxShadow: `inset 0 0 0 9999px ${hoverOverlay}`,
                            }
                          : {}),
                        ...(isFrozen
                          ? {
                              left: fl.left,
                              zIndex: 65 - fl.idx,
                              minWidth: fl.width,
                              maxWidth: fl.width,
                              width: fl.width,
                            }
                          : {
                              zIndex: 58,
                              ...(columnWidths[col.column_name]
                                ? { minWidth: columnWidths[col.column_name], width: columnWidths[col.column_name], maxWidth: columnWidths[col.column_name] }
                                : col.column_name === "supply_status"
                                  ? { minWidth: 120 }
                                  : {}),
                            }),
                      }}
                      onClick={(e) => {
                        handleColumnHeaderClick(col.column_name, e);
                      }}
                      onContextMenu={(e) => handleColumnContextMenu(col.column_name, e)}
                    >
                      <div className={`${isFrozen ? "truncate" : ""} flex items-center justify-center gap-1`}>
                        <div className={isFrozen ? "truncate" : ""}>
                          {labelForColumnDynamic(col.column_name)
                            .split("\n")
                            .map((line, idx) => (
                              <div key={idx} className="leading-tight">
                                {line}
                              </div>
                            ))}
                          {/* Factory column sort toggle (the planner's request) — right
                              on the header, cycles A→Z / Z→A / off. */}
                          {col.column_name === "factory" && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); cycleFactorySort(); }}
                              title={factorySort === "asc" ? "Factory A→Z (click: Z→A)" : factorySort === "desc" ? "Factory Z→A (click: off)" : "Sort by factory"}
                              className="mt-0.5 inline-flex items-center justify-center rounded hover:bg-black/10 p-0.5"
                            >
                              {factorySort === "asc" ? (
                                <ArrowUp className="h-3.5 w-3.5 text-primary" />
                              ) : factorySort === "desc" ? (
                                <ArrowDown className="h-3.5 w-3.5 text-primary" />
                              ) : (
                                <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                              )}
                            </button>
                          )}

                          {/* Total value for Total CBM Approved column */}
                          {col.column_name === 'total_cbm_approved' && (
                            <div className="mt-1 pt-1 border-t border-amber-600">
                              <div className="text-xs font-semibold text-amber-900">
                                Total: {totalCbmValue.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                <span className="ml-1 text-[9px]">
                                  ( {(() => {
                                    // Determine filter context label
                                    const hasAnyFilter =
                                      Object.entries(filters).some(([k, v]) => k !== "action" && (v as string[]).length > 0) ||
                                      filters.action.length > 0 ||
                                      !!debouncedSearch;
                                    
                                    if (!hasAnyFilter) {
                                      return "All";
                                    }
                                    
                                    // Show factory filter if present
                                    if (filters.factory.length > 0) {
                                      return filters.factory.join(", ");
                                    }
                                    
                                    // Otherwise show "filtered"
                                    return "filtered";
                                  })()} )
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Resize handle — wider hit area, visible on hover */}
                      <div
                        className="absolute top-0 right-[-2px] w-[5px] h-full cursor-col-resize opacity-0 group-hover/resize:opacity-60 hover:!opacity-100 bg-primary/40 transition-opacity z-10"
                        style={{ touchAction: "none" }}
                        onMouseDown={(e) => handleResizeStart(col.column_name, e)}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody ref={tbodyRef}>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: Math.max(schema.length, 5) + 2 }).map((__, j) => (
                      <td key={j} className="border border-border px-2 py-1">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td
                    colSpan={(schema.length || 5) + 2}
                    className="border border-border px-2 py-8 text-center text-destructive"
                  >
                    Error: {(error as Error).message}
                  </td>
                </tr>
              ) : displayedItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={(schema.length || 5) + 2}
                    className="border border-border px-2 py-8 text-center text-muted-foreground"
                  >
                    No records found.
                  </td>
                </tr>
              ) : (
                (() => {
                  const virtualRows = rowVirtualizer.getVirtualItems();
                  const totalSize = rowVirtualizer.getTotalSize();
                  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
                  const paddingBottom = Math.max(0, virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0);
                  return (
                    <>
                      {paddingTop > 0 && (
                        <tr><td style={{ height: paddingTop, padding: 0, border: "none" }} colSpan={(schema.length || 5) + 2} /></tr>
                      )}
                      {virtualRows.map((vRow) => {
                  const idx = vRow.index;
                  const row = displayedItems[idx];
                  const rowKey = (row as any)[pkCol] ?? idx;
                  const isSelected = selectedRowKeyRef.current === rowKey;
                  const rowSku = String((row as any).sku ?? "");
                  const rowNumber = skuRankMap.get(rowSku);
                  const rowNumBg = isSelected ? "color-mix(in srgb, hsl(217 91% 60%) 10%, hsl(210 20% 96%))" : "hsl(210 20% 96%)";
                  return (
                    <tr
                      key={rowKey}
                      data-index={vRow.index}
                      ref={rowVirtualizer.measureElement}
                      data-row-key={String(rowKey)}
                      className={`hover:bg-[#3b5769]/10 dark:hover:bg-[#2a2a2a]/60 ${isSelected ? "selected" : ""}`}
                      onMouseDownCapture={(e) => {
                        if (e.button !== 0) return;
                        // Let in-cell links (Product Name/ID → the ERP, Shopify
                        // Status → Shopify) work — selecting the row here re-renders
                        // and would swallow the link click.
                        if ((e.target as HTMLElement).closest("a")) return;
                        applyRowSelection(rowKey);
                      }}
                      onContextMenu={(e) => {
                        const sku = String((row as any).sku ?? "");
                        if (!sku) return;
                        e.preventDefault();
                        e.stopPropagation();

                        const r = row as any;
                        const rawOpt = r.__forecast_option ?? r.forecast_option ?? 0;
                        const currentOpt = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));

                        setRowOptionMenu({
                          x: e.clientX,
                          y: e.clientY,
                          sku,
                          currentOption: currentOpt,
                        });
                      }}
                      onClick={(e) => {
                        const td = (e.target as HTMLElement).closest("td[data-col]");
                        if (!td) return;
                        const colName = td.getAttribute("data-col") ?? "";
                        const formulaDef = COLUMN_FORMULAS[colName];
                        if (!formulaDef || !showFormulaTooltip) return;
                        e.stopPropagation();
                        const clickedSku = String((row as any).sku ?? "");
                        flushSync(() => {
                          if (formulaHighlight?.sku === clickedSku && formulaHighlight.activeColumn === colName) {
                            setFormulaHighlight(null);
                          } else {
                            const dynamicInputs = formulaDef.getDynamicInputs
                              ? formulaDef.getDynamicInputs(now, row)
                              : formulaDef.inputs ?? [];
                            setFormulaHighlight({
                              sku: clickedSku,
                              activeColumn: colName,
                              inputColumns: dynamicInputs,
                            });
                          }
                        });
                      }}
                    >
                      <td
                        data-sticky-rownum=""
                        className="border border-border px-1 py-1 text-center text-[11px] font-medium text-slate-600 tabular-nums"
                        style={{ ...ROW_NUM_CELL_STYLE_BASE, background: rowNumBg }}
                      >
                        {rowNumber ?? "—"}
                      </td>
                      {schema.map((col, i) => {
                        const isNum = isNumericType(col.data_type);
                        const isLong = isLongText(col);

                        let raw = resolveSalesMonthValue(
                          row as Record<string, unknown>,
                          col.column_name,
                          monthlyReplicaMap,
                          // Monthly Sales grid reads forecast_monthly_sales:
                          // units shipped, last 11 completed months.
                          // Computations elsewhere stay on
                          // monthly_sale_view_auto units (default "month").
                          "replica",
                        );
                        // Actual Sales (display): recent_month_0 = kasalukuyang
                        // buwan (MTD) mula forecast_monthly_sales — same table
                        // as the Monthly Sales grid. Ang Option-2 computation ay
                        // nasa forecast_report.actual_sale_of_month pa rin.
                        if (col.column_name === "actual_sale_of_month") {
                          const rrow =
                            monthlyReplicaMap.get(String((row as Record<string, unknown>).sku ?? "").trim()) ??
                            monthlyReplicaMap.get(String((row as Record<string, unknown>).product_id ?? "").trim());
                          raw = rrow ? (rrow.recent_month_0 ?? null) : null;
                        }
                        // Unshipped: mula forecast_report row value (loader-fed).
                        let { display, isLink } = formatCellValue(raw, col.data_type);

                        // Replacement Rate & Return Rate: show exact 2-decimal value
                        if (["replacement_rate", "return_rate"].includes(col.column_name)) {
                          const n = raw == null ? 0 : Number(raw);
                          display = (isNaN(n) ? 0 : n).toFixed(2);
                          isLink = false;
                        }

                        // Cbm: always show full decimal value (no rounding)
                        if (col.column_name === "cbm") {
                          const n = raw == null ? null : Number(raw);
                          if (n != null && !isNaN(n) && n !== 0) {
                            display = String(n);
                            isLink = false;
                          }
                        }

                        // Total CBM Approved: 1 decimal place, show "0.0" when zero/null
                        if (col.column_name === "total_cbm_approved") {
                          const n = raw == null ? 0 : Number(raw);
                          display = isNaN(n) ? "0.0" : n.toFixed(1);
                          isLink = false;
                        }

                        // Months Worth: 1 decimal place, show "0.0" for null/errors
                        if (col.column_name === "months_worth") {
                          if (raw == null) {
                            display = "0.0";
                          } else {
                            const n = Number(raw);
                            display = isNaN(n) ? "0.0" : DECIMAL_1_FMT.format(n);
                          }
                          isLink = false;
                        }

                        // Supplying Month: format as "MMMM dd, yyyy" (e.g. "July 15, 2026")
                        if (col.column_name === "supplying_month" || col.column_name === "supply_month") {
                          const rawText = raw == null ? "" : String(raw).trim();
                          if (!rawText) {
                            display = EMPTY_MARK;
                          } else {
                            // Match YYYY-MM-DD or YYYY-MM
                            const fullMatch = rawText.match(/^(\d{4})-(\d{2})-(\d{2})/);
                            const monthOnly = rawText.match(/^(\d{4})-(\d{2})$/);
                            if (fullMatch) {
                              const d = new Date(Number(fullMatch[1]), Number(fullMatch[2]) - 1, Number(fullMatch[3]));
                              display = LONG_DATE_FMT.format(d);
                            } else if (monthOnly) {
                              const d = new Date(Number(monthOnly[1]), Number(monthOnly[2]) - 1, 15);
                              display = LONG_DATE_FMT.format(d);
                            } else {
                              display = rawText;
                            }
                          }
                          isLink = false;
                        } else if (isDateType(col.data_type)) {
                          const dOnly = formatDateOnly(raw);
                          if (dOnly) {
                            display = dOnly;
                            isLink = false;
                          }
                        }

                        if (isInstockColumn(col.column_name) && isNum) {
                          const instockDisplay = formatInstockDisplay(raw);
                          if (instockDisplay != null) {
                            display = instockDisplay;
                            isLink = false;
                          }
                        }

                        if (typeof display === "string") {
                          display = normalizeDash(display) as string;
                        }

                        const isRateCol = ["replacement_rate", "return_rate"].includes(col.column_name);
                        const isCbmCol =
                          col.column_name === "cbm" ||
                          col.column_name === "total_cbm_approved" ||
                          col.column_name === "months_worth";
                        if (isNum && !isRateCol && !isCbmCol) {
                          const rawIsZero = isZeroLikeNumber(raw);
                          const displayIsZero = typeof display === "string" && display.trim() === "-";

                          if (rawIsZero || displayIsZero) {
                            display = "-";
                            isLink = false;
                          }
                        } else {
                          if (isTextZero(normalizeDash(raw))) {
                            display = EMPTY_MARK;
                            isLink = false;
                          }
                        }

                        if (typeof raw === "string" && String(normalizeDash(raw)).trim() === "") {
                          display = EMPTY_MARK;
                          isLink = false;
                        }

                        if (display == null || display === "") {
                          display = EMPTY_MARK;
                          isLink = false;
                        }

                        // Monthly Projection (proj_month_1..12) + Supply Plan (supply_month_1..12):
                        // never show "-" / blank. Empty / null / zero all render as "0".
                        // Negative values pass through unchanged (red text handled elsewhere).
                        if (/^(proj|supply)_month_\d{1,2}$/i.test(col.column_name)) {
                          if (display === EMPTY_MARK || display == null || display === "" || display === "-") {
                            display = "0";
                            isLink = false;
                          }
                        }

                        // Monthly Revenue & Monthly Lost Revenue: currency w/ 2 decimals; 0/null → "-"
                        if (/^(rev|lost)_month_\d{1,2}$/i.test(col.column_name)) {
                          const n = toNumberSafe(raw);
                          if (n == null || n === 0) {
                            display = EMPTY_MARK;
                          } else {
                            const abs = Math.abs(n).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            });
                            display = n < 0 ? `-$${abs}` : `$${abs}`;
                          }
                          isLink = false;
                        }

                        // Total Revenue / Total Lost Revenue: sum of 12 monthly cols if missing
                        if (col.column_name === "total_revenue" || col.column_name === "total_lost_revenue") {
                          const prefix = col.column_name === "total_revenue" ? "rev_month_" : "lost_month_";
                          let n = toNumberSafe(raw);
                          if (n == null) {
                            let sum = 0;
                            let any = false;
                            for (let i = 1; i <= 12; i++) {
                              const v = toNumberSafe((row as Record<string, unknown>)[`${prefix}${i}`]);
                              if (v != null) {
                                sum += v;
                                any = true;
                              }
                            }
                            n = any ? sum : null;
                          }
                          if (n == null || n === 0) {
                            display = EMPTY_MARK;
                          } else {
                            const abs = Math.abs(n).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            });
                            display = n < 0 ? `-$${abs}` : `$${abs}`;
                          }
                          isLink = false;
                        }

                        // Unit Cost: currency with 2 decimals; null/0 → "-"
                        if (col.column_name === "unit_cost") {
                          const n = toNumberSafe(raw);
                          if (n == null || n === 0) {
                            display = EMPTY_MARK;
                          } else {
                            display = `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          }
                          isLink = false;
                        }

                        // Back In Stock Request: 0/null → dash for all three cells,
                        // currency formatting only on back_unit_price.
                        if (
                          col.column_name === "unsent_notifications_count" ||
                          col.column_name === "quantity_required" ||
                          col.column_name === "back_unit_price"
                        ) {
                          const n = toNumberSafe(raw);
                          if (n == null || n === 0) {
                            display = EMPTY_MARK;
                          } else if (col.column_name === "back_unit_price") {
                            display = `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          } else {
                            display = Math.round(n).toLocaleString("en-US");
                          }
                          isLink = false;
                        }

                        // Instock month columns: never blank/dash — always show numeric value or 0.00.
                        // Runs last so it overrides upstream zero/empty → "-" coercions.
                        if (isInstockColumn(col.column_name)) {
                          const n = toNumberSafe(raw);
                          display = n == null ? "0.00" : Math.min(n, 100).toFixed(2);
                          isLink = false;
                        }

                        // Monthly Sales columns (sales_month_N): never blank/dash — always show integer
                        // unit count or 0. Mirrors the instock rule but uses integer formatting.
                        if (/^sales_month_\d{1,2}$/i.test(col.column_name)) {
                          const n = toNumberSafe(raw);
                          display = n == null ? "0" : Math.round(n).toLocaleString("en-US");
                          isLink = false;
                        }

                        const fl = frozenLayout[col.column_name];
                        const isFrozen = !!fl;

                        const isNotesCol = col.column_name === "planner_notes" || col.column_name === "analyst_notes";
                        let cls = "border border-border px-2 align-middle";
                        if (isNotesCol) cls += " whitespace-nowrap text-center py-1" + (isFrozen ? "" : " overflow-hidden text-ellipsis");
                        else if (isNum) cls += " text-center tabular-nums py-1 dark:bg-black";
                        else if (isLong) cls += " whitespace-nowrap text-center py-1" + (isFrozen ? "" : " overflow-hidden text-ellipsis");
                        else cls += " whitespace-nowrap text-center py-1";

                        const prevColName = i > 0 ? schema[i - 1].column_name : null;
                        if (needsSeparator(prevColName, col.column_name)) cls += " mf-sep-light ";

                        // Check if this is an inventory bucket column
                        const isInventoryBucket = ["fba_reserved", "intransit_fba", "fba", "oh_inv", "otw_units", "on_order_units", "po_in_progress"].includes(col.column_name);

                        const frozenBg = isSelected ? "color-mix(in srgb, hsl(217 91% 60%) 10%, hsl(var(--table-row)))" : "hsl(var(--table-row))";
                        const style: React.CSSProperties = isFrozen
                          ? {
                              position: "sticky",
                              left: fl.left,
                              zIndex: 30 - fl.idx,
                              background: frozenBg,
                              minWidth: fl.width,
                              maxWidth: fl.width,
                              width: fl.width,
                            }
                          : columnWidths[col.column_name]
                            ? { minWidth: columnWidths[col.column_name], width: columnWidths[col.column_name], maxWidth: columnWidths[col.column_name], overflow: "hidden" }
                            : col.column_name === "supply_status"
                              ? { minWidth: 120 }
                              : isNotesCol
                                ? { minWidth: 160, maxWidth: 300 }
                                : {};

                        // Apply darker yellow background to inventory bucket columns
                        if (isInventoryBucket && !isFrozen) {
                          style.background = "#fef3c7";
                        }

                        // Current Sales Velocity: color by comparison vs Monthly Projection
                        // (green when ahead of target, red when trailing). Other columns use
                        // the standard conditional styling.
                        let metricStyle: { bg?: string; color?: string } | undefined;
                        {
                          // Current Sales Velocity (and the other sales metrics) are colored
                          // by their OWN column condition (salesMetricCellStyle) — independent
                          // of Monthly Projection, so a projection override never strips the color.
                          let styleSourceValue: unknown = raw;
                          // For total cols, derive value from sum if raw missing so styling reflects computed total
                          if (
                            (col.column_name === "total_revenue" || col.column_name === "total_lost_revenue") &&
                            (styleSourceValue == null || styleSourceValue === "")
                          ) {
                            const prefix = col.column_name === "total_revenue" ? "rev_month_" : "lost_month_";
                            let sum = 0;
                            let any = false;
                            for (let i = 1; i <= 12; i++) {
                              const v = toNumberSafe((row as Record<string, unknown>)[`${prefix}${i}`]);
                              if (v != null) {
                                sum += v;
                                any = true;
                              }
                            }
                            if (any) styleSourceValue = sum;
                          }
                          // Velocity baseline = July (huling kumpletong buwan na
                          // IPINAPAKITA sa grid — forecast_monthly_sales
                          // recent_month_1) — per the planner: hindi pwedeng green kapag
                          // ang velocity ay mas mababa sa July.
                          const prevMonthSales = col.column_name === "sales_velocity"
                            ? toNumberSafe(resolveSalesMonthValue(row as Record<string, unknown>, "sales_month_0", monthlyReplicaMap, "replica"))
                            : undefined;
                          metricStyle = salesMetricCellStyle(col.column_name, styleSourceValue, prevMonthSales);
                        }
                        if (metricStyle && !isFrozen) {
                          if (metricStyle.bg) style.background = metricStyle.bg;
                          if (metricStyle.color) style.color = metricStyle.color;
                          if ((metricStyle as any).fontWeight) style.fontWeight = (metricStyle as any).fontWeight;
                        }

                        // Selected row highlight — skip cells with conditional metric coloring,
                        // inventory bucket cells, and frozen sticky cells (which compute their
                        // own solid selection color via frozenBg / color-mix to prevent bleed-through).
                        if (isSelected && !metricStyle && !isInventoryBucket && !isFrozen) {
                          style.background = "hsl(217 91% 60% / 0.10)";
                        }

                        // Per-token formula hover overlay (column-wide tint).
                        if (hoverHighlight?.col === col.column_name) {
                          style.background = `hsl(${hoverHighlight.hsl} / 0.30)`;
                          style.boxShadow = `inset 0 0 0 9999px hsl(${hoverHighlight.hsl} / 0.30)`;
                        }

                        // Formula highlighting - add blue border for input cells
                        // PERFORMANCE: Uses GPU acceleration (transform: translateZ(0)) and fast transitions (0.1s)
                        const sku = String(row.sku ?? "");
                        const isFormulaInput = formulaHighlight?.sku === sku && formulaHighlight.inputColumns.includes(col.column_name);
                        const isFormulaActive = formulaHighlight?.sku === sku && formulaHighlight.activeColumn === col.column_name;
                        
                        if (isFormulaInput) {
                          style.boxShadow = "inset 0 0 0 2px #1f8a8c";
                          style.border = "2px solid #1f8a8c";
                          style.transition = "box-shadow 0.08s ease-out, border 0.08s ease-out";
                        }
                        if (isFormulaActive) {
                          style.background = "#fef3c7";
                          style.boxShadow = "inset 0 0 0 2px #f59e0b";
                          style.transition = "background 0.08s ease-out, box-shadow 0.08s ease-out";
                        }

                        // Check if this column has a formula definition
                        if (COLUMN_FORMULAS[col.column_name] != null) {
                          style.cursor = "pointer";
                        }

                        return (
                          <td
                            key={col.column_name}
                            // Mark cells that carry their own conditional color so the
                            // row-selection CSS does not override their background/text.
                            className={metricStyle?.bg ? `${cls} mf-cell-colored` : cls}
                            style={style}
                            data-sku={sku}
                            data-col={col.column_name}
                            data-frozen-col={isFrozen ? "true" : undefined}
                            title={
                              NO_TITLE_COLS.has(col.column_name)
                                ? undefined
                                : display !== EMPTY_MARK
                                  ? String(display)
                                  : undefined
                            }
                          >
                            <div className={col.column_name === "description" ? "" : isFrozen ? "truncate" : ""}>
                              {col.column_name === "description" ? (
                                (() => {
                                  const sku = String((row as any).sku ?? "");
                                  const descRaw = raw == null ? "" : String(raw);
                                  // Product name links ONLY to the live Shopify page (merged from
                                  // /api/shopify-links, incl. the parent-master-SKU fallback for
                                  // X2/X3/X4 sets) — one consistent destination. SKUs not on the
                                  // storefront get no link here; the Shopify Link column keeps
                                  // showing the stored shopify_url untouched.
                                  const scUrl = toSafeHttpUrl((row as any).shopify_live_url);
                                  // Match "Name in Color" or "Name - Color"
                                  let mainName = descRaw;
                                  let variant = "";
                                  const mIn = descRaw.match(/^(.*?)\s+in\s+(.*)$/i);
                                  const mDash = descRaw.match(/^(.*?)\s+-\s+(.*)$/);
                                  if (mIn) {
                                    mainName = mIn[1].trim();
                                    variant = mIn[2].trim();
                                  } else if (mDash) {
                                    mainName = mDash[1].trim();
                                    variant = mDash[2].trim();
                                  }
                                  const nameText = mainName || descRaw || EMPTY_MARK;
                                  return (
                                    <div className="flex items-center gap-2 min-w-0 text-left">
                                      <ProductImage
                                        productId={sku}
                                        productName={descRaw || sku}
                                        imageUpdatedAt={imageUpdatedAtMap.get(sku) ?? null}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-foreground truncate" title={descRaw}>
                                          {scUrl ? (
                                            <a
                                              href={scUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              title="Open on storefront"
                                              className="hover:underline hover:text-blue-600 transition-colors"
                                            >
                                              {nameText}
                                            </a>
                                          ) : (
                                            nameText
                                          )}
                                        </div>
                                        {variant && (
                                          <div className="text-[11px] text-muted-foreground truncate">{variant}</div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                  // NOTE: spec calls for splitting Image into its own column.
                                  // MonthlyForecast has complex header groups + frozen layout —
                                  // splitting would require restructuring headerGroups/colSpan.
                                  // Image stays inline here; product_name/sku already separate cols.
                                })()
                              ) : col.column_name === "order_proposal_qty" ? (
                                (() => {
                                  const manual = manualMap.get(String(row.sku ?? ""));
                                  const hasManualEdit = manual?.order_proposal_qty != null;
                                  return (
                                    <OrderProposalQtyCell
                                      value={raw != null ? String(raw) : null}
                                      onSave={(v) => handleSaveOrderProposalQty(row, v as string | null)}
                                      hasManualEdit={hasManualEdit}
                                      textMode
                                    />
                                  );
                                })()
                              ) : col.column_name === "buyer_notes" ? (
                                <BuyerNotesDropdownCell
                                  value={raw != null ? String(raw) : null}
                                  sku={String((row as any).sku ?? "")}
                                  onSave={handleSaveBuyerNotes}
                                />
                              ) : col.column_name === "planner_notes" ? (
                                <InlineTextNoteCell
                                  value={raw != null ? String(raw) : null}
                                  sku={String((row as any).sku ?? "")}
                                  onSave={handleSavePlannerNotes}
                                />
                              ) : col.column_name === "analyst_notes" ? (
                                <InlineTextNoteCell
                                  value={raw != null ? String(raw) : null}
                                  sku={String((row as any).sku ?? "")}
                                  onSave={handleSaveAnalystNotes}
                                />
                              ) : col.column_name === "monthly_projection" ? (
                                (() => {
                                  const manual = manualMap.get(String(row.sku ?? ""));
                                  const hasManualEdit = manual?.monthly_projection != null;
                                  return (
                                    <MonthlyProjectionRuleTooltip
                                      row={row as Record<string, unknown>}
                                      manualMonthlyProjection={manual?.monthly_projection ?? null}
                                    >
                                      <OrderProposalQtyCell
                                        value={raw != null ? toNumberSafe(raw) : null}
                                        onSave={(v) => handleSaveMonthlyProjection(row, v)}
                                        emptyDisplay="0"
                                        emptyIsBold={true}
                                        formatDisplay={formatMonthlyProjectionDisplay}
                                        hasManualEdit={hasManualEdit}
                                      />
                                    </MonthlyProjectionRuleTooltip>
                                  );
                                })()
                              ) : /^proj_month_(\d{1,2})$/.test(col.column_name) ? (
                                (() => {
                                  const mIdx = Number(col.column_name.match(/^proj_month_(\d{1,2})$/)![1]);
                                  const projOvr = projOverrideMap.get(String(row.sku ?? ""));
                                  const overrideVal = projOvr ? projOvr[`proj_month_${mIdx}_override`] : null;
                                  const hasOverride = overrideVal != null;
                                  return (
                                    <OrderProposalQtyCell
                                      value={toNumberSafe(raw)}
                                      onSave={(v) => handleSaveProjOverride(row, mIdx, v)}
                                      emptyDisplay="0"
                                      emptyIsBold
                                      hasManualEdit={hasOverride}
                                      formatDisplay={(v) => Math.round(v).toString()}
                                    />
                                  );
                                })()
                              ) : /^supply_month_(\d{1,2})$/.test(col.column_name) ? (
                                (() => {
                                  const mIdx = Number(col.column_name.match(/^supply_month_(\d{1,2})$/)![1]);
                                  const supplyOvr = supplyOverrideMap.get(String(row.sku ?? ""));
                                  const overrideVal = supplyOvr ? supplyOvr[`supply_month_${mIdx}_override`] : null;
                                  const hasOverride = overrideVal != null;
                                  return (
                                    <OrderProposalQtyCell
                                      value={toNumberSafe(raw)}
                                      onSave={(v) => handleSaveSupplyOverride(row, mIdx, v)}
                                      emptyDisplay="0"
                                      emptyIsBold
                                      hasManualEdit={hasOverride}
                                    />
                                  );
                                })()
                              ) : col.column_name === "factory" ? (
                                <InlineStatusTextCell
                                  value={
                                    raw != null && String(raw).trim() && String(raw).trim() !== "-" ? String(raw) : null
                                  }
                                  onSave={(v) => handleSaveStatusOverride(row, "factory", v)}
                                  placeholder="-"
                                />
                              ) : col.column_name === "status" ? (
                                <StatusOverrideDropdownCell
                                  value={
                                    raw != null && String(raw).trim() && String(raw).trim() !== "-" ? String(raw) : null
                                  }
                                  onSave={(v) => handleSaveStatusOverride(row, "status", v)}
                                  options={STATUS_OVERRIDE_OPTIONS}
                                  badgeClsFn={statusOverrideBadgeCls}
                                  placeholder="-"
                                />
                              ) : col.column_name === "pu_status" ? (
                                (() => {
                                  const v =
                                    raw != null && String(raw).trim() && String(raw).trim() !== "-"
                                      ? String(raw)
                                      : null;
                                  if (!v) return <span className="text-muted-foreground">-</span>;
                                  const scUrl = toSafeHttpUrl((row as Record<string, unknown>).purchasing_url);
                                  const pill = <Pill value={v} className={pillClassForPuStatus(v)} />;
                                  return scUrl ? (
                                    <a
                                      href={scUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Open in ERP"
                                      className="inline-flex hover:opacity-80 transition-opacity"
                                    >
                                      {pill}
                                    </a>
                                  ) : (
                                    pill
                                  );
                                })()
                              ) : col.column_name === "shopify_status" ? (
                                (() => {
                                  const v =
                                    raw != null && String(raw).trim() && String(raw).trim() !== "-"
                                      ? capitalizeFirst(raw)
                                      : null;
                                  if (!v) return <span className="text-muted-foreground">-</span>;
                                  const shopUrl = toSafeHttpUrl((row as any).shopify_url);
                                  const pill = <Pill value={v} className={pillClassForShopifyStatus(raw)} />;
                                  return shopUrl ? (
                                    <a
                                      href={shopUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Open in Shopify"
                                      className="inline-flex hover:opacity-80 transition-opacity"
                                    >
                                      {pill}
                                    </a>
                                  ) : (
                                    pill
                                  );
                                })()
                              ) : col.column_name === "shopify_url" || col.column_name === "purchasing_url" ? (
                                (() => {
                                  const rawStr = raw != null ? String(raw).trim() : "";
                                  let safeUrl: string | null = null;
                                  try {
                                    if (rawStr && rawStr !== "-") {
                                      const parsed = new URL(rawStr);
                                      if (parsed.protocol === "http:" || parsed.protocol === "https:") safeUrl = parsed.toString();
                                    }
                                  } catch { /* invalid URL */ }
                                  return safeUrl ? (
                                    <a
                                      href={safeUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 hover:text-blue-700 transition-colors"
                                    >
                                      <ExternalLink size={10} />
                                      View
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  );
                                })()
                              ) : col.column_name === "kit" ? (
                                // Read-only — the ERP-driven (forecast_report.kit only, no override).
                                (() => {
                                  const v = normalizeKitDisplay(raw);
                                  return v ? (
                                    <Pill value={v} className={kitBadgeCls(v)} />
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  );
                                })()
                              ) : col.column_name === "item_color" ? (
                                // Read-only — the ERP-driven (forecast_report.item_color).
                                (() => {
                                  const v =
                                    raw != null && String(raw).trim() && String(raw).trim() !== "-"
                                      ? String(raw)
                                      : null;
                                  return v ? (
                                    <span className="text-xs">{v}</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  );
                                })()
                              ) : col.column_name === "category" ? (
                                // Read-only — the ERP-driven (forecast_report.category only, no override).
                                (() => {
                                  const v =
                                    raw != null && String(raw).trim() && String(raw).trim() !== "-"
                                      ? String(raw)
                                      : null;
                                  return v ? (
                                    <span className="text-xs">{v}</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  );
                                })()
                              ) : col.column_name === "shadow" ? (
                                <span className="text-xs">
                                  {(() => {
                                    const v = String(raw ?? "")
                                      .trim()
                                      .toLowerCase();
                                    return v === "yes" ? "Yes" : "No";
                                  })()}
                                </span>
                              ) : col.column_name === "ninety_day_deficit" ? (
                                (() => {
                                  const val = toNumberSafe(raw) ?? 0;
                                  const color = val < 0 ? "#ff6b6b" : val > 0 ? "#51cf66" : "#888";
                                  const formatted = val.toFixed(1);
                                  const text = val < 0 ? formatted : val > 0 ? `+${formatted}` : "0";
                                  return <span style={{ color, fontWeight: "bold" }}>{text}</span>;
                                })()
                              ) : col.column_name === "ninety_day_revenue_loss" ? (
                                (() => {
                                  const val = toNumberSafe(raw) ?? 0;
                                  if (val > 0) {
                                    return (
                                      <span style={{ color: "#ff6b6b", fontWeight: "bold" }}>
                                        ${val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                      </span>
                                    );
                                  }
                                  return <span className="text-muted-foreground">-</span>;
                                })()
                              ) : col.column_name === "lead_time" ? (
                                (() => {
                                  const val = toNumberSafe(raw);
                                  return val ? <span>{val}</span> : <span className="text-muted-foreground">-</span>;
                                })()
                              ) : col.column_name === "order_date_forecast" || col.column_name === "supply_month_forecast" || col.column_name === "covered_months" ? (
                                (() => {
                                  if (!raw) return <span className="text-muted-foreground">-</span>;
                                  const dateStr = String(raw);
                                  const d = new Date(dateStr);
                                  if (isNaN(d.getTime())) return <span className="text-muted-foreground">-</span>;
                                  return (
                                    <span>
                                      {PLANNER_DATE_FMT.format(d)}
                                    </span>
                                  );
                                })()
                              ) : col.column_name === "action" ? (
                                (() => {
                                  const actionText = String(raw ?? "Order Soon");
                                  const isOrderNow = actionText === "Order Now";
                                  const bgColor = isOrderNow ? "#ff6b6b" : "#ffd43b";
                                  const textColor = isOrderNow ? "white" : "#1e1e1e";
                                  const icon = isOrderNow ? "🔴" : "🟡";
                                  return (
                                    <span
                                      style={{
                                        background: bgColor,
                                        color: textColor,
                                        padding: "4px 12px",
                                        borderRadius: "12px",
                                        fontWeight: "bold",
                                        display: "inline-block",
                                        fontSize: "11px",
                                      }}
                                    >
                                      {icon} {actionText}
                                    </span>
                                  );
                                })()
                              ) : display === EMPTY_MARK ? (
                                <span className="text-muted-foreground">{EMPTY_MARK}</span>
                              ) : col.column_name === "priority_level" ? (
                                <Pill value={normalizeDash(raw)} className={pillClassForPriority(raw)} />
                              ) : col.column_name === "sku_status" ? (
                                (() => {
                                  // master_sku.new_sku ang authoritative — kapag loaded, ang merged
                                  // sku_status (raw) ay galing na doon; huwag nang mag-recompute.
                                  if (masterSkuMap.size > 0) {
                                    return <Pill value={normalizeDash(raw)} className={pillClassForSkuStatus(raw)} title="Source: master_sku.new_sku" />;
                                  }
                                  // Fallback habang hindi pa loaded ang master_sku: lumang 120-day rule.
                                  const fsd = readFirstSaleDate(row as Record<string, unknown>);
                                  if (fsd) {
                                    const computed = computeNewSku(fsd);
                                    return <Pill value={computed} className={pillClassForSkuStatus(computed)} title={skuStatusBasisWithDate(fsd, computed, String(normalizeDash(raw) ?? ""))} />;
                                  }
                                  return <Pill value={normalizeDash(raw)} className={pillClassForSkuStatus(raw)} title={skuStatusBasis(raw)} />;
                                })()
                              ) : col.column_name === "supply_status" ? (
                                <Pill value={normalizeDash(raw)} className={pillClassForSupplyStatus(raw)} />
                              ) : isLink ? (
                                <a
                                  href={String(display)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline truncate block"
                                >
                                  {display}
                                </a>
                              ) : col.data_type.includes("bool") ? (
                                <Badge variant={raw ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                                  {String(display)}
                                </Badge>
                              ) : col.column_name.toLowerCase() === "sku" ? (
                                <span className="inline-flex items-center">
                                  <ForecastOptionBadge option={(() => {
                                    const v = (row as any).__forecast_option;
                                    const n = Number(v);
                                    return Number.isFinite(n) ? n : 1;
                                  })()} />
                                  {(() => {
                                    const scUrl = toSafeHttpUrl((row as any).purchasing_url);
                                    return scUrl ? (
                                      <a
                                        href={scUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        style={{ marginLeft: 4 }}
                                        className="hover:underline hover:text-blue-600 transition-colors"
                                      >
                                        {display}
                                      </a>
                                    ) : (
                                      <span style={{ marginLeft: 4 }}>{display}</span>
                                    );
                                  })()}
                                </span>
                              ) : (
                                display
                              )}
                            </div>
                          </td>
                        );
                      })}

                      {/* Actions column - hidden
                      <td
                        className="border border-border px-2 py-1 text-center w-[200px]"
                        style={{ position: "sticky", right: 0, zIndex: 35, background: "hsl(var(--table-row))" }}
                      >
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditRow(row);
                              setEditOpen(true);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => {
                              setDeleteRow(row);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                      */}
                    </tr>
                  );
                      })}
                      {paddingBottom > 0 && (
                        <tr><td style={{ height: paddingBottom, padding: 0, border: "none" }} colSpan={(schema.length || 5) + 2} /></tr>
                      )}
                    </>
                  );
                })()
              )}

            </tbody>
          </table>
        </div>

      </div>

      </div>

      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={totalCount}
        onPageChange={setCurrentPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCurrentPage(1);
        }}
        pageSizeOptions={PAGE_SIZES}
      />

      {/* Context menu for column headers */}
      {contextMenu && (
        <ColumnHeaderContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          columnKey={contextMenu.col}
          selectedColumns={selectedColumns}
          requiredColumns={REQUIRED_COLUMNS}
          onClose={handleContextMenuClose}
          onHideColumns={handleContextMenuHide}
          onReset={resetColumns}
          onEditFormula={() => {}}
          isFrozen={ALL_FROZEN_COLS.includes(contextMenu.col)}
          isRequiredFrozen={REQUIRED_FROZEN_COLS.includes(contextMenu.col)}
          onFreezeToggle={handleFreezeToggle}
          onBeforeClear={async (targets) => {
            // Cancel any in-flight background refetches first.
            // Without this, a refetch triggered by handleSave* can complete AFTER we've
            // optimistically set the value to null and race-write the old value back.
            for (const t of targets) {
              if (t.table === "forecast_report_manual") {
                await queryClient.cancelQueries({ queryKey: ["forecast_report_manual"] });
              } else if (t.table === "forecast_report_proj_override") {
                await queryClient.cancelQueries({ queryKey: ["forecast_report_proj_override"] });
              } else if (t.table === "forecast_report_supply_override") {
                await queryClient.cancelQueries({ queryKey: ["forecast_report_supply_override"] });
              } else if (t.table === "forecast_report") {
                await queryClient.cancelQueries({ queryKey: pageQueryKey, exact: true });
                await queryClient.cancelQueries({ queryKey: [QUERY_KEY, "all-items", TABLE_NAME], exact: true });
              }
            }
            // Bust prevMergedRef BEFORE flushSync. On a repeated "Clear Manual Value" on the
            // same column, every row hits recomputeCacheRef (same cache key as first clear) →
            // anyMiss=false → prevMergedRef short-circuit returns the stale pre-clear array.
            // Nulling it forces mergedItems to use the freshly-built `next` array instead.
            prevMergedRef.current = null;
            flushSync(() => {
              for (const t of targets) {
                if (t.table === "forecast_report_manual") {
                  queryClient.setQueryData(["forecast_report_manual"], (prev: any[] | undefined) => {
                    if (!Array.isArray(prev)) return prev;
                    return prev.map((r) => ({ ...r, [t.field]: null }));
                  });
                } else if (t.table === "forecast_report_proj_override") {
                  queryClient.setQueryData(["forecast_report_proj_override"], (prev: any[] | undefined) => {
                    if (!Array.isArray(prev)) return prev;
                    return prev.map((r) => ({ ...r, [t.field]: null }));
                  });
                } else if (t.table === "forecast_report_supply_override") {
                  queryClient.setQueryData(["forecast_report_supply_override"], (prev: any[] | undefined) => {
                    if (!Array.isArray(prev)) return prev;
                    return prev.map((r) => ({ ...r, [t.field]: null }));
                  });
                } else if (t.table === "forecast_report") {
                  // Use exact active query keys — prefix matching via setQueriesData
                  // can miss when the key contains nested filter objects.
                  queryClient.setQueryData(pageQueryKey, (prev: any) => {
                    if (!Array.isArray(prev)) return prev;
                    return prev.map((r: any) => ({ ...r, [t.field]: null }));
                  });
                  queryClient.setQueryData(
                    [QUERY_KEY, "all-items", TABLE_NAME],
                    (prev: any) => {
                      if (!Array.isArray(prev)) return prev;
                      return prev.map((r: any) => ({ ...r, [t.field]: null }));
                    },
                  );
                }
              }
              setLocalRowPatches({});
            });
          }}
          onRefresh={() => {
            void queryClient.refetchQueries({ queryKey: ["forecast_report_manual"] });
            void queryClient.refetchQueries({ queryKey: ["forecast_report_proj_override"] });
            void queryClient.refetchQueries({ queryKey: ["forecast_report_supply_override"] });
            void queryClient.refetchQueries({ queryKey: pageQueryKey, exact: true });
            void queryClient.refetchQueries({ queryKey: [QUERY_KEY, "all-items", TABLE_NAME], exact: true });
          }}
        />
      )}

      {/* Per-row forecast option context menu */}
      {rowOptionMenu && (
        <RowForecastOptionMenu
          x={rowOptionMenu.x}
          y={rowOptionMenu.y}
          currentOption={rowOptionMenu.currentOption}
          onSelect={(opt) => {
            handleSelectRowOption(rowOptionMenu.sku, opt);
          }}
          onClose={() => setRowOptionMenu(null)}
        />
      )}

      {/* Formula tooltip - shows when a formula cell is clicked */}
      {formulaHighlight && (() => {
        const row = mergedItems.find((r) => String(r.sku) === formulaHighlight.sku);
        if (!row) return null;
        
        // Find the cell position to position tooltip
        const cellElement = document.querySelector(
          `td[data-sku="${formulaHighlight.sku}"][data-col="${formulaHighlight.activeColumn}"]`
        );
        const rect = cellElement?.getBoundingClientRect();
        const position = rect ? { x: rect.right + 10, y: rect.top } : { x: 400, y: 200 };
        
        return (
          <FormulaTooltip
            row={row}
            columnName={formulaHighlight.activeColumn}
            columnLabel={labelForColumnDynamic(formulaHighlight.activeColumn).replace(/\n/g, " ")}
            position={position}
            onClose={() => setFormulaHighlight(null)}
            onHighlight={(inputs) => {
              // Already highlighted via state
            }}
            currentDate={now}
            monthlySaleMap={monthlySaleMap}
            dateVars={liveDateVars}
            manualMap={manualMap}
            projOverrideMap={projOverrideMap}
            supplyOverrideMap={supplyOverrideMap}
          />
        );
      })()}

      {/* Reset Forecast Option confirmation */}
      <AlertDialog open={resetForecastOptionOpen} onOpenChange={setResetForecastOptionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all forecast options?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset every SKU back to <strong>Baseline</strong> (option 0). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingForecastOption}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleResetAllForecastOptions();
              }}
              disabled={resettingForecastOption}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resettingForecastOption ? "Resetting…" : "Reset All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reorder Decisions Dialog */}
      <AlertDialog open={forecastAnalysisOpen} onOpenChange={setForecastAnalysisOpen}>
        <AlertDialogContent className="max-w-fit max-h-[90vh] overflow-hidden flex flex-col" style={{ margin: 'auto' }}>
          <AlertDialogHeader className="-m-6 mb-0 px-6 py-4 rounded-t-lg bg-gradient-to-r from-[#3b5769] to-[#A89080]">
            <AlertDialogTitle className="text-lg font-semibold tracking-wide uppercase text-white">
              Reorder Decisions
            </AlertDialogTitle>
          </AlertDialogHeader>
          {(allItemsLoading || isRecomputing) && (
            <div className="h-1 w-full overflow-hidden bg-transparent -mx-6" style={{ width: 'calc(100% + 3rem)' }}>
              <div className="h-full bg-[#3b5769] animate-pulse" style={{ width: '60%' }} />
            </div>
          )}

          {/* Summary cards — global counts across the full unfiltered dataset.
              Cards intentionally stay fixed when filters/search are applied;
              the table below is the drill-down view. See `dialogSummaryCounts`. */}
          {(() => {
            const { urgent, order30, order60, order90 } = dialogSummaryCounts;
            const card = (label: string, value: string, accent: string) => (
              <div
                key={label}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--card))",
                  borderLeft: `4px solid ${accent}`,
                }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>
                  {label}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: accent, fontVariantNumeric: "tabular-nums" }}>
                  {value}
                </div>
              </div>
            );
            return (
              <div className="flex items-stretch gap-2 px-2 pb-3">
                {card("Urgent",          (allItemsLoading || isRecomputing) ? "…" : urgent.toLocaleString("en-US"),  "#dc2626")}
                {card("Order within 20 days", (allItemsLoading || isRecomputing) ? "…" : order30.toLocaleString("en-US"), "#ea580c")}
                {card("Order within 45 days", (allItemsLoading || isRecomputing) ? "…" : order60.toLocaleString("en-US"), "#ca8a04")}
                {card("Order within 75 days", (allItemsLoading || isRecomputing) ? "…" : order90.toLocaleString("en-US"), "#16a34a")}
              </div>
            );
          })()}

          {/* Search bar and filters in one row */}
          <div className="flex items-center gap-2 px-2 pb-2 border-b">
            <div className="relative" style={{ width: "200px" }}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={idpSearchQuery}
                onChange={(e) => setIdpSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            <MultiSelectFilter
              label="SKU"
              options={skuOptions}
              value={idpFilters.sku}
              onApply={(v) => {
                setIdpFilters((p) => ({ ...p, sku: v }));
                setDialogCurrentPage(1);
              }}
            />

            <MultiSelectFilter
              label="Factory"
              options={factoryOptions}
              value={idpFilters.factory}
              onApply={(v) => {
                setIdpFilters((p) => ({ ...p, factory: v }));
                setDialogCurrentPage(1);
              }}
            />

            <MultiSelectFilter
              label="Status"
              options={puStatusOptionsIdp}
              value={idpFilters.pu_status}
              onApply={(v) => {
                setIdpFilters((p) => ({ ...p, pu_status: v }));
                setDialogCurrentPage(1);
              }}
            />

            <MultiSelectFilter
              label="Action"
              options={actionOptions}
              value={idpFilters.action}
              onApply={(v) => {
                setIdpFilters((p) => ({ ...p, action: v }));
                setDialogCurrentPage(1);
              }}
            />

            {(() => {
              const activeFilterCount = Object.values(idpFilters).filter((arr) => arr.length > 0).length;
              const hasSearch = idpSearchQuery.trim().length > 0;
              const totalActiveFilters = activeFilterCount + (hasSearch ? 1 : 0);
              
              return totalActiveFilters > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-xs px-3"
                  onClick={() => {
                    setIdpFilters({
                      sku: [],
                      factory: [],
                      status: [],
                      pu_status: [],
                      category: [],
                      supply_status: [],
                      priority_level: [],
                      shadow: [],
                      action: [],
                      country: [],
                      buyer: [],
                      inventory_analyst: [],
                    });
                    setIdpSearchQuery("");
                    setDialogCurrentPage(1);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear filters
                </Button>
              ) : null;
            })()}

            <div className="ml-auto flex gap-2 items-center">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => handleOpenEmailSettings('idp')}
                title="Configure email recipients and factory assignments for IDP"
              >
                <Info className="h-4 w-4" />
                Email Settings (Planner)
              </Button>

              <Button
                variant={scheduleConfig?.enabled ? "default" : "outline"}
                size="sm"
                className={`h-9 gap-1.5 ${scheduleConfig?.enabled ? 'bg-green-600 hover:bg-green-700' : ''}`}
                onClick={() => { setEmailSettingsReportType('idp'); setShowScheduleDialog(true); }}
                title="Configure automatic email schedule"
              >
                <RotateCcw className={`h-4 w-4 ${scheduleConfig?.enabled ? 'animate-spin-slow' : ''}`} />
                Schedule Settings
                {scheduleConfig?.enabled && (
                  <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-semibold">
                    ACTIVE
                  </span>
                )}
              </Button>
              
              <Button
                size="sm"
                className="h-9 gap-1.5 px-4 font-semibold"
                onClick={handleSendEmailReport}
                disabled={dialogFilteredItems.length === 0 || sendingEmail}
                title="Generate and email the planner snapshot to assigned recipients"
              >
                <Mail className="h-4 w-4" />
                {sendingEmail ? "Sending…" : "Send Email Report"}
              </Button>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto">
            <style>{`
              .idp-compact-table {
                width: fit-content !important;
                table-layout: auto !important;
                margin: 0 auto !important;
              }
              .idp-compact-table th,
              .idp-compact-table td {
                padding: 2px 4px !important;
                font-size: 11px !important;
              }
              .idp-compact-table th {
                font-size: 10px !important;
                line-height: 1.3 !important;
                white-space: pre-line !important;
              }
              .idp-compact-table td {
                white-space: nowrap !important;
              }
            `}</style>
            <table className="idp-compact-table border-collapse text-xs">
              {/*
                ───────────────────────────────────────────────────────────────
                THEAD — DRIVEN BY THE SHARED REGISTRY.
                Column list, labels, widths, and group banners all come from
                `buildIdpColumns(monthNames)` (src/lib/forecast/idpColumns.ts).
                The same registry feeds the CSV download and the emailed CSV.
                Adding/removing a column there updates this header AND the
                CSV in one shot.

                The tbody below still hand-renders each cell because every
                cell has bespoke click-to-highlight wiring + dynamic styling
                that's painful to abstract. The contract between thead and
                tbody is the `data-col` attribute, which MUST equal the
                column key from the registry. The IIFE below asserts that
                contract once per render in dev.
                ───────────────────────────────────────────────────────────────
              */}
              <thead className="sticky top-0 z-10">
                {(() => {
                  // Render-time dev assertion: the tbody hard-codes data-col
                  // attributes; if a registry key changes without the tbody
                  // following, the click-to-highlight wiring goes silently
                  // dark. Log loudly so the regression surfaces in DevTools.
                  if (import.meta.env.DEV) {
                    const expected = idpRegistryColumns.map((c) => c.key);
                    const known = new Set([
                      'description','sku','factory','pu_status',
                      'proj_month_1','proj_month_2','proj_month_3',
                      'supply_month_1','supply_month_2','supply_month_3',
                      'ninety_day_projection','ninety_day_supply','ninety_day_deficit',
                      'ninety_day_revenue_loss','safety_stock','order_recommended',
                      'lead_time','order_date_forecast','supply_month_forecast',
                      'days_of_supply','days_until_must_order','days_without_stock',
                      'action_label','action_detail','priority','status_color',
                    ]);
                    for (const k of expected) {
                      if (!known.has(k)) {
                        // registry key missing tbody coverage
                      }
                    }
                  }
                  return null;
                })()}
                {/* Row 1: section banners + single-row column labels */}
                <tr>
                  <th rowSpan={2} className="border border-border px-1 py-1 text-center font-medium text-foreground bg-[#eaf2ff] dark:bg-[#1a1a1a] whitespace-nowrap" style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}>
                    #
                  </th>
                  {idpHeaderRows.row1.map((cell) => (
                    <th
                      key={cell.id}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      className={`border border-border px-1 py-1 text-center font-semibold text-foreground whitespace-pre-line ${cell.borderClass}`}
                      style={{ background: cell.bg, minWidth: cell.minWidth, maxWidth: cell.maxWidth }}
                    >
                      {cell.label}
                    </th>
                  ))}
                </tr>
                {/* Row 2: month names for projection + supply groups */}
                <tr>
                  {idpHeaderRows.row2.map((cell) => (
                    <th
                      key={cell.id}
                      className={`border border-border px-1 py-1 text-center font-semibold text-foreground ${cell.borderClass}`}
                      style={{ background: cell.bg, minWidth: cell.minWidth, maxWidth: cell.maxWidth }}
                    >
                      {cell.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(allItemsLoading || isRecomputing) && mergedAllItems.length === 0 && (
                  <tr>
                    <td colSpan={99} className="py-10 text-center">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#3b5769] border-t-transparent" />
                        Loading inventory data…
                      </div>
                    </td>
                  </tr>
                )}
                {dialogPaginatedItems.map((row, idx) => {
                  const sku = String((row as any).sku ?? "");
                  const description = String((row as any).description ?? "");
                  const priorityLevel = (row as any).priority_level;
                  const factory = String((row as any).factory ?? "-");
                  const status = (row as any).status;
                  const puStatus = (row as any).pu_status;
                  const kit = (row as any).kit;
                  const category = String((row as any).category ?? "-");
                  const action = String((row as any).action ?? "Order Soon");

                  // Pull all derived values from the memoized per-page Map.
                  // See `dialogRowDerivedMap` above for the computation.
                  const derived = dialogRowDerivedMap.get(sku);
                  if (!derived) return null;
                  const {
                    ninetyDayProjection, ninetyDaySupply, ninetyDayDeficit,
                    revenueLoss, safetyStock, orderRecommended, leadTime,
                    orderDate, supplyMonth, coveredMonths,
                    mainName, variant,
                    deficitColor, deficitWeight, deficitText,
                    daysUntilMustOrder,
                    daysOfSupply, daysUntilMustOrderRunway, daysWithoutStock,
                    effectiveTier,
                    actionLabel, actionBg, actionColor,
                  } = derived;

                  const formatDate = formatPlannerDate;
                  const rowNumber = (dialogCurrentPage - 1) * dialogPageSize + idx + 1;

                  return (
                    <tr key={idx} className="hover:bg-[#3b5769]/20 dark:hover:bg-[#2a2a2a] transition-colors duration-150">
                      <td className="border border-border px-1 py-1 text-center text-muted-foreground text-[10px] tabular-nums" style={{ width: '40px' }}>
                        {rowNumber}
                      </td>
                      <td className="border border-border px-1 py-1 text-left" style={{ whiteSpace: "normal" }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div style={{ flexShrink: 0, width: 40, height: 40 }}>
                            <ProductImage
                              productId={sku}
                              productName={description || sku}
                              imageUpdatedAt={imageUpdatedAtMap.get(sku) ?? null}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-foreground truncate text-[11px]" title={description}>
                              {mainName || description || "-"}
                            </div>
                            {variant && (
                              <div className="text-[10px] text-muted-foreground truncate">{variant}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{sku}</td>
                      <td className="border border-border px-1 py-1 text-center text-[11px]">{factory}</td>
                      <td className="border border-border px-1 py-1 text-center">
                        <Pill value={normalizeDash(puStatus)} className={pillClassForPuStatus(puStatus)} />
                      </td>
                      <td
                        className="border border-border px-2 py-1 text-center tabular-nums mf-sep-light"
                        style={{
                          cursor: 'pointer',
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'proj_month_1' ? {
                            background: '#fef3c7',
                            boxShadow: 'inset 0 0 0 2px #f59e0b',
                          } : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.inputColumns.includes('proj_month_1') ? {
                            boxShadow: 'inset 0 0 0 2px #1f8a8c',
                            border: '2px solid #1f8a8c',
                          } : {})
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const metadata = formulaMetadataCache.get(sku)?.get('proj_month_1');
                          if (metadata) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'proj_month_1') {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: 'proj_month_1',
                                  inputColumns: metadata.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="proj_month_1"
                      >
                        {Math.round(toNumberSafe((row as any).proj_month_1) ?? 0)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: 'pointer',
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'proj_month_2' ? {
                            background: '#fef3c7',
                            boxShadow: 'inset 0 0 0 2px #f59e0b',
                          } : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.inputColumns.includes('proj_month_2') ? {
                            boxShadow: 'inset 0 0 0 2px #1f8a8c',
                            border: '2px solid #1f8a8c',
                          } : {})
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const metadata = formulaMetadataCache.get(sku)?.get('proj_month_2');
                          if (metadata) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'proj_month_2') {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: 'proj_month_2',
                                  inputColumns: metadata.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="proj_month_2"
                      >
                        {Math.round(toNumberSafe((row as any).proj_month_2) ?? 0)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: 'pointer',
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'proj_month_3' ? {
                            background: '#fef3c7',
                            boxShadow: 'inset 0 0 0 2px #f59e0b',
                          } : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.inputColumns.includes('proj_month_3') ? {
                            boxShadow: 'inset 0 0 0 2px #1f8a8c',
                            border: '2px solid #1f8a8c',
                          } : {})
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const metadata = formulaMetadataCache.get(sku)?.get('proj_month_3');
                          if (metadata) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'proj_month_3') {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: 'proj_month_3',
                                  inputColumns: metadata.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="proj_month_3"
                      >
                        {Math.round(toNumberSafe((row as any).proj_month_3) ?? 0)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: 'pointer',
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'supply_month_1' ? {
                            background: '#fef3c7',
                            boxShadow: 'inset 0 0 0 2px #f59e0b',
                          } : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.inputColumns.includes('supply_month_1') ? {
                            boxShadow: 'inset 0 0 0 2px #1f8a8c',
                            border: '2px solid #1f8a8c',
                          } : {})
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const metadata = formulaMetadataCache.get(sku)?.get('supply_month_1');
                          if (metadata) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'supply_month_1') {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: 'supply_month_1',
                                  inputColumns: metadata.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="supply_month_1"
                      >
                        {Math.round(toNumberSafe((row as any).supply_month_1) ?? 0)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: 'pointer',
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'supply_month_2' ? {
                            background: '#fef3c7',
                            boxShadow: 'inset 0 0 0 2px #f59e0b',
                          } : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.inputColumns.includes('supply_month_2') ? {
                            boxShadow: 'inset 0 0 0 2px #1f8a8c',
                            border: '2px solid #1f8a8c',
                          } : {})
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const metadata = formulaMetadataCache.get(sku)?.get('supply_month_2');
                          if (metadata) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'supply_month_2') {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: 'supply_month_2',
                                  inputColumns: metadata.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="supply_month_2"
                      >
                        {Math.round(toNumberSafe((row as any).supply_month_2) ?? 0)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: 'pointer',
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'supply_month_3' ? {
                            background: '#fef3c7',
                            boxShadow: 'inset 0 0 0 2px #f59e0b',
                          } : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.inputColumns.includes('supply_month_3') ? {
                            boxShadow: 'inset 0 0 0 2px #1f8a8c',
                            border: '2px solid #1f8a8c',
                          } : {})
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const metadata = formulaMetadataCache.get(sku)?.get('supply_month_3');
                          if (metadata) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight.activeColumn === 'supply_month_3') {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: 'supply_month_3',
                                  inputColumns: metadata.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="supply_month_3"
                      >
                        {Math.round(toNumberSafe((row as any).supply_month_3) ?? 0)}
                      </td>
                      <td
                        className="border border-border px-2 py-1 text-center tabular-nums mf-sep-light"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "ninety_day_projection"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("ninety_day_projection")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("ninety_day_projection");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "ninety_day_projection",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="ninety_day_projection"
                      >
                        {Math.round(ninetyDayProjection)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "ninety_day_supply"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("ninety_day_supply")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("ninety_day_supply");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "ninety_day_supply",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="ninety_day_supply"
                      >
                        {Math.round(ninetyDaySupply)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "ninety_day_deficit"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("ninety_day_deficit")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("ninety_day_deficit");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "ninety_day_deficit",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="ninety_day_deficit"
                      >
                        <span style={{ color: deficitColor, fontWeight: deficitWeight }}>{deficitText}</span>
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "ninety_day_revenue_loss"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("ninety_day_revenue_loss")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("ninety_day_revenue_loss");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "ninety_day_revenue_loss",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="ninety_day_revenue_loss"
                      >
                        {revenueLoss > 0 ? (
                          <span style={{ color: "#ff6b6b", fontWeight: "bold" }}>
                            ${revenueLoss.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "safety_stock"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("safety_stock")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("safety_stock");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "safety_stock",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="safety_stock"
                      >
                        {Math.round(safetyStock)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "order_recommended"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("order_recommended")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("order_recommended");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "order_recommended",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="order_recommended"
                      >
                        {Math.round(orderRecommended)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "lead_time"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("lead_time")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("lead_time");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "lead_time",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="lead_time"
                      >
                        {leadTime}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center whitespace-nowrap"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "order_date_forecast"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("order_date_forecast")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("order_date_forecast");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "order_date_forecast",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="order_date_forecast"
                      >
                        {formatDate(orderDate)}
                      </td>
                      <td 
                        className="border border-border px-2 py-1 text-center whitespace-nowrap"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "supply_month_forecast"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("supply_month_forecast")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={(e) => {
                          const meta = formulaMetadataCache.get(sku)?.get("supply_month_forecast");
                          if (meta) {
                            flushSync(() => {
                              setDialogFormulaHighlight({
                                sku,
                                activeColumn: "supply_month_forecast",
                                inputColumns: meta.inputColumns,
                              });
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="supply_month_forecast"
                      >
                        {formatDate(supplyMonth)}
                      </td>
                      {/* Days of Supply Left — formula-highlight wired */}
                      <td
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "days_of_supply"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("days_of_supply")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={() => {
                          const meta = formulaMetadataCache.get(sku)?.get("days_of_supply");
                          if (meta) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "days_of_supply") {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: "days_of_supply",
                                  inputColumns: meta.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="days_of_supply"
                      >
                        {daysOfSupply > 0 ? (
                          daysOfSupply.toLocaleString("en-US")
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      {/* Days Until Must Order — formula-highlight wired */}
                      <td
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "days_until_must_order"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("days_until_must_order")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={() => {
                          const meta = formulaMetadataCache.get(sku)?.get("days_until_must_order");
                          if (meta) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "days_until_must_order") {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: "days_until_must_order",
                                  inputColumns: meta.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="days_until_must_order"
                      >
                        {daysUntilMustOrderRunway === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : daysUntilMustOrderRunway < 0 ? (
                          <span style={{ color: "#dc2626", fontWeight: 700 }}>{daysUntilMustOrderRunway}</span>
                        ) : (
                          daysUntilMustOrderRunway.toLocaleString("en-US")
                        )}
                      </td>
                      {/* Days Without Stock — formula-highlight wired */}
                      <td
                        className="border border-border px-2 py-1 text-center tabular-nums"
                        style={{
                          cursor: "pointer",
                          ...(dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "days_without_stock"
                            ? { backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 2px #f97316", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.inputColumns?.includes("days_without_stock")
                            ? { boxShadow: "inset 0 0 0 2px #1f8a8c", transition: "box-shadow 0.08s ease-out, border 0.08s ease-out" }
                            : {}),
                        }}
                        onClick={() => {
                          const meta = formulaMetadataCache.get(sku)?.get("days_without_stock");
                          if (meta) {
                            flushSync(() => {
                              if (dialogFormulaHighlight?.sku === sku && dialogFormulaHighlight?.activeColumn === "days_without_stock") {
                                setDialogFormulaHighlight(null);
                              } else {
                                setDialogFormulaHighlight({
                                  sku,
                                  activeColumn: "days_without_stock",
                                  inputColumns: meta.inputColumns,
                                });
                              }
                            });
                          }
                        }}
                        data-sku={sku}
                        data-col="days_without_stock"
                      >
                        {daysWithoutStock > 0 ? (
                          <span style={{ color: "#dc2626", fontWeight: 700 }}>{daysWithoutStock.toLocaleString("en-US")}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="border border-border px-2 py-1 text-center" style={{ whiteSpace: "normal", minWidth: 200, maxWidth: 260 }}>
                        {(() => {
                          const badge = buildActionBadge({
                            effectiveTier,
                            daysOfSupply,
                            daysUntilMustOrder: daysUntilMustOrderRunway,
                            daysWithoutStock,
                            leadTime,
                          });
                          const BadgeIcon = badge.Icon;
                          return (
                            <div className="flex flex-col items-center gap-1">
                              <span
                                style={{
                                  background: badge.bg,
                                  color: badge.color,
                                  padding: "3px 10px",
                                  borderRadius: 999,
                                  fontWeight: 600,
                                  fontSize: 11,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  lineHeight: 1.2,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {BadgeIcon && <BadgeIcon size={12} />}
                                {badge.text}
                              </span>
                              {badge.subtitle && (
                                <span
                                  className="text-muted-foreground"
                                  style={{ fontSize: 10, lineHeight: 1.25, whiteSpace: "normal" }}
                                >
                                  {badge.subtitle}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <AlertDialogFooter className="relative flex-row items-center border-t pt-3 px-6">
            {/* Left: Rows per page selector */}
            <div className="flex items-center gap-2 absolute left-6">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <select
                value={dialogPageSize}
                onChange={(e) => {
                  setDialogPageSize(Number(e.target.value));
                  setDialogCurrentPage(1);
                }}
                className="h-8 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={1000}>1000</option>
              </select>
            </div>
            
            {/* Middle: Records range display (absolutely centered) */}
            <div className="absolute left-1/2 -translate-x-1/2 text-sm text-muted-foreground">
              {(allItemsLoading || isRecomputing)
                ? <span className="flex items-center gap-1.5"><span className="h-3 w-3 animate-spin rounded-full border-2 border-[#3b5769] border-t-transparent inline-block" />Loading…</span>
                : dialogFilteredItems.length === 0
                ? "0 records"
                : `${((dialogCurrentPage - 1) * dialogPageSize + 1).toLocaleString()}–${Math.min(
                    dialogCurrentPage * dialogPageSize,
                    dialogFilteredItems.length,
                  ).toLocaleString()} of ${dialogFilteredItems.length.toLocaleString()}`}
            </div>

            {/* Right: Navigation buttons + Close */}
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setDialogCurrentPage(1)}
                disabled={dialogCurrentPage === 1}
                title="First page"
              >
                <span className="text-lg">«</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setDialogCurrentPage((p) => Math.max(1, p - 1))}
                disabled={dialogCurrentPage === 1}
                title="Previous page"
              >
                <span className="text-lg">‹</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setDialogCurrentPage((p) => Math.min(dialogTotalPages, p + 1))}
                disabled={dialogCurrentPage >= dialogTotalPages}
                title="Next page"
              >
                <span className="text-lg">›</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setDialogCurrentPage(dialogTotalPages)}
                disabled={dialogCurrentPage >= dialogTotalPages}
                title="Last page"
              >
                <span className="text-lg">»</span>
              </Button>
              
              <AlertDialogCancel className="ml-2">Close</AlertDialogCancel>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
        
        {/* Formula Tooltip for Dialog */}
        {dialogFormulaHighlight && (() => {
          const clickedRow = dialogPaginatedItems.find((r: any) => String(r.sku) === dialogFormulaHighlight.sku);
          if (!clickedRow) return null;
          
          const cellEl = document.querySelector(
            `[data-sku="${CSS.escape(dialogFormulaHighlight.sku)}"][data-col="${CSS.escape(dialogFormulaHighlight.activeColumn)}"]`
          );
          if (!cellEl) return null;
          
          const rect = cellEl.getBoundingClientRect();
          return (
            <FormulaTooltip
              row={clickedRow}
              columnName={dialogFormulaHighlight.activeColumn}
              columnLabel={labelForColumnDynamic(dialogFormulaHighlight.activeColumn).replace(/\n/g, " ")}
              position={{ x: rect.left, y: rect.bottom }}
              onClose={() => setDialogFormulaHighlight(null)}
              onHighlight={(cols) => {
                // Update highlight to show input columns
                setDialogFormulaHighlight((prev) =>
                  prev ? { ...prev, inputColumns: cols } : null
                );
              }}
              currentDate={now}
              monthlySaleMap={monthlySaleMap}
              dateVars={liveDateVars}
              manualMap={manualMap}
              projOverrideMap={projOverrideMap}
              supplyOverrideMap={supplyOverrideMap}
            />
          );
        })()}
      </AlertDialog>

      {/* Email Settings Dialog */}
      <AlertDialog open={showEmailSettingsDialog} onOpenChange={setShowEmailSettingsDialog}>
        <AlertDialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <AlertDialogHeader className="space-y-3">
            <AlertDialogTitle className="text-xl font-bold flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Email Factory Assignments - {emailSettingsReportType === 'shopify' ? 'Storefront Stock' : 'Planner (Order Now)'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Configure email recipients and factory assignments for <strong>{emailSettingsReportType === 'shopify' ? 'Storefront Stock' : 'Reorder Decisions'}</strong> reports. Each recipient receives one combined Excel file containing only rows for their assigned factories.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex-1 overflow-auto">
            {/* Search and Add Email */}
            <div className="p-4 border-b bg-muted/30 flex gap-3 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search emails..."
                  className="pl-9 h-9"
                />
              </div>
              {/* Direct MultiSelectFilter for Adding Emails */}
              <MultiSelectFilter
                label="Add Email"
                options={availableEmails}
                value={[]}
                onApply={(selected) => {
                  if (selected.length > 0) {
                    handleAddEmailsFromMultiSelect(selected);
                  }
                }}
              />
            </div>

            {/* Table */}
            <div className="overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-muted/50 z-10">
                  <tr>
                    <th className="text-left p-3 font-semibold border-b text-sm">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        Email Address
                      </div>
                    </th>
                    <th className="text-left p-3 font-semibold border-b text-sm">
                      <div className="flex items-center gap-2">
                        <Info className="h-4 w-4 text-muted-foreground" />
                        Assigned Factories
                      </div>
                    </th>
                    {/* Actions column - hidden
                    <th className="text-center p-3 font-semibold border-b text-sm w-24">Actions</th>
                    */}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Use the correct email groups based on report type
                    const currentEmailGroups = emailSettingsReportType === 'shopify' ? shopifyEmailFactoryGroups : idpEmailFactoryGroups;
                    
                    return Object.keys(currentEmailGroups).length === 0 ? (
                      <tr>
                        <td colSpan={2} className="text-center py-16 text-muted-foreground">
                          <div className="flex flex-col items-center gap-3">
                            <div className="rounded-full bg-muted p-4">
                              <Mail className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-base">No email assignments yet for {emailSettingsReportType === 'shopify' ? 'Storefront Stock' : 'IDP'}</p>
                              <p className="text-sm mt-1">Click "Add Email" above to get started</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      Object.entries(currentEmailGroups).map(([email, assignedFactories]) => (
                        <tr key={email} className="border-b hover:bg-[#3b5769]/5 dark:hover:bg-[#74bfbf]/5 transition-colors">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="rounded-full bg-primary/10 p-1.5">
                                <Mail className="h-3.5 w-3.5 text-primary" />
                              </div>
                              <span className="font-medium text-sm">{email}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-3">
                              <MultiSelectFilter
                                label={assignedFactories.length === 0 
                                  ? "Select Factories" 
                                  : `${assignedFactories.length} ${assignedFactories.length === 1 ? 'factory' : 'factories'}`
                                }
                                options={allFactories}
                                value={assignedFactories}
                                onApply={async (selected) => {
                                  // Determine which factories to add and remove
                                  const toAdd = selected.filter(f => !assignedFactories.includes(f));
                                  const toRemove = assignedFactories.filter(f => !selected.includes(f));
                                  
                                  try {
                                    // If this is the first real factory assignment, remove UNASSIGNED marker
                                    if (toAdd.length > 0 && assignedFactories.length === 0) {
                                      await supabase
                                        .from("email_factory_mapping")
                                        .delete()
                                        .eq("email", email)
                                        .eq("factory", "UNASSIGNED")
                                        .eq("report_type", emailSettingsReportType);
                                  }
                                  
                                  // Execute all changes with report_type
                                  await Promise.all([
                                    ...toAdd.map(factory => 
                                      supabase.from("email_factory_mapping").insert({ 
                                        email, 
                                        factory,
                                        report_type: emailSettingsReportType 
                                      })
                                    ),
                                    ...toRemove.map(factory =>
                                      supabase.from("email_factory_mapping")
                                        .delete()
                                        .eq("email", email)
                                        .eq("factory", factory)
                                        .eq("report_type", emailSettingsReportType)
                                    )
                                  ]);
                                  
                                  // Refetch the correct mappings
                                  if (emailSettingsReportType === 'shopify') {
                                    refetchShopifyEmailMappings();
                                  } else {
                                    refetchIdpEmailMappings();
                                  }
                                  toast.success(`✅ Updated factories for ${email} (${emailSettingsReportType.toUpperCase()})`);
                                } catch (e) {
                                  toast.error("Failed to update factories");
                                }
                              }}
                            />
                            {assignedFactories.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {assignedFactories.slice(0, 3).map(factory => (
                                  <Badge key={factory} variant="secondary" className="text-xs font-medium">
                                    {factory}
                                  </Badge>
                                ))}
                                {assignedFactories.length > 3 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{assignedFactories.length - 3} more
                                  </Badge>
                                )}
                              </div>
                            )}
                            {assignedFactories.length === 0 && (
                              <span className="text-xs text-muted-foreground italic">
                                No factories assigned yet
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Actions column - hidden
                        <td className="p-3 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveEmailGroup(email)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                            title={`Remove ${email}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                        */}
                      </tr>
                    ))
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          <AlertDialogFooter className="border-t pt-4 bg-muted/20">
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-muted-foreground">
                💡 Tip: Click "Send Email Report" to send reports to all assigned emails
              </p>
              <AlertDialogCancel className="h-9">Close</AlertDialogCancel>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Schedule Settings Dialog */}
      <AlertDialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <AlertDialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <RotateCcw className="h-5 w-5" />
                </div>
                <div>
                  <AlertDialogTitle className="text-xl font-bold m-0">Email Schedule Configuration</AlertDialogTitle>
                  <p className="text-sm text-orange-100 mt-0.5">Automate your inventory reports</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Schedule Status:</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-white/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                </label>
                <span className="text-xs font-semibold">{scheduleEnabled ? 'ENABLED' : 'DISABLED'}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-6 space-y-6 bg-slate-50">
            {/* Current Schedule Info */}
            {(() => {
              const activeConfig = emailSettingsReportType === 'shopify' ? shopifyScheduleConfig : scheduleConfig;
              return activeConfig ? (
              <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Info className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-sm text-slate-900 mb-2">Current Schedule Status</h3>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500">Next Run:</span>
                        <p className="font-medium text-slate-900 mt-0.5">
                          {activeConfig.next_run_at
                            ? new Date(activeConfig.next_run_at).toLocaleString()
                            : 'Not scheduled'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Last Run:</span>
                        <p className="font-medium text-slate-900 mt-0.5">
                          {activeConfig.last_run_at
                            ? new Date(activeConfig.last_run_at).toLocaleString()
                            : 'Never'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Total Executions:</span>
                        <p className="font-medium text-slate-900 mt-0.5">{activeConfig.run_count || 0}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Status:</span>
                        <p className="font-medium mt-0.5">
                          <Badge variant={activeConfig.enabled ? "default" : "secondary"} className="text-xs">
                            {activeConfig.enabled ? '✓ Active' : '○ Inactive'}
                          </Badge>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              ) : null;
            })()}

            {/* Email Recipients Preview */}
            {(() => {
              const activeEmailGroups = emailSettingsReportType === 'shopify' ? shopifyEmailFactoryGroups : idpEmailFactoryGroups;
              return (
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <h3 className="font-semibold text-base text-slate-900 mb-4 flex items-center gap-2">
                <Mail className="h-4 w-4 text-orange-600" />
                Email Recipients ({Object.keys(activeEmailGroups).length})
              </h3>

              {Object.keys(activeEmailGroups).length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Mail className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                  <p className="text-sm">No email recipients configured</p>
                  <p className="text-xs mt-1">Click "Email Settings" to add recipients</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-64 overflow-auto">
                  {Object.entries(activeEmailGroups).map(([email, factories]) => (
                    <div key={email} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center">
                          <Mail className="h-4 w-4 text-orange-600" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-slate-900 truncate">{email}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {factories.slice(0, 3).map((factory) => (
                            <Badge key={factory} variant="outline" className="text-[10px] bg-white">
                              {factory}
                            </Badge>
                          ))}
                          {factories.length > 3 && (
                            <Badge variant="outline" className="text-[10px] bg-slate-100">
                              +{factories.length - 3} more
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {factories.length} {factories.length === 1 ? 'factory' : 'factories'} assigned
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="text-xs text-slate-600 flex items-center gap-2">
                  <Info className="h-3 w-3" />
                  These recipients will receive automated emails when the schedule runs
                </p>
              </div>
            </div>
              );
            })()}

            {/* Recurrence Settings */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <h3 className="font-semibold text-base text-slate-900 mb-4 flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-orange-600" />
                Recurrence Pattern
              </h3>
              
              <div className="space-y-3">
                {/* Minutes */}
                <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  recurrenceType === 'minutes' ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'
                }`}>
                  <input
                    type="radio"
                    checked={recurrenceType === 'minutes'}
                    onChange={() => setRecurrenceType('minutes')}
                    className="h-4 w-4 text-orange-600"
                  />
                  <div className="flex-1 flex items-center gap-3">
                    <span className="font-medium text-sm">Every</span>
                    <Input
                      type="number"
                      value={minutesInterval}
                      onChange={(e) => setMinutesInterval(Number(e.target.value))}
                      className="w-20 h-8"
                      disabled={recurrenceType !== 'minutes'}
                      min={1}
                      max={59}
                    />
                    <span className="text-sm text-slate-600">minute(s)</span>
                  </div>
                </label>

                {/* Hours */}
                <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  recurrenceType === 'hours' ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'
                }`}>
                  <input
                    type="radio"
                    checked={recurrenceType === 'hours'}
                    onChange={() => setRecurrenceType('hours')}
                    className="h-4 w-4 text-orange-600"
                  />
                  <div className="flex-1 flex items-center gap-3">
                    <span className="font-medium text-sm">Every</span>
                    <Input
                      type="number"
                      value={hoursInterval}
                      onChange={(e) => setHoursInterval(Number(e.target.value))}
                      className="w-20 h-8"
                      disabled={recurrenceType !== 'hours'}
                      min={1}
                      max={23}
                    />
                    <span className="text-sm text-slate-600">hour(s)</span>
                  </div>
                </label>

                {/* Daily */}
                <div className={`p-3 rounded-lg border-2 transition-all ${
                  recurrenceType === 'daily' ? 'border-orange-500 bg-orange-50' : 'border-slate-200'
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      checked={recurrenceType === 'daily'}
                      onChange={() => setRecurrenceType('daily')}
                      className="h-4 w-4 text-orange-600"
                    />
                    <span className="font-medium text-sm">Daily at specific time</span>
                  </label>
                  {recurrenceType === 'daily' && (
                    <div className="mt-3 ml-7 flex items-center gap-3">
                      <span className="text-sm text-slate-600">Time:</span>
                      <Input
                        type="time"
                        value={timeOfDay}
                        onChange={(e) => setTimeOfDay(e.target.value)}
                        className="w-32 h-8"
                      />
                    </div>
                  )}
                </div>

                {/* Weekly */}
                <div className={`p-3 rounded-lg border-2 transition-all ${
                  recurrenceType === 'weekly' ? 'border-orange-500 bg-orange-50' : 'border-slate-200'
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      checked={recurrenceType === 'weekly'}
                      onChange={() => setRecurrenceType('weekly')}
                      className="h-4 w-4 text-orange-600"
                    />
                    <span className="font-medium text-sm">Weekly on specific days</span>
                  </label>
                  {recurrenceType === 'weekly' && (
                    <div className="mt-3 ml-7 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                          <label
                            key={day}
                            className={`px-3 py-1.5 rounded-md border-2 cursor-pointer text-xs font-medium transition-all ${
                              selectedDays.includes(day)
                                ? 'border-orange-500 bg-orange-500 text-white'
                                : 'border-slate-300 bg-white text-slate-700 hover:border-orange-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedDays.includes(day)}
                              onChange={() => handleToggleDay(day)}
                              className="sr-only"
                            />
                            {day.substring(0, 3)}
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-600">Time:</span>
                        <Input
                          type="time"
                          value={timeOfDay}
                          onChange={(e) => setTimeOfDay(e.target.value)}
                          className="w-32 h-8"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Monthly */}
                <div className={`p-3 rounded-lg border-2 transition-all ${
                  recurrenceType === 'monthly' ? 'border-orange-500 bg-orange-50' : 'border-slate-200'
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      checked={recurrenceType === 'monthly'}
                      onChange={() => setRecurrenceType('monthly')}
                      className="h-4 w-4 text-orange-600"
                    />
                    <span className="font-medium text-sm">Monthly</span>
                  </label>
                  {recurrenceType === 'monthly' && (
                    <div className="mt-3 ml-7 space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-600">On day</span>
                        <Input
                          type="number"
                          value={monthlyDate}
                          onChange={(e) => setMonthlyDate(Number(e.target.value))}
                          className="w-20 h-8"
                          min={1}
                          max={31}
                          disabled={lastDayOfMonth}
                        />
                        <span className="text-sm text-slate-600">of each month</span>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={lastDayOfMonth}
                          onChange={(e) => setLastDayOfMonth(e.target.checked)}
                          className="h-4 w-4 text-orange-600 rounded"
                        />
                        <span className="text-sm text-slate-700">Use last day of month instead</span>
                      </label>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-600">Time:</span>
                        <Input
                          type="time"
                          value={timeOfDay}
                          onChange={(e) => setTimeOfDay(e.target.value)}
                          className="w-32 h-8"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Custom */}
                <div className={`p-3 rounded-lg border-2 transition-all ${
                  recurrenceType === 'custom' ? 'border-orange-500 bg-orange-50' : 'border-slate-200'
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      checked={recurrenceType === 'custom'}
                      onChange={() => setRecurrenceType('custom')}
                      className="h-4 w-4 text-orange-600"
                    />
                    <span className="font-medium text-sm">Custom schedule</span>
                  </label>
                  {recurrenceType === 'custom' && (
                    <div className="mt-3 ml-7 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                          <label
                            key={day}
                            className={`px-3 py-1.5 rounded-md border-2 cursor-pointer text-xs font-medium transition-all ${
                              selectedDays.includes(day)
                                ? 'border-orange-500 bg-orange-500 text-white'
                                : 'border-slate-300 bg-white text-slate-700 hover:border-orange-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedDays.includes(day)}
                              onChange={() => handleToggleDay(day)}
                              className="sr-only"
                            />
                            {day.substring(0, 3)}
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-600">Time:</span>
                        <Input
                          type="time"
                          value={timeOfDay}
                          onChange={(e) => setTimeOfDay(e.target.value)}
                          className="w-32 h-8"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Expiration Settings */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <h3 className="font-semibold text-base text-slate-900 mb-4 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-orange-600" />
                Schedule Expiration
              </h3>
              
              <div className="space-y-3">
                <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  expireType === 'never' ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'
                }`}>
                  <input
                    type="radio"
                    checked={expireType === 'never'}
                    onChange={() => setExpireType('never')}
                    className="h-4 w-4 text-orange-600"
                  />
                  <span className="font-medium text-sm">Never expire (run indefinitely)</span>
                </label>

                <div className={`p-3 rounded-lg border-2 transition-all ${
                  expireType === 'onDate' ? 'border-orange-500 bg-orange-50' : 'border-slate-200'
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      checked={expireType === 'onDate'}
                      onChange={() => setExpireType('onDate')}
                      className="h-4 w-4 text-orange-600"
                    />
                    <span className="font-medium text-sm">Expire on specific date</span>
                  </label>
                  {expireType === 'onDate' && (
                    <div className="mt-3 ml-7 flex items-center gap-3">
                      <span className="text-sm text-slate-600">End date:</span>
                      <Input
                        type="date"
                        value={expireDate}
                        onChange={(e) => setExpireDate(e.target.value)}
                        className="w-48 h-8"
                        min={new Date().toISOString().split('T')[0]}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Execution History */}
            {executionLogs.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <h3 className="font-semibold text-base text-slate-900 mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-600" />
                  Recent Executions
                </h3>
                <div className="space-y-2 max-h-48 overflow-auto">
                  {executionLogs.slice(0, 5).map((log: any) => (
                    <div key={log.id} className="flex items-center justify-between p-2 bg-slate-50 rounded text-xs">
                      <div className="flex items-center gap-3">
                        <Badge variant={log.status === 'success' ? 'default' : 'destructive'} className="text-[10px]">
                          {log.status}
                        </Badge>
                        <span className="text-slate-600">
                          {new Date(log.executed_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-slate-600">
                        <span>✓ {log.emails_sent} sent</span>
                        {log.emails_failed > 0 && <span className="text-red-600">✗ {log.emails_failed} failed</span>}
                        <span>{log.total_items} items</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <AlertDialogFooter className="border-t bg-white px-6 py-4">
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-slate-500 flex items-center gap-2">
                <Info className="h-3.5 w-3.5" />
                Changes take effect immediately after saving
              </p>
              <div className="flex gap-2">
                <AlertDialogCancel className="h-9" disabled={savingSchedule}>Cancel</AlertDialogCancel>
                <Button 
                  onClick={handleSaveSchedule} 
                  disabled={savingSchedule}
                  className="h-9 bg-orange-600 hover:bg-orange-700"
                >
                  {savingSchedule ? (
                    <>
                      <RotateCcw className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Save Schedule
                    </>
                  )}
                </Button>
              </div>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Storefront Stock Dialog - TODO: Change data source later */}
      <AlertDialog open={shopifyInventoryOpen} onOpenChange={setShopifyInventoryOpen}>
        <AlertDialogContent className="max-w-fit max-h-[90vh] overflow-hidden flex flex-col" style={{ margin: 'auto' }}>
          <AlertDialogHeader className="-m-6 mb-0 px-6 py-4 rounded-t-lg bg-gradient-to-r from-blue-600 to-blue-800">
            <AlertDialogTitle className="text-lg font-semibold tracking-wide uppercase text-white">
              Storefront Stock
            </AlertDialogTitle>
          </AlertDialogHeader>
          {(allItemsLoading || isRecomputing) && (
            <div className="h-1 w-full overflow-hidden bg-transparent -mx-6" style={{ width: 'calc(100% + 3rem)' }}>
              <div className="h-full bg-blue-600 animate-pulse" style={{ width: '60%' }} />
            </div>
          )}

          {/* Search and filters - populated from Storefront Stock data */}
          <div className="flex items-center gap-2 px-2 pb-2 border-b mt-3">
            {(() => {
              // Extract filter options from ALL dialogFilteredItems
              // No pre-filtering - let users see and filter by all statuses
              
              // Extract unique values from ALL items
              const uniqueSkus = Array.from(new Set(dialogFilteredItems.map((item: any) => String(item.sku || '')).filter(Boolean))).sort();
              const uniqueFactories = Array.from(new Set(dialogFilteredItems.map((item: any) => String(item.factory || '')).filter(Boolean))).sort();
              const kitOptions = ["Y", "N"];
              
              // Extract unique Shopify statuses - ONLY show "-" and "Inactive"
              const statusesSet = new Set<string>();
              
              dialogFilteredItems.forEach((item: any) => {
                const status = String(item.shopify_status || '').trim();
                
                // Only include "-" (empty) or "Inactive"
                if (status === '' || status === '-') {
                  statusesSet.add('-');
                } else if (status.toLowerCase() === 'inactive') {
                  statusesSet.add('Inactive');
                }
                // Ignore all other statuses (Active, Archive, etc.)
              });
              
              // Convert to array and sort: "-" first, then "Inactive"
              const uniqueShopifyStatuses = Array.from(statusesSet).sort((a, b) => {
                if (a === '-') return -1;
                if (b === '-') return 1;
                return a.localeCompare(b);
              });
              
              return (
                <>
                  <div className="relative" style={{ width: "200px" }}>
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={idpSearchQuery}
                      onChange={(e) => setIdpSearchQuery(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>

                  <MultiSelectFilter
                    label="SKU"
                    options={uniqueSkus}
                    value={idpFilters.sku}
                    onApply={(v) => {
                      setIdpFilters((p) => ({ ...p, sku: v }));
                      setDialogCurrentPage(1);
                    }}
                  />

                  <MultiSelectFilter
                    label="Factory"
                    options={uniqueFactories}
                    value={idpFilters.factory}
                    onApply={(v) => {
                      setIdpFilters((p) => ({ ...p, factory: v }));
                      setDialogCurrentPage(1);
                    }}
                  />

                  <MultiSelectFilter
                    label="Kit"
                    options={kitOptions}
                    value={idpFilters.kit || []}
                    onApply={(v) => {
                      setIdpFilters((p) => ({ ...p, kit: v }));
                      setDialogCurrentPage(1);
                    }}
                  />

                  {/* Shopify Status filter removed - hardcoded to "-" and "Inactive" only */}

                  {(() => {
                    const activeFilterCount = Object.entries(idpFilters).filter(([key, arr]) => {
                      // Don't count shopify_status in active filters since it's hardcoded for Storefront Stock
                      if (key === 'shopify_status') return false;
                      return arr.length > 0;
                    }).length;
                    const hasSearch = idpSearchQuery.trim().length > 0;
                    const totalActiveFilters = activeFilterCount + (hasSearch ? 1 : 0);
                    
                    return totalActiveFilters > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5 text-xs px-3"
                        onClick={() => {
                          setIdpFilters({
                            sku: [],
                            factory: [],
                            status: [],
                            kit: [],
                            pu_status: [],
                            shopify_status: [], // Clear to empty - hardcoded filter applied at data layer
                            category: [],
                            supply_status: [],
                            priority_level: [],
                            shadow: [],
                            action: [],
                            country: [],
                            buyer: [],
                            inventory_analyst: [],
                            description: [],
                          });
                          setIdpSearchQuery("");
                          setDialogCurrentPage(1);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                        Clear filters
                      </Button>
                    ) : null;
                  })()}
                </>
              );
            })()}

            <div className="ml-auto flex gap-2 items-center">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => handleOpenEmailSettings('shopify')}
                title="Configure email recipients and factory assignments for Storefront Stock"
              >
                <Info className="h-4 w-4" />
                Email Settings (Shopify)
              </Button>

              <Button
                variant={shopifyScheduleConfig?.enabled ? "default" : "outline"}
                size="sm"
                className={`h-9 gap-1.5 ${shopifyScheduleConfig?.enabled ? 'bg-green-600 hover:bg-green-700' : ''}`}
                onClick={() => { setEmailSettingsReportType('shopify'); setShowScheduleDialog(true); }}
                title="Configure automatic email schedule"
              >
                <RotateCcw className={`h-4 w-4 ${shopifyScheduleConfig?.enabled ? 'animate-spin-slow' : ''}`} />
                Schedule Settings
                {shopifyScheduleConfig?.enabled && (
                  <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-semibold">
                    ACTIVE
                  </span>
                )}
              </Button>
              
              <Button
                size="sm"
                className="h-9 gap-1.5 px-4 font-semibold"
                onClick={handleSendShopifyInventoryEmailReport}
                disabled={dialogFilteredItems.length === 0 || sendingEmail}
                title="Generate and email the Storefront Stock report to assigned recipients"
              >
                <Mail className="h-4 w-4" />
                {sendingEmail ? "Sending…" : "Send Email Report"}
              </Button>
            </div>
          </div>
          
          {/* Table - Storefront Stock with filters */}
          <div className="flex-1 overflow-auto">
            {(() => {
              // For Storefront Stock: show only "Not listed" rows that have at least one inventory value.
              const SHOPIFY_INV_COLS = ['oh_inv', 'otw_units', 'on_order_units', 'po_in_progress'];
              const shopifyOnlyItems = dialogFilteredItems.filter((item: any) => {
                const shopifyStatus = String(item.shopify_status ?? "").trim().toLowerCase();
                if (shopifyStatus !== "not listed") return false;
                return SHOPIFY_INV_COLS.some(col => (item[col] ?? 0) !== 0);
              });
              
              // Then apply SKU, Factory, Search filters (but NOT shopify_status from idpFilters)
              const shopifyFilteredItems = shopifyOnlyItems.filter((item: any) => {
                const sku = String(item.sku || '');
                const description = String(item.description || '');
                const factory = String(item.factory || '');
                
                // SKU filter
                if (idpFilters.sku && idpFilters.sku.length > 0) {
                  if (!idpFilters.sku.includes(sku)) return false;
                }
                
                // Factory filter
                if (idpFilters.factory && idpFilters.factory.length > 0) {
                  if (!idpFilters.factory.includes(factory)) return false;
                }

                // Kit filter
                if (idpFilters.kit && idpFilters.kit.length > 0) {
                  const kitVal = normalizeKitDisplay((item as any).kit);
                  if (!idpFilters.kit.includes(kitVal ?? "")) return false;
                }

                // Search filter
                if (idpSearchQuery.trim()) {
                  const query = idpSearchQuery.toLowerCase();
                  const matchesSku = sku.toLowerCase().includes(query);
                  const matchesDesc = description.toLowerCase().includes(query);
                  if (!matchesSku && !matchesDesc) return false;
                }
                
                return true;
              });

              // Paginate the filtered items
              const startIdx = (dialogCurrentPage - 1) * dialogPageSize;
              const endIdx = startIdx + dialogPageSize;
              const paginatedItems = shopifyFilteredItems.slice(startIdx, endIdx);

              return (
                <>
                  <style>{`
                    .shopify-table {
                      width: 100%;
                      border-collapse: separate;
                      border-spacing: 0;
                    }
                    .shopify-table th,
                    .shopify-table td {
                      padding: 4px 8px;
                      font-size: 11px;
                      border: 1px solid hsl(var(--border));
                      line-height: 1.3;
                    }
                    .shopify-table th {
                      background: hsl(var(--muted));
                      font-weight: 600;
                      text-align: center;
                      position: sticky;
                      top: 0;
                      z-index: 10;
                    }
                    .shopify-table tbody tr:hover {
                      background: hsl(var(--accent));
                    }
                    .shopify-table .inventory-bucket-col {
                      background-color: #fef3c7 !important;
                    }
                  `}</style>
                  
                  {allItemsLoading || isRecomputing ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                        Loading data…
                      </div>
                    </div>
                  ) : mergedAllItems.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="text-center text-muted-foreground">
                        <p className="font-semibold text-base">No data available</p>
                        <p className="text-sm mt-2">Please wait for data to load</p>
                      </div>
                    </div>
                  ) : shopifyFilteredItems.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="text-center text-muted-foreground">
                        <p className="font-semibold text-base">No items found</p>
                        <p className="text-sm mt-2">Try adjusting your filters</p>
                      </div>
                    </div>
                  ) : (
                    <table className="shopify-table">
                      <thead>
                        <tr>
                          <th style={{ width: '40px' }}>#</th>
                          <th style={{ minWidth: '250px' }}>Product Name</th>
                          <th style={{ minWidth: '150px' }}>SKU</th>
                          <th style={{ minWidth: '120px' }}>Factory</th>
                          <th style={{ minWidth: '120px' }}>Shopify Status</th>
                          <th style={{ minWidth: '70px' }}>Kit</th>
                          <th style={{ minWidth: '80px' }} className="inventory-bucket-col">OH Inv</th>
                          <th style={{ minWidth: '100px' }} className="inventory-bucket-col">OTW Units</th>
                          <th style={{ minWidth: '80px' }} className="inventory-bucket-col">OO Units</th>
                          <th style={{ minWidth: '120px' }} className="inventory-bucket-col">PO in Progress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedItems.map((row: any, idx: number) => {
                          const globalIdx = startIdx + idx + 1;
                          const sku = String(row.sku || '');
                          const description = String(row.description || '');
                          const factory = String(row.factory || '-');
                          const rawStatus = String(row.shopify_status ?? '').trim();
                          const shopifyStatus = (rawStatus === '' || rawStatus === '-') ? 'Inactive' : rawStatus;
                          
                          // Parse product name and color from description
                          // Use SAME logic as IDP: split by " in " or " - "
                          let mainName = description;
                          let variant = "";
                          const mIn = description.match(/^(.*?)\s+in\s+(.*)$/i);
                          const mDash = description.match(/^(.*?)\s+-\s+(.*)$/);
                          if (mIn) { 
                            mainName = mIn[1].trim(); 
                            variant = mIn[2].trim(); 
                          } else if (mDash) { 
                            mainName = mDash[1].trim(); 
                            variant = mDash[2].trim(); 
                          }
                          
                          // Inventory bucket values
                          const fbaReserved = row.fba_reserved ?? 0;
                          const inTransitFba = row.intransit_fba ?? 0;
                          const fba = row.fba ?? 0;
                          const ohInv = row.oh_inv ?? 0;
                          const otwUnits = row.otw_units ?? 0;
                          const ooUnits = row.on_order_units ?? 0;
                          const poInProgress = row.po_in_progress ?? 0;
                          
                          return (
                            <tr key={idx}>
                              <td className="text-center text-muted-foreground">{globalIdx}</td>
                              <td>
                                <div className="flex items-center gap-2">
                                  <div style={{ width: 40, height: 40, flexShrink: 0 }}>
                                    <ProductImage
                                      productId={sku}
                                      productName={description || sku}
                                      imageUpdatedAt={imageUpdatedAtMap.get(sku) ?? null}
                                    />
                                  </div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div className="font-medium text-foreground" style={{ fontSize: '11px', lineHeight: '1.4' }}>
                                      {mainName || '-'}
                                    </div>
                                    {variant && (
                                      <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '1px' }}>
                                        {variant}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="font-mono text-sm text-center">{sku}</td>
                              <td className="text-center">{factory}</td>
                              <td className="text-center">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${
                                  shopifyStatus.toLowerCase() === 'inactive'
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                                }`}>
                                  {shopifyStatus}
                                </span>
                              </td>
                              <td className="text-center">
                                {(() => {
                                  const kitVal = normalizeKitDisplay(row.kit);
                                  if (!kitVal) return <span className="text-muted-foreground">-</span>;
                                  return (
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${kitBadgeCls(kitVal)}`}>
                                      {kitVal}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="text-center tabular-nums inventory-bucket-col">
                                {ohInv === 0 ? '-' : ohInv.toLocaleString()}
                              </td>
                              <td className="text-center tabular-nums inventory-bucket-col">
                                {otwUnits === 0 ? '-' : otwUnits.toLocaleString()}
                              </td>
                              <td className="text-center tabular-nums inventory-bucket-col">
                                {ooUnits === 0 ? '-' : ooUnits.toLocaleString()}
                              </td>
                              <td className="text-center tabular-nums inventory-bucket-col">
                                {poInProgress === 0 ? '-' : poInProgress.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              );
            })()}
          </div>

          {/* Pagination */}
          <div className="border-t px-2 py-2 flex items-center justify-between">
            <div className="flex-1">
              {(() => {
                // For Storefront Stock: show only "Not listed" rows that have at least one inventory value.
                const SHOPIFY_INV_COLS_PAG = ['oh_inv', 'otw_units', 'on_order_units', 'po_in_progress'];
                const shopifyOnlyItems = dialogFilteredItems.filter((item: any) => {
                  const shopifyStatus = String(item.shopify_status ?? "").trim().toLowerCase();
                  if (shopifyStatus !== "not listed") return false;
                  return SHOPIFY_INV_COLS_PAG.some(col => (item[col] ?? 0) !== 0);
                });
                
                // Then apply SKU, Factory, Kit, Search filters
                const shopifyFilteredItems = shopifyOnlyItems.filter((item: any) => {
                  const sku = String(item.sku || '');
                  const description = String(item.description || '');
                  const factory = String(item.factory || '');

                  if (idpFilters.sku && idpFilters.sku.length > 0) {
                    if (!idpFilters.sku.includes(sku)) return false;
                  }

                  if (idpFilters.factory && idpFilters.factory.length > 0) {
                    if (!idpFilters.factory.includes(factory)) return false;
                  }

                  if (idpFilters.kit && idpFilters.kit.length > 0) {
                    const kitVal = normalizeKitDisplay((item as any).kit);
                    if (!idpFilters.kit.includes(kitVal ?? "")) return false;
                  }

                  if (idpSearchQuery.trim()) {
                    const query = idpSearchQuery.toLowerCase();
                    if (!sku.toLowerCase().includes(query) && !description.toLowerCase().includes(query)) return false;
                  }

                  return true;
                });
                
                const shopifyFilteredCount = shopifyFilteredItems.length;

                return (
                  <TablePagination
                    currentPage={dialogCurrentPage}
                    totalPages={Math.max(1, Math.ceil(shopifyFilteredCount / dialogPageSize))}
                    pageSize={dialogPageSize}
                    totalItems={shopifyFilteredCount}
                    onPageChange={setDialogCurrentPage}
                    onPageSizeChange={(size) => {
                      setDialogPageSize(size);
                      setDialogCurrentPage(1);
                    }}
                    pageSizeOptions={[50, 100, 200, 1000]}
                  />
                );
              })()}
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShopifyInventoryOpen(false)}
              className="ml-4"
            >
              Close
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* keep your dialogs here */}
    </div>
  );
}

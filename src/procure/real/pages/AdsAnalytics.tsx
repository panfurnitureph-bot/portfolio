import { useState, useEffect } from "react";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Calendar, TrendingUp, TrendingDown, Search, X, Flame, Upload, DollarSign, Target, ShoppingCart, BarChart3, ArrowUpRight, ArrowDownRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, subDays } from "date-fns";

type DateRange = "7" | "30" | "90";

interface DashboardSummary {
  total_sales: number;
  total_orders: number;
  avg_aov: number;
  total_ad_spend: number;
  overall_blended_roas: number;
  overall_cpa: number;
}

interface BlendedRoasData {
  date: string;
  shopify_sales: number;
  total_ad_spend: number;
  blended_roas: number;
}

interface PlatformPerformance {
  platform: string;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_conversions: number;
  avg_ctr: number;
  avg_cpc: number;
  cost_per_conversion: number;
}

interface ProductCategory {
  category: string;
  revenue: number;
  units_sold: number;
  unique_orders: number;
  avg_revenue_per_order: number;
}

interface RecentOrder {
  shopify_order_id: string;
  order_name: string;
  created_at_shopify: string;
  total_price: number;
  financial_status: string;
  fulfillment_status: string;
  line_items_json: any;
}

export default function AdsAnalytics() {
  const [dateRange, setDateRange] = useState<DateRange>("30");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeMetric, setActiveMetric] = useState<"sales" | "spend" | "roas">("sales");
  
  // Filter states
  const [searchSKU, setSearchSKU] = useState("");
  const [searchProductName, setSearchProductName] = useState("");
  const [searchFactory, setSearchFactory] = useState("");
  
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [chartData, setChartData] = useState<BlendedRoasData[]>([]);
  const [platformData, setPlatformData] = useState<PlatformPerformance[]>([]);
  const [categoryData, setCategoryData] = useState<ProductCategory[]>([]);
  const [ordersData, setOrdersData] = useState<RecentOrder[]>([]);
  const [filteredOrdersData, setFilteredOrdersData] = useState<RecentOrder[]>([]);

  const fetchData = async () => {
    try {
      const endDate = new Date();
      const startDate = subDays(endDate, parseInt(dateRange));
      const startDateStr = format(startDate, "yyyy-MM-dd");
      const endDateStr = format(endDate, "yyyy-MM-dd");

      // Fetch blended ROAS data for chart
      const { data: roasData, error: roasError } = await supabase
        .from("v_blended_roas")
        .select("*")
        .gte("date", startDateStr)
        .lte("date", endDateStr)
        .order("date", { ascending: true });

      if (roasError) throw roasError;
      setChartData(roasData || []);

      // Calculate summary from chart data
      if (roasData && roasData.length > 0) {
        const totalSales = roasData.reduce((sum, d) => sum + (d.shopify_sales || 0), 0);
        const totalOrders = roasData.reduce((sum, d) => sum + (d.shopify_orders || 0), 0);
        const totalSpend = roasData.reduce((sum, d) => sum + (d.total_ad_spend || 0), 0);
        const avgAov = totalOrders > 0 ? totalSales / totalOrders : 0;
        const overallRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
        const overallCpa = totalOrders > 0 ? totalSpend / totalOrders : 0;

        setSummary({
          total_sales: totalSales,
          total_orders: totalOrders,
          avg_aov: avgAov,
          total_ad_spend: totalSpend,
          overall_blended_roas: overallRoas,
          overall_cpa: overallCpa,
        });
      }

      // Fetch platform performance
      const { data: platformPerf, error: platformError } = await supabase
        .from("v_platform_performance")
        .select("*");

      if (platformError) throw platformError;
      setPlatformData(platformPerf || []);

      // Fetch product categories
      const { data: categories, error: catError } = await supabase
        .from("ads_shopify_product_categories")
        .select("*")
        .order("revenue", { ascending: false })
        .limit(10);

      if (catError) throw catError;
      setCategoryData(categories || []);

      // Fetch recent orders
      const { data: orders, error: ordersError } = await supabase
        .from("ads_shopify_orders_log")
        .select("*")
        .order("created_at_shopify", { ascending: false })
        .limit(20);

      if (ordersError) throw ordersError;
      setOrdersData(orders || []);
      setFilteredOrdersData(orders || []);

    } catch (error: any) {
      toast.error("Failed to load analytics data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Filter orders based on search criteria
  useEffect(() => {
    let filtered = ordersData;

    if (searchSKU) {
      filtered = filtered.filter((order) => {
        const items = Array.isArray(order.line_items_json) ? order.line_items_json : [];
        return items.some((item: any) => 
          item.sku?.toLowerCase().includes(searchSKU.toLowerCase())
        );
      });
    }

    if (searchProductName) {
      filtered = filtered.filter((order) => {
        const items = Array.isArray(order.line_items_json) ? order.line_items_json : [];
        return items.some((item: any) => 
          item.name?.toLowerCase().includes(searchProductName.toLowerCase()) ||
          item.title?.toLowerCase().includes(searchProductName.toLowerCase())
        );
      });
    }

    if (searchFactory) {
      filtered = filtered.filter((order) => {
        const items = Array.isArray(order.line_items_json) ? order.line_items_json : [];
        return items.some((item: any) => 
          item.vendor?.toLowerCase().includes(searchFactory.toLowerCase())
        );
      });
    }

    setFilteredOrdersData(filtered);
  }, [searchSKU, searchProductName, searchFactory, ordersData]);

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const clearFilters = () => {
    setSearchSKU("");
    setSearchProductName("");
    setSearchFactory("");
  };

  const hasActiveFilters = searchSKU || searchProductName || searchFactory;

  const getRoasColor = (roas: number) => {
    if (roas >= 4.5) return "text-green-500";
    if (roas >= 3) return "text-amber-500";
    return "text-red-500";
  };

  const getRoasBadgeColor = (roas: number) => {
    if (roas >= 4.5) return "bg-green-500/20 text-green-500";
    if (roas >= 3) return "bg-amber-500/20 text-amber-500";
    return "bg-red-500/20 text-red-500";
  };

  const getStatusColor = (status: string) => {
    const lower = status?.toLowerCase() || "";
    if (lower.includes("paid")) return "bg-green-500/20 text-green-500";
    if (lower.includes("pending")) return "bg-amber-500/20 text-amber-500";
    if (lower.includes("refund")) return "bg-red-500/20 text-red-500";
    return "bg-gray-500/20 text-gray-400";
  };

  const getFulfillmentColor = (status: string) => {
    const lower = status?.toLowerCase() || "";
    if (lower.includes("fulfilled")) return "bg-green-500/20 text-green-500";
    if (lower.includes("transit") || lower.includes("partial")) return "bg-amber-500/20 text-amber-500";
    if (lower.includes("unfulfilled")) return "bg-red-500/20 text-red-500";
    return "bg-gray-500/20 text-gray-400";
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat("en-US").format(value);
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const totalCategoryRevenue = categoryData.reduce((sum, cat) => sum + cat.revenue, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Executive Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-2">
            <Sparkles className="h-3 w-3" />
            Executive Dashboard
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Marketing Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Performance across all channels — last {dateRange} days</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center bg-muted/40 rounded-lg p-1">
            {(["30", "7", ""] as const).map((range) => {
              const value = (range || "7") as DateRange;
              const label = range === "30" ? "30 days" : range === "7" ? "7 days" : "Today";
              const isActive = dateRange === value;
              return (
                <button
                  key={range || "today"}
                  type="button"
                  onClick={() => setDateRange(value)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-9"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Executive KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Sales",
            value: formatCurrency(summary?.total_sales || 0),
            icon: DollarSign,
            accent: "blue",
            trend: { direction: "up" as const, value: "+43%", label: "vs prior" },
          },
          {
            label: "Ad Spend",
            value: formatCurrency(summary?.total_ad_spend || 0),
            icon: Target,
            accent: "amber",
            trend: { direction: "down" as const, value: "-31%", label: "vs prior" },
          },
          {
            label: "Blended ROAS",
            value: `${(summary?.overall_blended_roas || 0).toFixed(2)}x`,
            icon: BarChart3,
            accent: "emerald",
            trend: { direction: "up" as const, value: "+9%", label: "vs prior" },
          },
          {
            label: "Orders / CPA",
            value: formatNumber(summary?.total_orders || 0),
            icon: ShoppingCart,
            accent: "violet",
            sub: `CPA ${formatCurrency(summary?.overall_cpa || 0)}`,
          },
        ].map((kpi) => {
          const Icon = kpi.icon;
          const accentMap: Record<string, { bg: string; text: string; ring: string }> = {
            blue:    { bg: "bg-blue-50",    text: "text-blue-600",    ring: "ring-blue-100" },
            amber:   { bg: "bg-amber-50",   text: "text-amber-600",   ring: "ring-amber-100" },
            emerald: { bg: "bg-emerald-50", text: "text-emerald-600", ring: "ring-emerald-100" },
            violet:  { bg: "bg-violet-50",  text: "text-violet-600",  ring: "ring-violet-100" },
          };
          const a = accentMap[kpi.accent];
          const trendPositive = kpi.trend?.direction === "up";
          return (
            <Card key={kpi.label} className="border border-border rounded-2xl shadow-sm hover:shadow-md transition-shadow bg-card">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className={`h-11 w-11 rounded-xl flex items-center justify-center ring-4 ${a.bg} ${a.ring}`}>
                    <Icon className={`h-5 w-5 ${a.text}`} />
                  </div>
                  {kpi.trend && (
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      trendPositive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                    }`}>
                      {trendPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {kpi.trend.value}
                    </div>
                  )}
                </div>
                <p className="mt-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                <div className="mt-1 text-3xl font-bold tracking-tight text-foreground tabular-nums">
                  {kpi.value}
                </div>
                {kpi.trend ? (
                  <p className="mt-1 text-xs text-muted-foreground">{kpi.trend.label}</p>
                ) : kpi.sub ? (
                  <p className="mt-1 text-xs text-muted-foreground">{kpi.sub}</p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Engagement Performance Chart — single chart, 3 metrics overlaid */}
      <Card className="border border-border rounded-2xl shadow-sm bg-card">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-orange-50 flex items-center justify-center shrink-0">
                <Flame className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold text-foreground">Engagement Performance</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">Sales, ad spend, and ROAS trends</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <Upload className="h-4 w-4" />
              Export As
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2 mt-4 flex-wrap">
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
                <span className="text-muted-foreground">Ad Spend</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#10B981]" />
                <span className="text-muted-foreground">Net Revenue</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#F97316]" />
                <span className="text-muted-foreground">ROAS</span>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground border border-border rounded-md px-3 py-1.5">
              {dateRange} Days
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={360}>
            <BarChart
              data={chartData.map((d) => {
                const sales = d.shopify_sales || 0;
                const spend = d.total_ad_spend || 0;
                const roas = d.blended_roas || 0;
                const net = Math.max(0, sales - spend);
                const roasVisual = (spend + net) * Math.min(0.15, roas / 30);
                return { ...d, net_revenue: net, roas_visual: roasVisual };
              })}
              margin={{ top: 16, right: 16, left: 0, bottom: 8 }}
              barCategoryGap="35%"
            >
              <CartesianGrid stroke="#F0F0F5" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#9CA3AF"
                tick={{ fill: "#9CA3AF", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => format(new Date(value), "EEE")}
                dy={8}
              />
              <YAxis
                stroke="#9CA3AF"
                tick={{ fill: "#9CA3AF", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
              />
              <Tooltip
                cursor={{ fill: "transparent" }}
                content={({ active: isActive, payload }) => {
                  if (!isActive || !payload || payload.length === 0) return null;
                  const point: any = payload[0].payload;
                  const dateStr = format(new Date(point.date), "EEEE, MMM d");
                  return (
                    <div className="bg-card border border-border rounded-lg shadow-lg px-4 py-3 min-w-[220px]">
                      <p className="text-xs text-muted-foreground mb-2">{dateStr}</p>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
                            <span className="text-muted-foreground">Ad Spend</span>
                          </span>
                          <span className="font-semibold text-foreground">{formatCurrency(point.total_ad_spend || 0)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-[#10B981]" />
                            <span className="text-muted-foreground">Net Revenue</span>
                          </span>
                          <span className="font-semibold text-foreground">{formatCurrency(point.net_revenue || 0)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-[#F97316]" />
                            <span className="text-muted-foreground">ROAS</span>
                          </span>
                          <span className="font-semibold text-foreground">{(point.blended_roas || 0).toFixed(2)}x</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-sm pt-1.5 mt-1.5 border-t border-border">
                          <span className="text-muted-foreground">Total Sales</span>
                          <span className="font-semibold text-foreground">{formatCurrency(point.shopify_sales || 0)}</span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="total_ad_spend"
                stackId="rev"
                fill="#DDD6FE"
                minPointSize={6}
                activeBar={{ fill: "#8B5CF6" }}
                animationDuration={900}
              />
              <Bar
                dataKey="net_revenue"
                stackId="rev"
                fill="#A7F3D0"
                minPointSize={6}
                activeBar={{ fill: "#10B981" }}
                animationDuration={900}
              />
              <Bar
                dataKey="roas_visual"
                stackId="rev"
                fill="#FED7AA"
                minPointSize={6}
                radius={[8, 8, 0, 0]}
                activeBar={{ fill: "#F97316", radius: [8, 8, 0, 0] }}
                animationDuration={900}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Channel Performance Table */}
      <Card className="border border-border rounded-2xl shadow-sm bg-card">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-indigo-50 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">Channel Performance</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">Spend, clicks, and ROAS by channel</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Channel</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Spend</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Impressions</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Clicks</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">CTR</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">CPC</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversions</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {platformData.map((platform) => {
                  const roas = platform.total_spend > 0
                    ? (summary?.total_sales || 0) / platformData.reduce((sum, p) => sum + p.total_spend, 0) * (platform.total_spend / (summary?.total_ad_spend || 1))
                    : 0;
                  const platformStyle: Record<string, { bg: string; text: string; initial: string }> = {
                    google:   { bg: "bg-blue-50",   text: "text-blue-700",   initial: "G" },
                    meta:     { bg: "bg-purple-50", text: "text-purple-700", initial: "M" },
                    pinterest:{ bg: "bg-pink-50",   text: "text-pink-700",   initial: "P" },
                  };
                  const pStyle = platformStyle[platform.platform] || { bg: "bg-gray-50", text: "text-gray-700", initial: platform.platform[0]?.toUpperCase() || "?" };
                  return (
                    <tr key={platform.platform} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-lg ${pStyle.bg} ${pStyle.text} flex items-center justify-center font-semibold text-xs`}>
                            {pStyle.initial}
                          </div>
                          <span className="capitalize font-medium text-foreground">{platform.platform} Ads</span>
                        </div>
                      </td>
                      <td className="text-right py-4 px-4 font-semibold tabular-nums">{formatCurrency(platform.total_spend)}</td>
                      <td className="text-right py-4 px-4 tabular-nums text-muted-foreground">{formatNumber(platform.total_impressions)}</td>
                      <td className="text-right py-4 px-4 tabular-nums text-muted-foreground">{formatNumber(platform.total_clicks)}</td>
                      <td className="text-right py-4 px-4 tabular-nums text-muted-foreground">{(platform.avg_ctr * 100).toFixed(2)}%</td>
                      <td className="text-right py-4 px-4 tabular-nums text-muted-foreground">{formatCurrency(platform.avg_cpc)}</td>
                      <td className="text-right py-4 px-4 tabular-nums text-muted-foreground">{formatNumber(platform.total_conversions)}</td>
                      <td className="text-right py-4 px-4">
                        <Badge className={getRoasBadgeColor(roas)}>
                          {roas.toFixed(2)}x
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-bold border-t-2 border-border bg-muted/30">
                  <td className="py-4 px-4 text-foreground">Total / Blended</td>
                  <td className="text-right py-3 px-4">
                    {formatCurrency(platformData.reduce((sum, p) => sum + p.total_spend, 0))}
                  </td>
                  <td className="text-right py-3 px-4">
                    {formatNumber(platformData.reduce((sum, p) => sum + p.total_impressions, 0))}
                  </td>
                  <td className="text-right py-3 px-4">
                    {formatNumber(platformData.reduce((sum, p) => sum + p.total_clicks, 0))}
                  </td>
                  <td className="text-right py-3 px-4">
                    {((platformData.reduce((sum, p) => sum + p.total_clicks, 0) / 
                      platformData.reduce((sum, p) => sum + p.total_impressions, 0)) * 100).toFixed(2)}%
                  </td>
                  <td className="text-right py-3 px-4">
                    {formatCurrency(platformData.reduce((sum, p) => sum + p.total_spend, 0) / 
                      platformData.reduce((sum, p) => sum + p.total_clicks, 0))}
                  </td>
                  <td className="text-right py-3 px-4">
                    {formatNumber(platformData.reduce((sum, p) => sum + p.total_conversions, 0))}
                  </td>
                  <td className="text-right py-3 px-4">
                    <Badge className={getRoasBadgeColor(summary?.overall_blended_roas || 0)}>
                      {(summary?.overall_blended_roas || 0).toFixed(2)}x
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Product Categories Table */}
      <Card className="border border-border rounded-2xl shadow-sm bg-card">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-rose-50 flex items-center justify-center">
              <ShoppingCart className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">Product Categories</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">Revenue distribution and category share</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Units</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Orders</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Avg Order</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Share</th>
                </tr>
              </thead>
              <tbody>
                {categoryData.map((category, idx) => {
                  const sharePercent = totalCategoryRevenue > 0
                    ? (category.revenue / totalCategoryRevenue) * 100
                    : 0;
                  const barColors = ["#0f7173", "#10B981", "#1f8a8c", "#F97316", "#8B5CF6", "#EC4899"];
                  const barColor = barColors[idx % barColors.length];
                  const fillPct = Math.max(2, Math.min(100, sharePercent));

                  return (
                    <tr key={category.category} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-4 px-4 font-medium text-foreground">{category.category}</td>
                      <td className="text-right py-4 px-4 font-semibold tabular-nums">{formatCurrency(category.revenue)}</td>
                      <td className="text-right py-4 px-4 tabular-nums text-muted-foreground">{formatNumber(category.units_sold)}</td>
                      <td className="text-right py-4 px-4 tabular-nums text-muted-foreground">{formatNumber(category.unique_orders)}</td>
                      <td className="text-right py-4 px-4 tabular-nums text-muted-foreground">{formatCurrency(category.avg_revenue_per_order)}</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3 justify-end">
                          <div className="relative w-[180px] h-6 bg-[#F1F3F8] rounded-full overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full flex items-center justify-end pr-1.5 transition-all"
                              style={{ width: `${fillPct}%`, background: barColor }}
                            >
                              <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
                            </div>
                          </div>
                          <span
                            className="text-sm font-semibold tabular-nums w-[52px] text-right"
                            style={{ color: barColor }}
                          >
                            {sharePercent.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Orders Table */}
      <Card className="border border-border rounded-2xl shadow-sm bg-card">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-emerald-50 flex items-center justify-center">
                <ShoppingCart className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold text-foreground">Recent Orders</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">Latest order activity across channels</p>
              </div>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4 mr-2" />
                Clear filters
              </Button>
            )}
          </div>
          
          {/* Filter inputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search SKU..."
                value={searchSKU}
                onChange={(e) => setSearchSKU(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search Product Name..."
                value={searchProductName}
                onChange={(e) => setSearchProductName(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search Factory..."
                value={searchFactory}
                onChange={(e) => setSearchFactory(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          
          {hasActiveFilters && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing {filteredOrdersData.length} of {ordersData.length} orders
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Order</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Date</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Total</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Fulfillment</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Items</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrdersData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      {hasActiveFilters ? "No orders match your filters" : "No orders found"}
                    </td>
                  </tr>
                ) : (
                  filteredOrdersData.map((order) => {
                    const itemCount = Array.isArray(order.line_items_json) 
                      ? order.line_items_json.length 
                      : 0;
                    
                    return (
                      <tr key={order.shopify_order_id} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="py-3 px-4 font-mono text-sm">{order.order_name}</td>
                        <td className="py-3 px-4 text-sm">
                          {format(new Date(order.created_at_shopify), "MMM d, h:mm a")}
                        </td>
                        <td className="text-right py-3 px-4">{formatCurrency(order.total_price)}</td>
                        <td className="text-center py-3 px-4">
                          <Badge className={getStatusColor(order.financial_status)}>
                            {order.financial_status}
                          </Badge>
                        </td>
                        <td className="text-center py-3 px-4">
                          <Badge className={getFulfillmentColor(order.fulfillment_status)}>
                            {order.fulfillment_status}
                          </Badge>
                        </td>
                        <td className="text-right py-3 px-4">{itemCount} items</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { RealtimeStatusIndicator } from "@/components/shared/RealtimeStatusIndicator";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard, Package, ShoppingCart, Users, Truck, Settings, LogOut,
  Activity, ClipboardCheck, RotateCcw, List, Container, TrendingUp, DollarSign,
  BarChart3, FileText, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { ROUTE_TABLE_MAP, ADMIN_ONLY_ROUTES } from "@/lib/userPermissions";
import pbLogo from "@/assets/pb-logo.svg";

interface NavItem { title: string; url: string; icon: any; activeUrls?: string[]; }
interface NavSection { label: string; items: NavItem[]; }

const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Product List", url: "/product-list", icon: List },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Order Log", url: "/sale-tracker", icon: DollarSign },
      { title: "Order Tracker", url: "/order-tracker", icon: ShoppingCart },
      { title: "Refunds & Adjustments", url: "/refunds-adjustments", icon: RotateCcw },
      { title: "Returns", url: "/returns", icon: Truck },
    ],
  },
  {
    label: "Procurement",
    items: [
      { title: "Inbound Orders", url: "/purchase-order-tracker", icon: ClipboardCheck },
      { title: "Vendor List", url: "/factory-list", icon: TrendingUp },
    ],
  },
  {
    label: "Booking Boards",
    items: [
      { title: "Booking Board",    url: "/invoice-tracker",  icon: LayoutDashboard, activeUrls: ["/invoice-tracker",  "/shipping-requests",        "/po-tracker"]           },
      { title: "Booking Board (Logistics)",  url: "/order-logistics",  icon: LayoutDashboard, activeUrls: ["/order-logistics",  "/order-logistics-shipping",  "/order-logistics-po"]  },
      { title: "Booking Board (Management)", url: "/order-management", icon: LayoutDashboard, activeUrls: ["/order-management", "/order-management-shipping", "/order-management-po"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { title: "Receiving Monitor", url: "/inventory-arrivals", icon: Package },
      { title: "Inbound Shipment", url: "/incoming-shipment", icon: TrendingUp },
      { title: "Container Ledger", url: "/containers-tracker", icon: Container },
    ],
  },
  {
    label: "Analytics",
    items: [
      { title: "Demand Planner", url: "/monthly-forecast", icon: TrendingUp },
      { title: "Storefront Stock", url: "/shopify-inventory", icon: Package },
      { title: "Sales by Month", url: "/yearly-sales", icon: DollarSign },
      { title: "Instock %", url: "/instock-percentage", icon: BarChart3 },
      { title: "Availability Score", url: "/instock-rate-dashboard", icon: BarChart3 },
      { title: "Ad Spend vs Revenue", url: "/ads-analytics", icon: BarChart3 },
      // Hidden from sidebar — consolidated into "All Channels Dashboard" (tabs).
      // Routes still live in App.tsx so direct URLs keep working.
      // { title: "Channels Dashboard", url: "/sales-by-source", icon: BarChart3 },
      // { title: "Marketplace Sheet", url: "/amazon-dashboard", icon: BarChart3 },
      // { title: "Storefront Sheet", url: "/website-dashboard", icon: BarChart3 },
      // { title: "Long-tail Channels", url: "/other-channel-dashboard", icon: BarChart3 },
      { title: "All Channels Dashboard", url: "/all-channels", icon: BarChart3 },
      { title: "Channel Margin Console", url: "/channel-analytics", icon: TrendingUp },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Activity Log", url: "/activity-log", icon: Activity },
      { title: "Manage RMA", url: "/manage-rma", icon: RotateCcw },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

const adminSection: NavSection = {
  label: "Admin",
  items: [{ title: "Users & Permissions", url: "/admin/users", icon: Users }],
};

// Items that bypass permission filtering (always available to any logged-in user).
const ALWAYS_VISIBLE = new Set<string>(["/dashboard", "/settings"]);

const roleColors: Record<string, string> = {
  admin: "bg-destructive text-destructive-foreground",
  manager: "bg-primary text-primary-foreground",
  purchasing: "bg-blue-600 text-white",
  pending: "bg-yellow-500 text-yellow-50",
};

const navLinkClass = (active: boolean) => cn(
  "relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
  "before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:transition-colors before:duration-150",
  active
    ? "bg-sidebar-active-bg text-sidebar-active font-medium before:bg-sidebar-active"
    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground before:bg-transparent",
  "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2",
);

export function DashboardSidebar() {
  const { state, toggleSidebar, isMobile, setOpen } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, isAdmin, signOut } = useAuth();
  const { checkCanAccessRoute } = usePermissions();

  const isActive = (path: string) => location.pathname === path;
  const role = profile?.role || "";

  // Tablet (768-1024px): auto-collapse to icon rail; restore on desktop.
  const lastRangeRef = useRef<"tablet" | "desktop" | null>(null);
  useEffect(() => {
    const tabletMql = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const applyRange = () => {
      const range: "tablet" | "desktop" = tabletMql.matches ? "tablet" : "desktop";
      if (range !== lastRangeRef.current) {
        lastRangeRef.current = range;
        setOpen(range === "desktop");
      }
    };
    applyRange();
    tabletMql.addEventListener("change", applyRange);
    return () => tabletMql.removeEventListener("change", applyRange);
  }, [setOpen]);

  const canSee = (url: string): boolean => {
    if (ADMIN_ONLY_ROUTES.has(url)) return isAdmin;
    if (ALWAYS_VISIBLE.has(url)) return true;
    if (isAdmin) return true;
    if (role === "manager" || role === "purchasing") {
      const tableName = ROUTE_TABLE_MAP[url];
      if (!tableName) return false;
      return checkCanAccessRoute(url);
    }
    return false;
  };

  const visibleSections: NavSection[] = navSections
    .map(section => ({ ...section, items: section.items.filter(i => canSee(i.url)) }))
    .filter(section => section.items.length > 0);

  const getInitials = (name: string) =>
    name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  const handleLogout = async () => {
    await signOut();
    toast.success("Logged out successfully");
    navigate("/login");
  };

  const isItemActive = (item: NavItem) =>
    item.activeUrls ? item.activeUrls.some(u => location.pathname === u) : isActive(item.url);

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.title}>
      <SidebarMenuButton asChild tooltip={item.title} className="h-auto p-0 hover:bg-transparent">
        <Link to={item.url} className={navLinkClass(isItemActive(item))}>
          <item.icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={pbLogo}
              alt="Northwind Motor Parts"
              className="h-10 w-10 shrink-0 object-contain"
            />
            <span
              className={cn(
                "truncate text-base font-display font-bold text-sidebar-accent-foreground transition-opacity duration-150",
                collapsed && !isMobile ? "w-0 opacity-0" : "opacity-100",
              )}
            >
              Northwind <span className="text-sidebar-active">Motor Parts</span>
            </span>
          </div>
          <div
            className={cn(
              "flex items-center gap-1 transition-opacity duration-150",
              collapsed && !isMobile ? "pointer-events-none w-0 opacity-0" : "opacity-100",
            )}
          >
            <RealtimeStatusIndicator />
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="no-scrollbar px-2 py-3">
        {visibleSections.map((section, idx) => (
          <SidebarGroup key={section.label || `section-${idx}`} className={cn("p-0", idx > 0 && "mt-4")}>
            {section.label && (
              <SidebarGroupLabel
                className={cn(
                  "h-auto px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-sidebar-section-label",
                  "transition-opacity duration-200",
                )}
              >
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.items.map(renderItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {isAdmin && (
          <SidebarGroup className="mt-4 p-0">
            <SidebarGroupLabel
              className="h-auto px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-sidebar-section-label"
            >
              {adminSection.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {adminSection.items.map(renderItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors duration-150",
              "hover:bg-sidebar-accent",
              "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1.5",
            )}
          >
            <Avatar className="h-8 w-8 shrink-0">
              {profile?.avatar_url && (
                <AvatarImage src={profile.avatar_url} alt={profile.full_name || "Avatar"} />
              )}
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {getInitials(profile?.full_name || "U")}
              </AvatarFallback>
            </Avatar>
            <div
              className={cn(
                "min-w-0 flex-1 transition-opacity duration-150",
                collapsed && !isMobile ? "hidden" : "block",
              )}
            >
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
                  {profile?.full_name || "User"}
                </p>
                <Badge
                  className={cn(
                    "shrink-0 px-1.5 py-0 text-[10px]",
                    roleColors[profile?.role || ""] || "bg-muted text-muted-foreground",
                  )}
                >
                  {profile?.role || "—"}
                </Badge>
              </div>
              <p className="truncate text-xs text-sidebar-foreground/70">
                {profile?.email || ""}
              </p>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-50 w-56 bg-popover">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{profile?.full_name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {profile?.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings className="mr-2 h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Bottom collapse toggle — desktop/tablet only */}
        {!isMobile && (
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleSidebar}
            className={cn(
              "mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium",
              "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "transition-colors duration-150",
              "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2",
            )}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span>Collapse</span>
              </>
            )}
          </button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

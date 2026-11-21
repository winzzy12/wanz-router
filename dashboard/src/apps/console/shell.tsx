import {
  Bell,
  Clock,
  ChevronDown,
  Cpu,
  Globe,
  LogOut,
  MemoryStick,
  Menu,
  Monitor,
  Moon,
  Server,
  Sun,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import { HeaderExtras } from "../../components/HeaderExtras";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { applyConsoleTheme, isDarkEffective, readConsoleTheme, writeConsoleTheme } from "../../lib/theme";
import { BackgroundLayer } from "../../features/customization/BackgroundLayer";
import { applyCustomization, readCustomizationSettings } from "../../features/customization/settings";
import { consoleRequest } from "../../data/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { clearPersistedCache, queryClient } from "../../data/query-client";
import { prefetchRouteIntent } from "../../data/route-prefetch";
import { POLL } from "../../data/query-policy";
import { useSystemHealth, useNotifications, type NotificationItem } from "../../hooks/system";
import { useProviders } from "../../hooks/providers";
import { DASHBOARD_RELEASE_LABEL } from "../../lib/version";
import { formatUptime } from "../../lib/format/numbers";
import { WANZ_ROUTER_REPO_URL } from "../../lib/links";
import type { SessionUser } from "../../data/contracts";
import { navigationGroups, resolveRouteMeta, type NavGroupDef, type NavItemDef } from "./route-manifest";

function ThemeToggle() {
  const [theme, setTheme] = useState(() => readConsoleTheme());
  const dark = isDarkEffective(theme);

  // Stay in sync with theme changes from another tab.
  useEffect(() => {
    const resync = () => setTheme(readConsoleTheme());
    window.addEventListener("storage", resync);
    return () => window.removeEventListener("storage", resync);
  }, []);

  useEffect(() => {
    applyConsoleTheme(theme);
  }, [theme]);

  return (
    <button
      type="button"
      onClick={() => {
        const next = dark ? "light" : "dark";
        setTheme(next);
        writeConsoleTheme(next);
      }}
      aria-label="Toggle theme"
      aria-pressed={dark}
      className="topbar-icon-button"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span key={dark ? "sun" : "moon"} className="grid place-items-center">
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </span>
    </button>
  );
}

const LOCAL_CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const UTC_CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

function formatProcessRss(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  const unit = bytes >= 1024 ** 3
    ? { divisor: 1024 ** 3, label: "GiB" }
    : { divisor: 1024 ** 2, label: "MiB" };
  return `${(bytes / unit.divisor).toFixed(1)} ${unit.label}`;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  title,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0 rounded-control border border-inner-border bg-surface-2 p-3" title={title}>
      <dt className="flex items-center gap-2 text-micro font-medium text-text-tertiary">
        <Icon size={13} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </dt>
      <dd className="mt-1 truncate font-mono text-caption font-semibold tabular-nums text-text-primary">
        {value}
      </dd>
      {detail ? <dd className="mt-1 text-micro text-text-secondary">{detail}</dd> : null}
    </div>
  );
}

function NotificationsPopover({
  notifications,
}: {
  /** Live server-generated alerts; owned by the shell so it can key the badge. */
  readonly notifications: readonly NotificationItem[];
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Health is loaded lazily, keyed to the popover: the first open fetches it
  // (the shell's version read usually already warmed the cache), every open
  // reuses that cached payload, and the refresh timer runs only while the
  // popover is open — closing it stops the polling, never the other way.
  const { data: health } = useSystemHealth({
    enabled: open,
    refetchInterval: open ? POLL.status : false,
  });

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        contentRef.current &&
        !contentRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // One line per real dependency, not per mood: which backing services exist
  // comes straight from the health payload. Lite mode has no external Postgres
  // or Redis at all, so a healthy lite instance must not claim they connect.
  const databaseLine = !health
    ? undefined
    : health.database_in_process
      ? health.database_healthy
        ? "SQLite in-process, connected."
        : "SQLite in-process is not answering."
      : health.database_healthy
        ? "Postgres connected."
        : "Postgres unreachable.";
  const redisLine = !health
    ? undefined
    : !health.redis_configured
      ? "Redis not configured."
      : health.redis_healthy
        ? "Redis connected."
        : "Redis unreachable.";
  const dependenciesLine = [databaseLine, redisLine].filter(Boolean).join(" · ");
  const healthTitle = !health
    ? "System health unavailable"
    : health.status === "healthy"
      ? "All systems operational"
      : health.status === "degraded"
        ? "Gateway degraded"
        : "Gateway unhealthy";
  const healthDescription = !health
    ? "Live gateway metrics are not available."
    : health.status === "healthy"
      ? dependenciesLine || "Gateway reported healthy."
      : [dependenciesLine, "Check connection logs."].filter(Boolean).join(" — ");
  const memoryDetail = health
    ? [
        Number.isFinite(health.memory_percent)
          ? `${health.memory_percent.toFixed(1)}% of system RAM`
          : undefined,
        health.database_in_process ? "In-process DB included" : undefined,
      ].filter(Boolean).join(" · ") || undefined
    : undefined;
  // Load average has no equivalent on Windows, so an unavailable reading is
  // the honest result there rather than a measured 0%.
  // Narrowed once: `cpu_percent` is `number | null`, and every consumer needs
  // the same check. `Number.isFinite` proves it is a number at runtime but does
  // not narrow the type, so this is the one `!== null` that does.
  const cpuPercent = health?.cpu_percent ?? undefined;
  const cpuMeasured = cpuPercent !== undefined && Number.isFinite(cpuPercent);
  const cpuDetail = health
    ? cpuMeasured
      ? Number.isFinite(health.cpu_cores) && health.cpu_cores > 0
        ? `1-min load · ${health.cpu_cores} cores`
        : "Normalized 1-min load"
      : "Not reported on this platform"
    : undefined;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="topbar-icon-button"
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={17} />
        {notifications.length > 0 ? (
          <span
            aria-label={`${notifications.length} notifications`}
            className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent"
          />
        ) : null}
      </button>
      {open
        ? createPortal(
            <>
              <div
                aria-hidden="true"
                className="fixed inset-0 z-floating bg-overlay backdrop-blur-dialog"
                onClick={() => setOpen(false)}
              />
              <div
                ref={contentRef}
                role="dialog"
                aria-label="Notifications"
                className="app-topbar-popover popout-enter glass rounded-sidebar border border-inner-border bg-popover-bg p-5 shadow-popout z-popover"
              >
              <div
                className="mb-3 flex shrink-0 items-center justify-between"
              >
                <div
                  className="flex items-center gap-3 font-bold text-body-lg"
                >
                  <span
                    className="w-13 h-13 rounded-pill bg-accent-soft text-accent grid place-items-center"
                  >
                    <Bell size={13} />
                  </span>
                  <span>Notifications</span>
                </div>
                <button
                  type="button"
                  aria-label="Close notifications"
                  onClick={() => setOpen(false)}
                  className="cursor-pointer border-none bg-transparent p-2 text-caption text-text-tertiary"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="scroll-region min-h-0 flex-1 flex flex-col gap-3">
                {notifications.length > 0 ? (
                  <section aria-label="Notifications" className="flex flex-col gap-2">
                    {notifications.map((notification) => (
                      <article
                        key={notification.id}
                        className={`flex items-start gap-3 rounded-card border p-4 ${
                          notification.level === "warning"
                            ? "border-orange-soft bg-orange-soft"
                            : "border-accent/25 bg-accent-soft"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-caption font-semibold text-text-primary">
                            {notification.title}
                          </span>
                          <span className="mt-1 block text-badge text-text-secondary">
                            {notification.message}
                          </span>
                        </span>
                        {notification.href ? (
                          <a
                            className="shrink-0 text-badge font-semibold text-accent"
                            href={notification.href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                        ) : null}
                      </article>
                    ))}
                  </section>
                ) : (
                  <div className="rounded-card border border-inner-border bg-surface-2 p-4 text-badge text-text-secondary">
                    No active memory or update alerts.
                  </div>
                )}
                <div className="flex items-start gap-3 rounded-card border border-inner-border bg-surface-2 p-4">
                  <span className="mt-0.5 grid w-12 h-12 shrink-0 place-items-center rounded-control bg-surface-1 text-text-secondary">
                    <Server size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-caption">{healthTitle}</p>
                    <p className="text-badge text-text-secondary mt-1">{healthDescription}</p>
                  </div>
                </div>
                <dl aria-label="Runtime metrics" className="grid grid-cols-2 gap-2">
                  <MetricTile icon={Clock} label="Local time" value={LOCAL_CLOCK_FORMATTER.format(now)} />
                  <MetricTile icon={Globe} label="UTC" value={UTC_CLOCK_FORMATTER.format(now)} />
                  <MetricTile
                    icon={Timer}
                    label="Uptime"
                    value={health ? formatUptime(health.uptime_seconds) : "Unavailable"}
                    detail={health && Number.isFinite(health.uptime_seconds) && health.uptime_seconds >= 0
                      ? "Gateway process running"
                      : undefined}
                  />
                  <MetricTile
                    icon={MemoryStick}
                    label="Process RSS"
                    value={health ? formatProcessRss(health.memory_bytes) : "Unavailable"}
                    detail={memoryDetail}
                    title="Process resident set size; percentage is share of system RAM."
                  />
                  <MetricTile
                    icon={Cpu}
                    label="CPU load"
                    value={cpuMeasured && cpuPercent !== undefined
                      ? `${cpuPercent.toFixed(1)}%`
                      : "Unavailable"}
                    detail={cpuDetail}
                    title="One-minute load average normalized by the number of CPU cores."
                  />
                  <MetricTile
                    icon={Monitor}
                    label="Runtime"
                    value={health?.platform?.trim() || "Unavailable"}
                    detail={health?.platform?.trim() ? "Gateway host platform" : undefined}
                    title={health?.platform?.trim() || "Runtime platform unavailable"}
                  />
                </dl>
              </div>
            </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}


function SidebarNavGroup({
  group,
  pathname,
  onIntent,
}: {
  readonly group: NavGroupDef;
  readonly pathname: string;
  readonly onIntent: (path: string) => void;
}): ReactNode {
  return (
    <div className="nav-group-section">
      <p className="nav-group-title">{group.label}</p>
      <SidebarNavList items={group.items} pathname={pathname} onIntent={onIntent} />
    </div>
  );
}

function SidebarNavList({
  items,
  pathname,
  onIntent,
}: {
  readonly items: readonly NavItemDef[];
  readonly pathname: string;
  readonly onIntent: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0, opacity: 0 });
  const [expandedItems, setExpandedItems] = useState<ReadonlySet<string>>(() => new Set());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector('[data-active="true"]') as HTMLElement | null;
    if (!active) {
      setIndicator((s) => ({ ...s, opacity: 0 }));
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    setIndicator({
      top: activeRect.top - containerRect.top,
      height: activeRect.height,
      opacity: 1,
    });
  }, [pathname, items]);

  return (
    <div ref={containerRef} className="nav-items-container">
      <div
        className="sidebar-active-indicator"
        style={{
          transform: `translateY(${indicator.top}px)`,
          height: `${indicator.height}px`,
          opacity: indicator.opacity,
        }}
        aria-hidden="true"
      />
      {items.map((item) => {
        if (item.children !== undefined) {
          const expanded = expandedItems.has(item.path ?? item.label);
          return (
            <div key={item.path ?? item.label}>
              <button
                type="button"
                className="nav-link-item w-full"
                aria-expanded={expanded}
                onClick={() =>
                  setExpandedItems((current) => {
                    const next = new Set(current);
                    const key = item.path ?? item.label;
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                <item.icon size={17} className="nav-link-icon" />
                <span>{item.label}</span>
                <ChevronDown
                  size={14}
                  className={`ml-auto shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {expanded ? (
                <div className="ml-6 border-l border-inner-border pl-2">
                  {item.children.map((child) => (
                    <button
                      key={child.path ?? child.label}
                      type="button"
                      className="nav-link-item w-full"
                      disabled={child.disabled === true}
                      title={child.label}
                    >
                      <child.icon size={15} className="nav-link-icon" />
                      <span>{child.label}</span>
                      {child.badge ? <span className="nav-link-badge">{child.badge}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }
        if (item.disabled) {
          return (
            <button
              key={item.path ?? item.label}
              type="button"
              className="nav-link-item w-full cursor-not-allowed opacity-55"
              disabled
              aria-label={`${item.label} — unavailable`}
              title="Coming soon"
            >
              <item.icon size={17} className="nav-link-icon" />
              <span>{item.label}</span>
              <span className="nav-link-badge">Soon</span>
            </button>
          );
        }
        if (item.path === undefined) return null;
        const path = item.path;
        const isActive =
          path === "/"
            ? pathname === "/"
            : pathname === path || pathname.startsWith(`${path}/`);
        return (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            data-active={isActive ? "true" : undefined}
            className={`nav-link-item ${isActive ? "active" : ""}`}
            onMouseEnter={() => onIntent(path)}
            onFocus={() => onIntent(path)}
          >
            <item.icon size={17} className="nav-link-icon" />
            <span>{item.label}</span>
            {item.badge ? <span className="nav-link-badge">{item.badge}</span> : null}
          </NavLink>
        );
      })}
    </div>
  );
}

export function DashboardShell({
  user,
  children,
}: {
  readonly user: SessionUser;
  readonly children: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const notifications = useNotifications();
  const providerDetailActive = /^\/providers\/[^/]+\/?$/.test(location.pathname);
  const providersQuery = useProviders(providerDetailActive);

  const prefetchIntent = (path: string): void => {
    void prefetchRouteIntent(queryClient, path);
  };

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // A modal overlay (Request Detail drawer, Dialog) sits above the mobile
  // nav rail. Close the rail so its dim overlay never traps touch scroll.
  useEffect(() => {
    const close = () => setDrawerOpen(false);
    window.addEventListener("cartethyia:overlay-open", close);
    return () => window.removeEventListener("cartethyia:overlay-open", close);
  }, []);
  // The shell stays mounted across navigations, so the document keeps the
  // previous page's offset and the next page opens already scrolled. Layout
  // timing, not `useEffect`: a post-paint reset shows the stale offset for one
  // frame.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const logout = async () => {
    setLoggingOut(true);
    try {
      await consoleRequest<void>("/auth/logout", { method: "POST" });
    } finally {
      // Drop every cached tenant view before leaving so the next login
      // never renders the previous tenant's data — from memory and from the
      // persisted snapshot, which `clear()` does not touch.
      queryClient.clear();
      clearPersistedCache();
      navigate("/login", { replace: true });
    }
  };

  useEffect(() => {
    document.documentElement.dataset.glassEnabled = "true";
    applyCustomization(readCustomizationSettings());
    return () => {
      delete document.documentElement.dataset.glassEnabled;
    };
  }, []);

  const meta = resolveRouteMeta(location.pathname, providersQuery.data ?? []);
  const defaultLogoUrl = `${import.meta.env.BASE_URL}assets/brand/sidebar_ico-v2.webp`;
  const logoUrl = defaultLogoUrl;
  return (
    <>
      <div className="app-bg" aria-hidden="true" />
      <BackgroundLayer />
      <div className="app-shell-frame">
      <div
        className="app-shell-root"
        data-drawer={drawerOpen ? "open" : undefined}
        data-page-scroll={location.pathname === "/console-log" ? "contained" : undefined}
        onClick={(event) => { if (drawerOpen && (event.target as HTMLElement).closest(".app-main-column")) setDrawerOpen(false); }}
      >

        <aside
          className={`glass app-sidebar ${drawerOpen ? "is-open" : ""}`}
          aria-label="Dashboard navigation"
        >
          <div className="brand-header">
            <div aria-hidden="true" className="brand-icon overflow-hidden p-0">
              <img
                src={logoUrl}
                alt="Wanz Router"
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = defaultLogoUrl;
                }}
                className="w-full h-full object-cover block"
              />
            </div>
            <div className="brand-meta">
              <div className="brand-name">
                <span>Wanz Router</span>
              </div>
              <div className="brand-version-badge">
                <a
                  href={WANZ_ROUTER_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="brand-version-link"
                >
                  {DASHBOARD_RELEASE_LABEL}
                </a>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-2 px-0">
            {navigationGroups.map((group) => (
              <SidebarNavGroup
                key={group.label}
                group={group}
                pathname={location.pathname}
                onIntent={prefetchIntent}
              />
            ))}
          </nav>

          {/* User Card */}
          <div className="sidebar-user-card">
            <div className="user-card-content">
              <div className="user-avatar" aria-hidden="true">
                {(user.displayName ?? user.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="user-info">
                <p className="user-name">{user.displayName || "Admin"}</p>
                <p className="user-role">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setLogoutOpen(true)}
                disabled={loggingOut}
                aria-label="Sign out"
                title="Sign out"
                className="topbar-icon-button w-15 h-15 rounded-inset"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Column */}
        <div className="app-main-column">
          {/* Topbar Header */}
          <header className="glass app-topbar">
            <button
              type="button"
              aria-label="Open navigation"
              className="topbar-menu-btn"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={18} />
            </button>
            <div className="topbar-meta">
              <h1 className="topbar-title">
                <meta.icon className="topbar-title-icon" size={16} aria-hidden="true" />
                {meta.title}
              </h1>
              <p className="topbar-subtitle">{meta.sub}</p>
            </div>

            <div className="topbar-actions">
              <HeaderExtras />
              <ThemeToggle />
              <NotificationsPopover notifications={notifications} />
            </div>
          </header>

          {/* Content Outlet */}
          <main className="route-enter w-full min-w-0">
            {children}
          </main>

        </div>
      </div>
      </div>
      <ConfirmDialog
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={logout}
        title="Sign out?"
        message="You will need to sign in again to open the console."
        confirmLabel="Sign out"
        danger
      />
    </>
  );
}

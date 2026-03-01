/**
 * AppsPage
 * Runner-centric applications page. Shows dockhand apps (each with multiple
 * named operations as inline buttons). Features a "All Apps" / "Updates" sub-tab,
 * a nav badge callback, and a sidebar for view/filter control.
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import axios from "axios";
import { RefreshCw, SlidersHorizontal, Search, X, Cpu, ArrowUpCircle, Loader } from "lucide-react";
import { API_BASE_URL } from "../constants/api";
import { useIsMobile } from "../hooks/useIsMobile";
import ErrorBoundary from "../components/ErrorBoundary";
import MobileDrawer from "../components/ui/MobileDrawer";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import Button from "../components/ui/Button";
import SearchInput from "../components/ui/SearchInput";
import RunOperationModal from "../components/ui/RunOperationModal";
import AppCard from "../components/apps/AppCard";
import AppsSidebar, { APPS_VIEWS } from "../components/apps/AppsSidebar";
import AppsHistoryTab from "../components/apps/AppsHistoryTab";
import { EnrollmentModal } from "../components/settings/RunnerTab";
import styles from "./AppsPage.module.css";

function hasVersionUpdate(current, latest) {
  if (!current || !latest) return false;
  return String(latest).replace(/^v/, "").trim() !== String(current).replace(/^v/, "").trim();
}

function appHasUpdate(app) {
  return (
    hasVersionUpdate(app.currentVersion, app.latestVersion) ||
    app.systemUpdatesAvailable === true
  );
}

/* ── Runner update card ────────────────────────────────────────────────── */

const RunnerUpdateCard = memo(function RunnerUpdateCard({ runner, onUpdate, updating }) {
  return (
    <div className={styles.updateCard}>
      <div className={styles.updateCardLeft}>
        <ArrowUpCircle size={16} className={styles.updateCardIcon} />
        <div className={styles.updateCardText}>
          <span className={styles.updateCardTitle}>dockhand update available</span>
          <span className={styles.updateCardVersions}>
            v{runner.version.replace(/^v/, "")}
            <span className={styles.updateCardArrow}> → </span>
            v{runner.latest_version.replace(/^v/, "")}
          </span>
        </div>
      </div>
      <button
        className={styles.updateCardBtn}
        onClick={() => onUpdate(runner)}
        disabled={updating}
        title={`Update dockhand on ${runner.name} to ${runner.latest_version}`}
      >
        {updating ? <Loader size={12} className={styles.spinIcon} /> : <ArrowUpCircle size={12} />}
        {updating ? "Updating..." : "Update"}
      </button>
    </div>
  );
});

/* ── Collapsible runner section header (grouped view) ──────────────────── */

const RunnerSectionHeader = memo(function RunnerSectionHeader({
  sectionKey,
  runner,
  count,
  isCollapsed,
  onToggle,
}) {
  return (
    <div
      className={styles.stackHeader}
      onClick={(e) => {
        try { e.currentTarget?.focus(); } catch { /* ignore */ }
        onToggle(sectionKey);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(sectionKey); }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={!isCollapsed}
      aria-label={`${runner.name} — ${isCollapsed ? "Expand" : "Collapse"}`}
    >
      <div className={styles.stackHeaderLeft}>
        <button
          className={styles.stackToggle}
          aria-hidden="true"
          tabIndex={-1}
        >
          {isCollapsed ? "▶" : "▼"}
        </button>
        <h3 className={styles.stackName}>{runner.name}</h3>
        <span className={styles.runnerUrl}>{runner.url}</span>
        {runner.version && (
          <span
            className={`${styles.runnerVersionBadge} ${
              hasVersionUpdate(runner.version, runner.latest_version)
                ? styles.runnerVersionOutdated
                : ""
            }`}
            title={
              hasVersionUpdate(runner.version, runner.latest_version)
                ? `Update available: ${runner.latest_version}`
                : `Dockhand v${runner.version.replace(/^v/, "")}`
            }
          >
            v{runner.version.replace(/^v/, "")}
            {hasVersionUpdate(runner.version, runner.latest_version) && (
              <span className={styles.updateDot} aria-label="Update available" />
            )}
          </span>
        )}
      </div>
      <span className={styles.stackCount}>
        {count} app{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
});

/* ── AppsHeader ────────────────────────────────────────────────────────── */

const AppsHeader = memo(function AppsHeader({
  searchQuery,
  onSearchChange,
  onRefresh,
  refreshing,
  mobileSidebarOpen,
  onMobileSidebarOpen,
}) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const onKeyDown = (e) => { if (e.key === "Escape") setMobileSearchOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSearchOpen]);

  return (
    <div className={styles.summaryHeader}>
      <div className={styles.headerContent}>
        <h2 className={styles.summaryHeaderTitle}>
          <span className="sr-only">Apps</span>
        </h2>

        <div className={styles.headerLeft}>
          <div className={styles.desktopOnly}>
            <SearchInput
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Search apps..."
              className={styles.searchInput}
            />
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.desktopActionGroup}>
            <div className={styles.buttonContainer}>
              <Button
                onClick={onRefresh}
                disabled={refreshing}
                title={refreshing ? "Refreshing..." : "Refresh apps"}
                variant="outline"
                icon={RefreshCw}
                size="sm"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </div>

          <div className={styles.mobileActionRow} aria-label="Apps actions">
            <Button
              onClick={onMobileSidebarOpen}
              variant="outline"
              icon={SlidersHorizontal}
              size="sm"
              title="Filters"
              aria-label="Open filters"
              aria-controls="apps-filters-drawer"
              aria-expanded={mobileSidebarOpen ? "true" : "false"}
              className={styles.iconOnlyButton}
            >
              <span className="sr-only">Filters</span>
            </Button>

            <Button
              onClick={() => setMobileSearchOpen(true)}
              variant="outline"
              icon={Search}
              size="sm"
              title="Search"
              aria-label="Search apps"
              className={styles.iconOnlyButton}
            >
              <span className="sr-only">Search</span>
            </Button>

            <Button
              onClick={onRefresh}
              disabled={refreshing}
              title={refreshing ? "Refreshing..." : "Refresh"}
              aria-label="Refresh apps"
              variant="outline"
              icon={RefreshCw}
              size="sm"
              className={styles.iconOnlyButton}
            >
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      {mobileSearchOpen && (
        <div className={styles.mobileSearchOverlay} role="dialog" aria-label="Search apps">
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search apps..."
            className={styles.mobileSearchInput}
            autoFocus
          />
          <Button
            onClick={() => setMobileSearchOpen(false)}
            variant="outline"
            icon={X}
            size="sm"
            title="Close search"
            aria-label="Close search"
            className={styles.iconOnlyButton}
          >
            <span className="sr-only">Close</span>
          </Button>
        </div>
      )}
    </div>
  );
});

/* ── ConfirmRunModal ───────────────────────────────────────────────────── */

function formatAge(ts) {
  if (!ts) return null;
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const ConfirmRunModal = memo(function ConfirmRunModal({ pending, onConfirm, onCancel }) {
  const { runner, app, op } = pending;
  const lastRun = op.lastRun;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className={styles.confirmOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-run-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className={styles.confirmModal}>
        <div className={styles.confirmHeader}>
          <span id="confirm-run-title" className={styles.confirmTitle}>Run Operation?</span>
          <button className={styles.confirmCloseBtn} onClick={onCancel} aria-label="Cancel">
            <X size={18} />
          </button>
        </div>

        <div className={styles.confirmBody}>
          <div className={styles.confirmAppName}>{app.name}</div>
          {app.description && (
            <p className={styles.confirmAppDesc}>{app.description}</p>
          )}

          <div className={styles.confirmMeta}>
            <div className={styles.confirmMetaRow}>
              <span className={styles.confirmMetaLabel}>Operation</span>
              <span className={styles.confirmMetaValue}>{op.label || op.name}</span>
            </div>
            <div className={styles.confirmMetaRow}>
              <span className={styles.confirmMetaLabel}>Runner</span>
              <span className={styles.confirmMetaValue}>{runner.name}</span>
            </div>
            {lastRun && (
              <div className={styles.confirmMetaRow}>
                <span className={styles.confirmMetaLabel}>Last run</span>
                <span
                  className={`${styles.confirmMetaValue} ${
                    lastRun.exitCode === 0 ? styles.confirmLastRunOk : styles.confirmLastRunFail
                  }`}
                >
                  {formatAge(lastRun.startedAt)} · exit {lastRun.exitCode}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.confirmFooter}>
          <button className={styles.confirmCancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.confirmRunBtn} onClick={onConfirm} autoFocus>
            Run {op.label || op.name}
          </button>
        </div>
      </div>
    </div>
  );
});

/* ── AppsPage ──────────────────────────────────────────────────────────── */

export default function AppsPage({ onAppsUpdatesChange, onNavigateToRunners }) {
  const isMobile = useIsMobile();

  // Data
  const [runners, setRunners] = useState([]);
  const [apps, setApps] = useState({}); // runnerId → app[]
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [appErrors, setAppErrors] = useState({}); // runnerId → string

  // UI state
  const [search, setSearch] = useState("");
  const [view, setView] = useState(APPS_VIEWS.UPDATES);
  const [selectedRunners, setSelectedRunners] = useState(new Set());
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pendingRun, setPendingRun] = useState(null); // { runner, app, op } — confirmation
  const [runOp, setRunOp] = useState(null); // { runnerId, appName, operationName } — executing
  const [updatingRunner, setUpdatingRunner] = useState(null); // runnerId being updated
  const [showAddRunner, setShowAddRunner] = useState(false);

  /* ── Data fetching ──────────────────────────────────────────────────── */

  const fetchAppsForRunner = useCallback(async (runner) => {
    try {
      const { data } = await axios.get(
        `${API_BASE_URL}/api/runners/${runner.id}/apps`
      );
      const runnerApps = data.apps || [];
      setApps((prev) => ({ ...prev, [runner.id]: runnerApps }));
      setAppErrors((prev) => ({ ...prev, [runner.id]: null }));
    } catch (err) {
      setAppErrors((prev) => ({
        ...prev,
        [runner.id]: err.response?.data?.error || err.message,
      }));
      setApps((prev) => ({ ...prev, [runner.id]: [] }));
    }
  }, []);

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/runners`);
      const list = (data.runners || []).filter((r) => r.enabled !== 0);
      setRunners(list);
      await Promise.all(list.map(fetchAppsForRunner));
    } catch (err) {
      console.error("AppsPage: failed to fetch runners", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAppsForRunner]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refresh runner/app data every 5 minutes to pick up version updates
  useEffect(() => {
    const id = setInterval(() => fetchAll(true), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchAll]);

  /* ── Derived data ──────────────────────────────────────────────────── */

  const enabledRunners = useMemo(
    () => runners.filter((r) => r.enabled !== 0),
    [runners]
  );

  const filteredRunners = useMemo(
    () =>
      selectedRunners.size === 0
        ? enabledRunners
        : enabledRunners.filter((r) => selectedRunners.has(r.id)),
    [enabledRunners, selectedRunners]
  );

  // Flat list of all apps across all filtered runners (search applied)
  const allApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filteredRunners.flatMap((runner) =>
      (apps[runner.id] || [])
        .filter(
          (app) =>
            !q ||
            app.name.toLowerCase().includes(q) ||
            (app.description || "").toLowerCase().includes(q) ||
            runner.name.toLowerCase().includes(q)
        )
        .map((app) => ({ app, runner }))
    );
  }, [filteredRunners, apps, search]);

  // Apps that have version or system updates
  const appsWithUpdatesList = useMemo(
    () =>
      enabledRunners.flatMap((runner) =>
        (apps[runner.id] ?? [])
          .filter(appHasUpdate)
          .map((app) => ({ app, runner }))
      ),
    [enabledRunners, apps]
  );

  const totalApps = useMemo(
    () => enabledRunners.reduce((sum, r) => sum + (apps[r.id]?.length ?? 0), 0),
    [enabledRunners, apps]
  );

  // Notify parent of update count changes
  useEffect(() => {
    if (onAppsUpdatesChange) {
      onAppsUpdatesChange(appsWithUpdatesList.length);
    }
  }, [appsWithUpdatesList.length, onAppsUpdatesChange]);

  /* ── Handlers ──────────────────────────────────────────────────────── */

  const handleToggleSection = useCallback((key) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleRun = useCallback((runner, app, op) => {
    setPendingRun({ runner, app, op });
  }, []);

  const handleConfirmRun = useCallback(() => {
    if (!pendingRun) return;
    const { runner, app, op } = pendingRun;
    setPendingRun(null);
    setRunOp({ runnerId: runner.id, appName: app.name, operationName: op.name });
  }, [pendingRun]);

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);

  const handleUpdate = useCallback(async (runner) => {
    setUpdatingRunner(runner.id);
    try {
      await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/update`);
      setTimeout(() => fetchAll(true), 8000);
    } catch (err) {
      console.error("AppsPage: runner update failed", err);
    } finally {
      setTimeout(() => setUpdatingRunner(null), 8000);
    }
  }, [fetchAll]);

  /* ── Render helpers ────────────────────────────────────────────────── */

  const renderGrid = (items, showRunner = true) => (
    <div className={styles.grid}>
      {items.map(({ app, runner }) => (
        <AppCard
          key={`${runner.id}:${app.name}`}
          app={app}
          runner={runner}
          onRun={handleRun}
          showRunner={showRunner}
        />
      ))}
    </div>
  );

  const renderGrouped = (items) =>
    filteredRunners.map((runner) => {
      const q = search.trim().toLowerCase();
      const runnerApps = (apps[runner.id] || []).filter(
        (app) =>
          !q ||
          app.name.toLowerCase().includes(q) ||
          (app.description || "").toLowerCase().includes(q)
      );

      const visibleApps = runnerApps;

      const sectionKey = String(runner.id);
      const isCollapsed = collapsedSections.has(sectionKey);
      const error = appErrors[runner.id];

      return (
        <div key={runner.id} className={styles.section}>
          <RunnerSectionHeader
            sectionKey={sectionKey}
            runner={runner}
            count={visibleApps.length}
            isCollapsed={isCollapsed}
            onToggle={handleToggleSection}
          />
          {!isCollapsed && (
            <>
              {hasVersionUpdate(runner.version, runner.latest_version) && (
                <RunnerUpdateCard
                  runner={runner}
                  onUpdate={handleUpdate}
                  updating={updatingRunner === runner.id}
                />
              )}
              {error && <p className={styles.runnerError}>{error}</p>}
              {!error && visibleApps.length === 0 && (
                <p className={styles.noOps}>No apps configured on this runner.</p>
              )}
              {!error && visibleApps.length > 0 && (
                renderGrid(visibleApps.map((app) => ({ app, runner })), false)
              )}
            </>
          )}
        </div>
      );
    });

  /* ── Content area ─────────────────────────────────────────────────── */

  const renderContent = () => {
    if (loading) {
      return <LoadingSpinner size="md" message="Loading apps..." />;
    }

    if (enabledRunners.length === 0) {
      return (
        <div className={styles.emptyStateMessage}>
          <Cpu size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p className={styles.emptyStateText}>
            No runners configured. Add a runner in{" "}
            <span className={styles.emptyStateLink}>Settings → Runners</span> to see apps here.
          </p>
        </div>
      );
    }

    if (totalApps === 0) {
      return (
        <div className={styles.emptyStateMessage}>
          <p className={styles.emptyStateText}>
            No apps found. Add apps to your dockhand config file on each runner.
          </p>
        </div>
      );
    }

    // History view — full-width, bypasses sidebar grid layout
    if (view === APPS_VIEWS.HISTORY) {
      return <AppsHistoryTab runners={enabledRunners} />;
    }

    // Updates filter
    if (view === APPS_VIEWS.UPDATES) {
      const updateItems = appsWithUpdatesList.filter(({ app, runner }) => {
        if (selectedRunners.size > 0 && !selectedRunners.has(runner.id)) return false;
        const q = search.trim().toLowerCase();
        return !q || app.name.toLowerCase().includes(q) || runner.name.toLowerCase().includes(q);
      });

      if (updateItems.length === 0) {
        return (
          <div className={styles.emptyStateMessage}>
            <p className={styles.emptyStateText}>No apps with pending updates.</p>
          </div>
        );
      }

      return <div className={styles.appsContainer}>{renderGrid(updateItems)}</div>;
    }

    if (allApps.length === 0 && search) {
      return (
        <div className={styles.emptyStateMessage}>
          <p className={styles.emptyStateText}>
            No apps match <strong>"{search}"</strong>.
          </p>
        </div>
      );
    }

    if (view === APPS_VIEWS.GROUPED) {
      return (
        <div className={styles.appsContainer}>
          {renderGrouped(allApps)}
        </div>
      );
    }

    const updateableRunners = filteredRunners.filter((r) =>
      hasVersionUpdate(r.version, r.latest_version)
    );
    return (
      <div className={styles.appsContainer}>
        {updateableRunners.length > 0 && (
          <div className={styles.updateCards}>
            {updateableRunners.map((r) => (
              <RunnerUpdateCard
                key={r.id}
                runner={r}
                onUpdate={handleUpdate}
                updating={updatingRunner === r.id}
              />
            ))}
          </div>
        )}
        {renderGrid(allApps)}
      </div>
    );
  };

  const sidebar = (
    <AppsSidebar
      view={view}
      onViewChange={setView}
      runners={enabledRunners}
      selectedRunners={selectedRunners}
      onSelectedRunnersChange={setSelectedRunners}
      totalOps={totalApps}
      updatesCount={appsWithUpdatesList.length}
      onAddRunner={() => setShowAddRunner(true)}
      onManageRunners={onNavigateToRunners}
    />
  );

  return (
    <div className={styles.appsPage}>
      <AppsHeader
        searchQuery={search}
        onSearchChange={(e) => setSearch(e.target.value)}
        onRefresh={() => fetchAll(true)}
        refreshing={refreshing}
        mobileSidebarOpen={mobileSidebarOpen}
        onMobileSidebarOpen={openMobileSidebar}
      />

      <div className={styles.sidebarLayout}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <ErrorBoundary>
            <div
              className={styles.sidebar}
              role="complementary"
              aria-label="Apps filters"
            >
              {sidebar}
            </div>
          </ErrorBoundary>
        )}

        {/* Mobile drawer */}
        <ErrorBoundary>
          <MobileDrawer
            isOpen={mobileSidebarOpen}
            onClose={closeMobileSidebar}
            title="Filters"
            ariaLabel="Apps filters"
          >
            <AppsSidebar
              view={view}
              onViewChange={(v) => { setView(v); closeMobileSidebar(); }}
              runners={enabledRunners}
              selectedRunners={selectedRunners}
              onSelectedRunnersChange={setSelectedRunners}
              totalOps={totalApps}
              updatesCount={appsWithUpdatesList.length}
              onAddRunner={() => { setShowAddRunner(true); closeMobileSidebar(); }}
              onManageRunners={onNavigateToRunners}
            />
          </MobileDrawer>
        </ErrorBoundary>

        {/* Content */}
        <div className={styles.contentArea}>
          {renderContent()}
        </div>
      </div>

      {showAddRunner && (
        <EnrollmentModal
          onClose={() => setShowAddRunner(false)}
          onEnrolled={() => {
            setShowAddRunner(false);
            fetchAll(true);
          }}
        />
      )}

      {pendingRun && (
        <ConfirmRunModal
          pending={pendingRun}
          onConfirm={handleConfirmRun}
          onCancel={() => setPendingRun(null)}
        />
      )}

      <RunOperationModal
        isOpen={!!runOp}
        runnerId={runOp?.runnerId}
        appName={runOp?.appName}
        operationName={runOp?.operationName}
        onClose={() => {
          setRunOp(null);
          // Refresh to pick up updated active state
          fetchAll(true);
        }}
      />
    </div>
  );
}

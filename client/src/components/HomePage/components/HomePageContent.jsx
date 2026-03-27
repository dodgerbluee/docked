/**
 * HomePage content component
 */

import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import TabNavigation from "../../TabNavigation/TabNavigation";
import MobileNavigation from "../../Navigation/MobileNavigation";
import RateLimitError from "../../ErrorDisplay/RateLimitError";
import LoadingSpinner from "../../ui/LoadingSpinner";
import { TAB_NAMES, CONTENT_TABS } from "../../../constants/apiConstants";
import { SETTINGS_TABS } from "../../../constants/settings";

// Lazy-loaded tab pages — only one is active at a time
const SummaryPage = lazy(() => import("../../../pages/SummaryPage"));
const TrackedAppsPage = lazy(() => import("../../../pages/TrackedAppsPage"));
const ContainersPage = lazy(() => import("../../../pages/ContainersPage"));
const AppsPage = lazy(() => import("../../../pages/AppsPage"));
const AnalyticsPage = lazy(() => import("../../../pages/AnalyticsPage"));
const SettingsPage = lazy(() => import("../../../pages/SettingsPage"));
const BatchPage = lazy(() => import("../../../pages/BatchPage"));
const AdminPage = lazy(() => import("../../../pages/AdminPage"));

/**
 * HomePage content component
 * @param {Object} props
 */
const HomePageContent = ({
  darkMode,
  instanceAdmin,
  activeTab,
  contentTab,
  settingsTab,
  configurationTab,
  containers,
  containersWithUpdates,
  trackedAppsBehind,
  loading,
  pulling,
  error,
  pullError,
  pullSuccess,
  sourceInstances,
  unusedImages,
  unusedImagesCount,
  trackedApps,
  dismissedTrackedAppNotifications,
  containersBySource,
  loadingInstances,
  dockerHubDataPulled,
  dataFetched,
  lastPullTime,
  successfullyUpdatedContainersRef,
  selectedSourceInstances,
  username,
  authToken,
  avatar,
  recentAvatars,
  colorScheme,
  batchConfig,
  setActiveTab,
  setContentTab,
  setSettingsTab,
  setConfigurationTab,
  setSelectedSourceInstances,
  setError,
  setContainers,
  setUnusedImages,
  setUnusedImagesCount,
  fetchContainers,
  fetchUnusedImages,
  fetchTrackedApps,
  openModal,
  handlePull,
  handleBatchPull,
  handleBatchTrackedAppsCheck,
  handleUsernameUpdate,
  handlePasswordUpdateSuccessWithNavigation,
  handleSourceInstancesChange,
  handleAvatarChange,
  handleRecentAvatarsChange,
  handleAvatarUploaded,
  handleBatchConfigUpdate,
  handleColorSchemeChange,
  onTemporaryThemeToggle,
  handleClear,
  handleClearGitHubCache,
  handleLogoutWithCleanup,
  editingSourceInstance,
  fetchSourceInstances,
  containerUpgrade,
}) => {
  const [appsWithUpdates, setAppsWithUpdates] = useState(0);

  // Render summary page
  const renderSummary = useCallback(() => {
    const isLoading = loading;
    return (
      <SummaryPage
        portainerInstances={sourceInstances}
        containers={containers}
        unusedImages={unusedImages}
        unusedImagesCount={unusedImagesCount}
        trackedApps={trackedApps}
        dismissedTrackedAppNotifications={dismissedTrackedAppNotifications}
        onNavigateToPortainer={() => setActiveTab(TAB_NAMES.CONTAINERS)}
        onNavigateToTrackedApps={() => setActiveTab(TAB_NAMES.TRACKED_APPS)}
        onNavigateToAnalytics={() => setActiveTab(TAB_NAMES.ANALYTICS)}
        onSetSelectedPortainerInstances={setSelectedSourceInstances}
        onSetContentTab={setContentTab}
        isLoading={isLoading}
        dataFetched={dataFetched}
        onAddInstance={openModal}
      />
    );
  }, [
    loading,
    dataFetched,
    containers,
    sourceInstances,
    unusedImages,
    unusedImagesCount,
    trackedApps,
    dismissedTrackedAppNotifications,
    setActiveTab,
    setSelectedSourceInstances,
    setContentTab,
    openModal,
  ]);

  // Render tracked apps
  const renderTrackedApps = useCallback(() => {
    return (
      <TrackedAppsPage
        onDeleteTrackedApp={fetchTrackedApps}
        onUpgradeTrackedApp={fetchTrackedApps}
        onEditTrackedApp={fetchTrackedApps}
        onNavigateToSettings={() => {
          // Navigate to settings first
          setActiveTab(TAB_NAMES.SETTINGS);
          // Set the Tracked Apps tab after a delay to ensure Settings page is rendered
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(() => {
                setSettingsTab(SETTINGS_TABS.TRACKED_APPS);
              }, 200);
            });
          });
        }}
      />
    );
  }, [fetchTrackedApps, setActiveTab, setSettingsTab]);

  // Track previous tab to detect navigation
  const previousTabRef = useRef(activeTab);
  // Track last fetchContainers time to avoid re-fetching on rapid tab switches
  const lastContainerFetchRef = useRef(0);
  const MIN_FETCH_INTERVAL_MS = 30000; // 30 seconds minimum between tab-switch fetches

  // Scroll to top on tab change (important for mobile UX)
  useEffect(() => {
    if (previousTabRef.current !== activeTab) {
      window.scrollTo(0, 0);
    }
  }, [activeTab]);

  // Automatically refresh containers when navigating to Portainer or Summary tabs
  // This ensures containers are refreshed and update status is re-evaluated
  useEffect(() => {
    const previousTab = previousTabRef.current;
    const currentTab = activeTab;

    // Update ref unconditionally so the guard never re-fires due to a stale ref
    // (e.g. when fetchContainers identity changes but the tab didn't)
    previousTabRef.current = currentTab;

    // Only refresh if we're navigating TO Portainer or Summary (not FROM them)
    // This prevents unnecessary refreshes when already on those tabs
    if (
      previousTab !== currentTab &&
      (currentTab === TAB_NAMES.CONTAINERS || currentTab === TAB_NAMES.SUMMARY)
    ) {
      // Skip if we fetched recently (e.g. user switching tabs rapidly)
      const now = Date.now();
      if (now - lastContainerFetchRef.current < MIN_FETCH_INTERVAL_MS) {
        return;
      }

      // Refresh containers with update status re-evaluation
      // This fetches fresh data from Portainer and re-checks if updates are still needed
      if (fetchContainers) {
        // Use a small delay to avoid refreshing too frequently during rapid navigation
        // But don't delay too much - we want fresh data quickly
        const timeoutId = setTimeout(() => {
          lastContainerFetchRef.current = Date.now();
          fetchContainers(false, null, true, true); // showLoading=false, instanceUrl=null, portainerOnly=true, refreshUpdates=true
        }, 100); // Reduced delay from 300ms to 100ms for faster refresh

        return () => clearTimeout(timeoutId);
      }
    }
  }, [activeTab, fetchContainers]);

  // Mobile menu removed; avatar menu handles mobile options

  return (
    <div className="homepage-container">
      {/* Tabs - Show for all tabs except settings, configuration, batch logs, and admin */}
      {activeTab !== TAB_NAMES.SETTINGS &&
        activeTab !== TAB_NAMES.CONFIGURATION &&
        activeTab !== TAB_NAMES.BATCH_LOGS &&
        activeTab !== TAB_NAMES.ADMIN && (
          <>
            <TabNavigation
              activeTab={activeTab}
              onTabChange={(tab) => {
                setActiveTab(tab);
                if (tab === TAB_NAMES.CONTAINERS) {
                  setSelectedSourceInstances(new Set());
                  setContentTab(CONTENT_TABS.UPDATES);
                }
              }}
              containersWithUpdates={containersWithUpdates}
              trackedAppsBehind={trackedAppsBehind}
              appsWithUpdates={appsWithUpdates}
            />

            {/* Mobile Navigation - Bottom Navigation Bar */}
            <MobileNavigation
              activeTab={activeTab}
              onTabChange={(tab) => {
                setActiveTab(tab);
                if (tab === TAB_NAMES.CONTAINERS) {
                  setSelectedSourceInstances(new Set());
                  setContentTab(CONTENT_TABS.UPDATES);
                }
              }}
              containersWithUpdates={containersWithUpdates}
              trackedAppsBehind={trackedAppsBehind}
              appsWithUpdates={appsWithUpdates}
              darkMode={darkMode}
              instanceAdmin={instanceAdmin}
              onThemeToggle={onTemporaryThemeToggle}
              onLogout={handleLogoutWithCleanup}
            />
          </>
        )}

      {/* Mobile Navigation - Always show on mobile */}
      {activeTab === TAB_NAMES.SETTINGS ||
      activeTab === TAB_NAMES.CONFIGURATION ||
      activeTab === TAB_NAMES.BATCH_LOGS ||
      activeTab === TAB_NAMES.ADMIN ? (
        <MobileNavigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          containersWithUpdates={containersWithUpdates}
          trackedAppsBehind={trackedAppsBehind}
          appsWithUpdates={appsWithUpdates}
          darkMode={darkMode}
          instanceAdmin={instanceAdmin}
          onThemeToggle={onTemporaryThemeToggle}
          onLogout={handleLogoutWithCleanup}
        />
      ) : null}

      {/* Tab Content */}
      <div className="tab-content">
        <Suspense fallback={<LoadingSpinner />}>
          {activeTab === TAB_NAMES.SETTINGS ? (
            <SettingsPage
              key={username || authToken || "settings"}
              username={username}
              avatar={avatar}
              recentAvatars={recentAvatars || []}
              containers={containers}
              sourceInstances={sourceInstances}
              onUsernameUpdate={handleUsernameUpdate}
              onLogout={handleLogoutWithCleanup}
              onPasswordUpdateSuccess={handlePasswordUpdateSuccessWithNavigation}
              onSourceInstancesChange={handleSourceInstancesChange}
              onAvatarChange={handleAvatarChange}
              onRecentAvatarsChange={handleRecentAvatarsChange}
              onAvatarUploaded={handleAvatarUploaded}
              onBatchConfigUpdate={handleBatchConfigUpdate}
              colorScheme={colorScheme}
              onColorSchemeChange={handleColorSchemeChange}
              onClearPortainerData={handleClear}
              onClearTrackedAppData={handleClearGitHubCache}
              onEditInstance={openModal}
              editingSourceInstance={editingSourceInstance}
              refreshInstances={editingSourceInstance === null ? fetchSourceInstances : null}
              activeTab={settingsTab}
              onTabChange={setSettingsTab}
            />
          ) : activeTab === TAB_NAMES.CONFIGURATION ? (
            <BatchPage
              onBatchConfigUpdate={handleBatchConfigUpdate}
              colorScheme={colorScheme}
              onColorSchemeChange={handleColorSchemeChange}
              onTriggerBatch={handleBatchPull}
              onTriggerTrackedAppsBatch={handleBatchTrackedAppsCheck}
              activeTab={configurationTab}
              onTabChange={setConfigurationTab}
            />
          ) : activeTab === TAB_NAMES.BATCH_LOGS ? (
            <BatchPage
              onBatchConfigUpdate={handleBatchConfigUpdate}
              colorScheme={colorScheme}
              onColorSchemeChange={handleColorSchemeChange}
              onTriggerBatch={handleBatchPull}
              onTriggerTrackedAppsBatch={handleBatchTrackedAppsCheck}
              activeTab="history"
            />
          ) : (
            <>
              {/* Only show container-fetch errors on tabs that use container data */}
              {(activeTab === TAB_NAMES.SUMMARY || activeTab === TAB_NAMES.CONTAINERS) && (
                <RateLimitError
                  error={error}
                  onDismiss={() => setError(null)}
                  onRetry={handlePull}
                  pulling={pulling}
                  loading={loading}
                />
              )}

              {activeTab === TAB_NAMES.SUMMARY && renderSummary()}
              {/* AppsPage is always mounted so it can report update counts for the tab badge */}
              <div style={activeTab !== TAB_NAMES.APPS ? { display: "none" } : undefined}>
                <AppsPage
                  onAppsUpdatesChange={setAppsWithUpdates}
                  onNavigateToRunners={() => {
                    setActiveTab(TAB_NAMES.SETTINGS);
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        setTimeout(() => setSettingsTab(SETTINGS_TABS.SOURCES), 200);
                      });
                    });
                  }}
                  onNavigateToIntents={() => {
                    setActiveTab(TAB_NAMES.SETTINGS);
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        setTimeout(() => setSettingsTab(SETTINGS_TABS.SOURCES), 200);
                      });
                    });
                  }}
                />
              </div>
              {activeTab === TAB_NAMES.ANALYTICS && (
                <AnalyticsPage sourceInstances={sourceInstances} />
              )}
              {activeTab === TAB_NAMES.CONTAINERS && (
                <ContainersPage
                  sourceInstances={sourceInstances}
                  containers={containers}
                  unusedImages={unusedImages}
                  unusedImagesCount={unusedImagesCount}
                  containersBySource={containersBySource}
                  loadingInstances={loadingInstances}
                  dockerHubDataPulled={dockerHubDataPulled}
                  lastPullTime={lastPullTime}
                  successfullyUpdatedContainersRef={successfullyUpdatedContainersRef}
                  onContainersUpdate={setContainers}
                  onUnusedImagesUpdate={setUnusedImages}
                  onUnusedImagesCountUpdate={setUnusedImagesCount}
                  onAddInstance={openModal}
                  onPullDockerHub={handlePull}
                  pullingDockerHub={pulling}
                  pullError={pullError}
                  pullSuccess={pullSuccess}
                  selectedSourceInstances={selectedSourceInstances}
                  onSetSelectedSourceInstances={setSelectedSourceInstances}
                  contentTab={contentTab}
                  onSetContentTab={setContentTab}
                  containerUpgradeFromProps={containerUpgrade}
                  fetchContainers={fetchContainers}
                  fetchUnusedImages={fetchUnusedImages}
                  onNavigateToLogs={() => {
                    setActiveTab(TAB_NAMES.SETTINGS);
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        setTimeout(() => setSettingsTab(SETTINGS_TABS.LOGS), 200);
                      });
                    });
                  }}
                  onManageSources={() => {
                    setActiveTab(TAB_NAMES.SETTINGS);
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        setTimeout(() => setSettingsTab(SETTINGS_TABS.SOURCES), 200);
                      });
                    });
                  }}
                  onManageIntents={() => {
                    setActiveTab(TAB_NAMES.SETTINGS);
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        setTimeout(() => setSettingsTab(SETTINGS_TABS.SOURCES), 200);
                      });
                    });
                  }}
                />
              )}
              {activeTab === TAB_NAMES.TRACKED_APPS && renderTrackedApps()}
              {activeTab === TAB_NAMES.ADMIN && <AdminPage />}
            </>
          )}
        </Suspense>
      </div>
    </div>
  );
};

HomePageContent.propTypes = {
  darkMode: PropTypes.bool,
  instanceAdmin: PropTypes.bool,
  activeTab: PropTypes.string.isRequired,
  contentTab: PropTypes.string.isRequired,
  settingsTab: PropTypes.string.isRequired,
  configurationTab: PropTypes.string.isRequired,
  containers: PropTypes.array.isRequired,
  containersWithUpdates: PropTypes.array.isRequired,
  trackedAppsBehind: PropTypes.number.isRequired,
  loading: PropTypes.bool.isRequired,
  pulling: PropTypes.bool.isRequired,
  error: PropTypes.string,
  pullError: PropTypes.string,
  pullSuccess: PropTypes.string,
  sourceInstances: PropTypes.array.isRequired,
  unusedImages: PropTypes.array.isRequired,
  unusedImagesCount: PropTypes.number.isRequired,
  trackedApps: PropTypes.array.isRequired,
  dismissedTrackedAppNotifications: PropTypes.object.isRequired,
  containersBySource: PropTypes.object.isRequired,
  loadingInstances: PropTypes.instanceOf(Set).isRequired,
  dockerHubDataPulled: PropTypes.bool.isRequired,
  lastPullTime: PropTypes.instanceOf(Date),
  successfullyUpdatedContainersRef: PropTypes.object.isRequired,
  selectedSourceInstances: PropTypes.instanceOf(Set).isRequired,
  username: PropTypes.string,
  authToken: PropTypes.string,
  avatar: PropTypes.string,
  recentAvatars: PropTypes.array,
  colorScheme: PropTypes.string.isRequired,
  batchConfig: PropTypes.object.isRequired,
  setActiveTab: PropTypes.func.isRequired,
  setContentTab: PropTypes.func.isRequired,
  setSettingsTab: PropTypes.func.isRequired,
  setConfigurationTab: PropTypes.func.isRequired,
  setSelectedSourceInstances: PropTypes.func.isRequired,
  setError: PropTypes.func.isRequired,
  setContainers: PropTypes.func.isRequired,
  setUnusedImages: PropTypes.func.isRequired,
  setUnusedImagesCount: PropTypes.func.isRequired,
  fetchContainers: PropTypes.func.isRequired,
  fetchUnusedImages: PropTypes.func.isRequired,
  fetchTrackedApps: PropTypes.func.isRequired,
  openModal: PropTypes.func.isRequired,
  handlePull: PropTypes.func.isRequired,
  handleBatchPull: PropTypes.func.isRequired,
  handleBatchTrackedAppsCheck: PropTypes.func.isRequired,
  handleUsernameUpdate: PropTypes.func.isRequired,
  handlePasswordUpdateSuccessWithNavigation: PropTypes.func.isRequired,
  handleSourceInstancesChange: PropTypes.func.isRequired,
  handleAvatarChange: PropTypes.func.isRequired,
  handleRecentAvatarsChange: PropTypes.func.isRequired,
  handleAvatarUploaded: PropTypes.func.isRequired,
  handleBatchConfigUpdate: PropTypes.func.isRequired,
  handleColorSchemeChange: PropTypes.func.isRequired,
  onTemporaryThemeToggle: PropTypes.func,
  handleClear: PropTypes.func.isRequired,
  handleClearGitHubCache: PropTypes.func.isRequired,
  handleLogoutWithCleanup: PropTypes.func.isRequired,
  editingSourceInstance: PropTypes.object,
  fetchSourceInstances: PropTypes.func.isRequired,
  containerUpgrade: PropTypes.object,
};

export default HomePageContent;

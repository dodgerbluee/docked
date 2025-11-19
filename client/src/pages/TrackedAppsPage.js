/**
 * TrackedAppsPage Component
 * Main page component for the Tracked Apps view
 */

import React, { useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { RefreshCw, Check } from "lucide-react";
import { useTrackedApps } from "../hooks/useTrackedApps";
import TrackedAppCard from "../components/TrackedAppCard";
import AddTrackedImageModal from "../components/AddTrackedImageModal";
import ConfirmDialog from "../components/ConfirmDialog";
import Button from "../components/ui/Button";
import SearchInput from "../components/ui/SearchInput";
import TrackedAppsSidebar from "../components/trackedApps/TrackedAppsSidebar";
import {
  TRACKED_APPS_CONTENT_TABS,
  TRACKED_APPS_SOURCE_FILTERS,
} from "../constants/trackedAppsPage";
import styles from "./TrackedAppsPage.module.css";

/**
 * TrackedAppsPage component
 * @param {Object} props - Component props
 * @param {Function} props.onDeleteTrackedImage - Handler for deleting tracked images
 * @param {Function} props.onUpgradeTrackedImage - Handler for upgrading tracked images (to refresh App.js state)
 * @param {Function} props.onEditTrackedImage - Handler for editing tracked images (to refresh App.js state)
 */
function TrackedAppsPage({ onDeleteTrackedImage, onUpgradeTrackedImage, onEditTrackedImage }) {
  const {
    trackedImages,
    trackedImageError,
    trackedImageSuccess,
    checkingUpdates,
    lastScanTime,
    editingTrackedImageData,
    showAddTrackedImageModal,
    handleTrackedImageModalSuccess,
    handleDeleteTrackedImage,
    handleUpgradeTrackedImage,
    handleEditTrackedImage,
    handleCheckTrackedImagesUpdates,
    setShowAddTrackedImageModal,
    setEditingTrackedImageData,
    confirmDialog,
    setConfirmDialog,
  } = useTrackedApps();

  const [showCheckmark, setShowCheckmark] = useState(false);
  const [selectedApps, setSelectedApps] = useState(new Set());
  const [contentTab, setContentTab] = useState(TRACKED_APPS_CONTENT_TABS.ALL);
  const [selectedSourceFilters, setSelectedSourceFilters] = useState(new Set());
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const [markingUpgraded, setMarkingUpgraded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleToggleSelect = (appId) => {
    setSelectedApps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(appId)) {
        newSet.delete(appId);
      } else {
        newSet.add(appId);
      }
      return newSet;
    });
  };

  // Show checkmark when check completes successfully
  useEffect(() => {
    if (trackedImageSuccess && !checkingUpdates) {
      setShowCheckmark(true);
      // Hide checkmark after 3 seconds
      const timer = setTimeout(() => setShowCheckmark(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [trackedImageSuccess, checkingUpdates]);

  // Hide checkmark when checking starts
  useEffect(() => {
    if (checkingUpdates) {
      setShowCheckmark(false);
    }
  }, [checkingUpdates]);

  // Filter by source type
  const filteredBySource = useMemo(() => {
    if (selectedSourceFilters.size === 0) {
      return trackedImages;
    }
    return trackedImages.filter((img) => {
      const sourceType = img.source_type || "docker";
      if (sourceType === "docker") {
        return selectedSourceFilters.has(TRACKED_APPS_SOURCE_FILTERS.DOCKERHUB);
      } else if (sourceType === "github") {
        return selectedSourceFilters.has(TRACKED_APPS_SOURCE_FILTERS.GITHUB);
      } else if (sourceType === "gitlab") {
        return selectedSourceFilters.has(TRACKED_APPS_SOURCE_FILTERS.GITLAB);
      }
      return false;
    });
  }, [trackedImages, selectedSourceFilters]);

  // Filter by search query
  const filteredBySearch = useMemo(() => {
    if (!searchQuery.trim()) {
      return filteredBySource;
    }

    const query = searchQuery.toLowerCase().trim();
    return filteredBySource.filter((img) => {
      const name = img.name?.toLowerCase() || "";
      const imageName = img.image_name?.toLowerCase() || "";
      const githubRepo = img.github_repo?.toLowerCase() || "";
      const currentVersion = img.current_version?.toLowerCase() || "";
      const latestVersion = img.latest_version?.toLowerCase() || "";
      return (
        name.includes(query) ||
        imageName.includes(query) ||
        githubRepo.includes(query) ||
        currentVersion.includes(query) ||
        latestVersion.includes(query)
      );
    });
  }, [filteredBySource, searchQuery]);

  // Memoize filtered arrays based on content tab
  const appsWithUpdates = useMemo(
    () => filteredBySearch.filter((img) => img.has_update),
    [filteredBySearch]
  );
  const appsWithoutUpdates = useMemo(
    () => filteredBySearch.filter((img) => !img.has_update),
    [filteredBySearch]
  );

  // Get apps to display based on content tab
  const displayedApps = useMemo(() => {
    if (contentTab === TRACKED_APPS_CONTENT_TABS.UPDATES) {
      return appsWithUpdates;
    } else if (contentTab === TRACKED_APPS_CONTENT_TABS.UP_TO_DATE) {
      return appsWithoutUpdates;
    } else {
      // ALL tab - combine both, with updates first
      return [...appsWithUpdates, ...appsWithoutUpdates];
    }
  }, [contentTab, appsWithUpdates, appsWithoutUpdates]);

  // Handle delete with callback
  const handleDelete = async (id) => {
    await handleDeleteTrackedImage(id);
    if (onDeleteTrackedImage) {
      onDeleteTrackedImage(id);
    }
  };

  // Handle upgrade with callback to refresh App.js state
  const handleUpgrade = async (id, latestVersion) => {
    await handleUpgradeTrackedImage(id, latestVersion);
    if (onUpgradeTrackedImage) {
      await onUpgradeTrackedImage();
    }
  };

  // Handle modal success with callback to refresh App.js state
  const handleModalSuccess = async (imageId) => {
    await handleTrackedImageModalSuccess(imageId);
    // Refresh App.js state after editing/adding to update notification count
    if (onEditTrackedImage) {
      await onEditTrackedImage();
    }
  };

  // Render add new app card
  const renderAddNewCard = () => (
    <div
      className={styles.addCard}
      onClick={() => {
        setEditingTrackedImageData(null); // Clear any editing state
        setShowAddTrackedImageModal(true);
      }}
      title="Track updates for Docker images or GitHub repositories. Docker examples: homeassistant/home-assistant, authentik/authentik, jellyfin/jellyfin, plexinc/pms-docker. GitHub examples: home-assistant/core, goauthentik/authentik, jellyfin/jellyfin"
    >
      <div className={styles.addCardIcon}>+</div>
    </div>
  );

  const handleToggleSection = (sectionKey) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  };

  // Handle select all apps with updates
  const handleSelectAll = () => {
    const allAppIds = appsWithUpdates.map((app) => app.id);
    const allSelected = allAppIds.length > 0 && allAppIds.every((id) => selectedApps.has(id));

    if (allSelected) {
      // Deselect all
      setSelectedApps(new Set());
    } else {
      // Select all
      setSelectedApps(new Set(allAppIds));
    }
  };

  // Handle batch mark upgraded
  const handleBatchMarkUpgraded = async () => {
    if (selectedApps.size === 0) return;

    setMarkingUpgraded(true);
    try {
      // Get all selected apps with their latest versions
      const selectedAppsData = appsWithUpdates.filter((app) => selectedApps.has(app.id));

      // Process each app sequentially
      for (const app of selectedAppsData) {
        if (app.latest_version) {
          await handleUpgrade(app.id, app.latest_version);
        }
      }

      // Clear selection after processing
      setSelectedApps(new Set());
    } catch (error) {
      console.error("Error marking apps as upgraded:", error);
    } finally {
      setMarkingUpgraded(false);
    }
  };

  // Check if all apps with updates are selected
  const allAppsWithUpdatesSelected = useMemo(() => {
    if (appsWithUpdates.length === 0) return false;
    return appsWithUpdates.every((app) => selectedApps.has(app.id));
  }, [appsWithUpdates, selectedApps]);

  return (
    <div className={styles.trackedAppsPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.summaryHeaderTitle}>Tracked Apps</h2>
          <div className={styles.headerActions}>
            <SearchInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search apps..."
              className={styles.searchInput}
            />
            <div className={styles.buttonContainer}>
              {appsWithUpdates.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    disabled={markingUpgraded}
                  >
                    {allAppsWithUpdatesSelected ? "Deselect All" : "Select All"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBatchMarkUpgraded}
                    disabled={selectedApps.size === 0 || markingUpgraded}
                  >
                    {markingUpgraded
                      ? `Marking Upgraded (${selectedApps.size})...`
                      : `Mark Upgraded (${selectedApps.size})`}
                  </Button>
                </>
              )}
              <Button
                onClick={handleCheckTrackedImagesUpdates}
                disabled={checkingUpdates || trackedImages.length === 0 || markingUpgraded}
                title={checkingUpdates ? "Checking for updates..." : "Check for updates"}
                variant="outline"
                icon={RefreshCw}
                size="sm"
              >
                {checkingUpdates ? "Checking for Updates..." : "Check for Updates"}
              </Button>
              {showCheckmark && <Check className={styles.checkmark} size={20} />}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.trackedAppsSidebarLayout}>
        <TrackedAppsSidebar
          contentTab={contentTab}
          onContentTabChange={setContentTab}
          selectedSourceFilters={selectedSourceFilters}
          onSelectedSourceFiltersChange={setSelectedSourceFilters}
        />
        <div className={styles.trackedAppsContentArea}>
          <div className={styles.contentTabPanel}>
            {trackedImageError && <div className={styles.errorMessage}>{trackedImageError}</div>}

            {/* Always show appsContainer for UP_TO_DATE and UPDATES tabs, or when there are apps to display */}
            {contentTab === TRACKED_APPS_CONTENT_TABS.UP_TO_DATE ||
            contentTab === TRACKED_APPS_CONTENT_TABS.UPDATES ||
            displayedApps.length > 0 ? (
              <div className={styles.appsContainer}>
                {contentTab === TRACKED_APPS_CONTENT_TABS.ALL && (
                  <>
                    {/* Apps with updates - shown at the top */}
                    {appsWithUpdates.length > 0 && (
                      <div className={styles.section}>
                        <div
                          className={styles.stackHeader}
                          onClick={() => handleToggleSection("apps-with-updates")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleToggleSection("apps-with-updates");
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-expanded={!collapsedSections.has("apps-with-updates")}
                          aria-label={`Apps with Updates - ${collapsedSections.has("apps-with-updates") ? "Expand" : "Collapse"}`}
                        >
                          <div className={styles.stackHeaderLeft}>
                            <button
                              className={styles.stackToggle}
                              aria-label={
                                collapsedSections.has("apps-with-updates")
                                  ? "Expand section"
                                  : "Collapse section"
                              }
                              aria-hidden="true"
                              tabIndex={-1}
                            >
                              {collapsedSections.has("apps-with-updates") ? "▶" : "▼"}
                            </button>
                            <h3 className={styles.stackName}>Apps with Updates</h3>
                          </div>
                          <span className={styles.stackCount}>
                            {appsWithUpdates.length} app{appsWithUpdates.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {!collapsedSections.has("apps-with-updates") && (
                          <div className={styles.gridWithUpdates}>
                            {appsWithUpdates.map((image) => (
                              <TrackedAppCard
                                key={image.id}
                                image={image}
                                onEdit={handleEditTrackedImage}
                                onUpgrade={handleUpgrade}
                                selected={selectedApps.has(image.id)}
                                onToggleSelect={handleToggleSelect}
                              />
                            ))}
                            {/* Add new app card - only show if Up to Date section doesn't exist */}
                            {appsWithoutUpdates.length === 0 && renderAddNewCard()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Apps without updates - shown below */}
                    {(appsWithoutUpdates.length > 0 || appsWithUpdates.length === 0) && (
                      <div className={styles.section}>
                        {appsWithUpdates.length > 0 && appsWithoutUpdates.length > 0 && (
                          <div
                            className={styles.stackHeader}
                            onClick={() => handleToggleSection("all-other-apps")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleToggleSection("all-other-apps");
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            aria-expanded={!collapsedSections.has("all-other-apps")}
                            aria-label={`All Other Apps - ${collapsedSections.has("all-other-apps") ? "Expand" : "Collapse"}`}
                          >
                            <div className={styles.stackHeaderLeft}>
                              <button
                                className={styles.stackToggle}
                                aria-label={
                                  collapsedSections.has("all-other-apps")
                                    ? "Expand section"
                                    : "Collapse section"
                                }
                                aria-hidden="true"
                                tabIndex={-1}
                              >
                                {collapsedSections.has("all-other-apps") ? "▶" : "▼"}
                              </button>
                              <h3 className={styles.stackName}>All Other Apps</h3>
                            </div>
                            <span className={styles.stackCount}>
                              {appsWithoutUpdates.length} app
                              {appsWithoutUpdates.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        )}
                        {!collapsedSections.has("all-other-apps") && (
                          <div className={styles.gridWithoutUpdates}>
                            {appsWithoutUpdates.map((image) => (
                              <TrackedAppCard
                                key={image.id}
                                image={image}
                                onEdit={handleEditTrackedImage}
                                onUpgrade={handleUpgrade}
                              />
                            ))}
                            {/* Add new app card - always at the end when Up to Date section exists */}
                            {appsWithoutUpdates.length > 0 && renderAddNewCard()}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {contentTab === TRACKED_APPS_CONTENT_TABS.UPDATES && (
                  <div className={styles.section}>
                    <div
                      className={styles.stackHeader}
                      onClick={() => handleToggleSection("updates-tab")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleToggleSection("updates-tab");
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={!collapsedSections.has("updates-tab")}
                      aria-label={`Apps with Updates - ${collapsedSections.has("updates-tab") ? "Expand" : "Collapse"}`}
                    >
                      <div className={styles.stackHeaderLeft}>
                        <button
                          className={styles.stackToggle}
                          aria-label={
                            collapsedSections.has("updates-tab")
                              ? "Expand section"
                              : "Collapse section"
                          }
                          aria-hidden="true"
                          tabIndex={-1}
                        >
                          {collapsedSections.has("updates-tab") ? "▶" : "▼"}
                        </button>
                        <h3 className={styles.stackName}>Apps with Updates</h3>
                      </div>
                      <span className={styles.stackCount}>
                        {displayedApps.length} app{displayedApps.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {!collapsedSections.has("updates-tab") && (
                      <div className={styles.gridWithUpdates}>
                        {displayedApps.map((image) => (
                          <TrackedAppCard
                            key={image.id}
                            image={image}
                            onEdit={handleEditTrackedImage}
                            onUpgrade={handleUpgrade}
                            selected={selectedApps.has(image.id)}
                            onToggleSelect={handleToggleSelect}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {contentTab === TRACKED_APPS_CONTENT_TABS.UP_TO_DATE && (
                  <div className={styles.section}>
                    <div
                      className={styles.stackHeader}
                      onClick={() => handleToggleSection("up-to-date-tab")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleToggleSection("up-to-date-tab");
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={!collapsedSections.has("up-to-date-tab")}
                      aria-label={`Up to Date - ${collapsedSections.has("up-to-date-tab") ? "Expand" : "Collapse"}`}
                    >
                      <div className={styles.stackHeaderLeft}>
                        <button
                          className={styles.stackToggle}
                          aria-label={
                            collapsedSections.has("up-to-date-tab")
                              ? "Expand section"
                              : "Collapse section"
                          }
                          aria-hidden="true"
                          tabIndex={-1}
                        >
                          {collapsedSections.has("up-to-date-tab") ? "▶" : "▼"}
                        </button>
                        <h3 className={styles.stackName}>Up to Date</h3>
                      </div>
                      <span className={styles.stackCount}>
                        {displayedApps.length} app{displayedApps.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {!collapsedSections.has("up-to-date-tab") && (
                      <div className={styles.gridWithoutUpdates}>
                        {displayedApps.length > 0
                          ? displayedApps.map((image) => (
                              <TrackedAppCard
                                key={image.id}
                                image={image}
                                onEdit={handleEditTrackedImage}
                                onUpgrade={handleUpgrade}
                              />
                            ))
                          : null}
                        {/* Add new app button - always visible, even when no apps */}
                        {renderAddNewCard()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : // Only show empty state if we're on ALL tab and have no apps
            // UP_TO_DATE and UPDATES tabs should always show their sections
            contentTab === TRACKED_APPS_CONTENT_TABS.ALL ? (
              <div className={styles.emptyState}>
                <div className={styles.grid}>{renderAddNewCard()}</div>
              </div>
            ) : null}

            {lastScanTime && (
              <div className={styles.lastScanTime}>
                Last scanned:{" "}
                {lastScanTime.toLocaleString(undefined, {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                  hour12: true,
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <AddTrackedImageModal
        isOpen={showAddTrackedImageModal}
        onClose={() => {
          setEditingTrackedImageData(null); // Clear editing state when modal closes
          setShowAddTrackedImageModal(false);
        }}
        onSuccess={handleModalSuccess}
        trackedImages={trackedImages}
        initialData={editingTrackedImageData}
        onDelete={handleDelete}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={() => {
          if (confirmDialog.onConfirm) {
            confirmDialog.onConfirm();
          }
        }}
        onCancel={() => {
          if (confirmDialog.onClose) {
            confirmDialog.onClose();
          } else {
            setConfirmDialog({ isOpen: false, title: "", message: "", onConfirm: null, onClose: null });
          }
        }}
      />
    </div>
  );
}

TrackedAppsPage.propTypes = {
  onDeleteTrackedImage: PropTypes.func,
};

export default TrackedAppsPage;

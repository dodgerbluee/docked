/**
 * Tracked Apps content area component
 */

import React from "react";
import PropTypes from "prop-types";
import TrackedAppCard from "../../../components/TrackedAppCard";
import TrackedAppUpgradeHistoryTab from "../../../components/trackedApps/TrackedAppUpgradeHistoryTab";
import { TRACKED_APPS_CONTENT_TABS } from "../../../constants/trackedAppsPage";
import styles from "../../TrackedAppsPage.module.css";

/**
 * Collapsible section header component
 */
const SectionHeader = ({ sectionKey, title, count, isCollapsed, onToggle }) => {
  return (
    <div
      className={styles.stackHeader}
      onClick={(e) => {
        // Focus the header before toggling to avoid aria-hidden on focused descendants
        try {
          e.currentTarget?.focus();
        } catch {
          // ignore focus errors
        }
        onToggle(sectionKey);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(sectionKey);
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={!isCollapsed}
      aria-label={`${title} - ${isCollapsed ? "Expand" : "Collapse"}`}
    >
      <div className={styles.stackHeaderLeft}>
        <button
          className={styles.stackToggle}
          aria-label={isCollapsed ? "Expand section" : "Collapse section"}
          aria-hidden="true"
          tabIndex={-1}
        >
          {isCollapsed ? "▶" : "▼"}
        </button>
        <h3 className={styles.stackName}>{title}</h3>
      </div>
      <span className={styles.stackCount}>
        {count} app{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
};

SectionHeader.propTypes = {
  sectionKey: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  count: PropTypes.number.isRequired,
  isCollapsed: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
};

/**
 * Add new app card component
 */
const AddNewCard = ({ onClick }) => (
  <div
    className={styles.addCard}
    onClick={onClick}
    title="Track updates for Docker images or GitHub repositories. Docker examples: homeassistant/home-assistant, authentik/authentik, jellyfin/jellyfin, plexinc/pms-docker. GitHub examples: home-assistant/core, goauthentik/authentik, jellyfin/jellyfin"
  >
    <div className={styles.addCardIcon}>+</div>
  </div>
);

AddNewCard.propTypes = {
  onClick: PropTypes.func.isRequired,
};

/**
 * Tracked Apps content area component
 * @param {Object} props
 * @param {string} props.contentTab - Current content tab
 * @param {Array} props.appsWithUpdates - Apps with updates
 * @param {Array} props.appsWithoutUpdates - Apps without updates
 * @param {Array} props.displayedApps - Apps to display based on tab
 * @param {Set} props.collapsedSections - Collapsed sections
 * @param {Function} props.onToggleSection - Section toggle handler
 * @param {Function} props.onEdit - Edit handler
 * @param {Function} props.onUpgrade - Upgrade handler
 * @param {Function} props.onAddNew - Add new app handler
 * @param {number} props.trackedAppsCount - Total number of tracked apps
 * @param {boolean} props.isLoading - Whether data is loading
 * @param {boolean} props.hasLoadedOnce - Whether we've loaded data at least once
 * @param {Function} props.onNavigateToSettings - Handler for navigating to Settings page
 */
const TrackedAppsContentArea = ({
  contentTab,
  appsWithUpdates,
  appsWithoutUpdates,
  displayedApps,
  collapsedSections,
  onToggleSection,
  onEdit,
  onUpgrade,
  onAddNew,
  trackedAppsCount = 0,
  isLoading = false,
  hasLoadedOnce = false,
  onNavigateToSettings,
}) => {
  // Render upgrade history tab separately
  if (contentTab === TRACKED_APPS_CONTENT_TABS.UPGRADE_HISTORY) {
    return (
      <div className={styles.contentTabPanel}>
        <TrackedAppUpgradeHistoryTab />
      </div>
    );
  }

  return (
    <div className={styles.contentTabPanel}>
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
                  <SectionHeader
                    sectionKey="apps-with-updates"
                    title="Apps with Updates"
                    count={appsWithUpdates.length}
                    isCollapsed={collapsedSections.has("apps-with-updates")}
                    onToggle={onToggleSection}
                  />
                  {!collapsedSections.has("apps-with-updates") && (
                    <div className={styles.gridWithUpdates}>
                      {appsWithUpdates.map((image) => (
                        <TrackedAppCard
                          key={image.id}
                          image={image}
                          onEdit={onEdit}
                          onUpgrade={onUpgrade}
                        />
                      ))}
                      {/* Add new app card - only show if Up to Date section doesn't exist */}
                      {appsWithoutUpdates.length === 0 && <AddNewCard onClick={onAddNew} />}
                    </div>
                  )}
                </div>
              )}

              {/* Apps without updates - shown below */}
              {(appsWithoutUpdates.length > 0 || appsWithUpdates.length === 0) && (
                <div className={styles.section}>
                  {appsWithUpdates.length > 0 && appsWithoutUpdates.length > 0 && (
                    <SectionHeader
                      sectionKey="all-other-apps"
                      title="All Other Apps"
                      count={appsWithoutUpdates.length}
                      isCollapsed={collapsedSections.has("all-other-apps")}
                      onToggle={onToggleSection}
                    />
                  )}
                  {!collapsedSections.has("all-other-apps") && (
                    <div className={styles.gridWithoutUpdates}>
                      {appsWithoutUpdates.map((image) => (
                        <TrackedAppCard
                          key={image.id}
                          image={image}
                          onEdit={onEdit}
                          onUpgrade={onUpgrade}
                        />
                      ))}
                      {/* Add new app card - always at the end when Up to Date section exists */}
                      {appsWithoutUpdates.length > 0 && <AddNewCard onClick={onAddNew} />}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {contentTab === TRACKED_APPS_CONTENT_TABS.UPDATES && (
            <div className={styles.section}>
              <SectionHeader
                sectionKey="updates-tab"
                title="Apps with Updates"
                count={displayedApps.length}
                isCollapsed={collapsedSections.has("updates-tab")}
                onToggle={onToggleSection}
              />
              {!collapsedSections.has("updates-tab") && (
                <div className={styles.gridWithUpdates}>
                  {displayedApps.map((image) => (
                    <TrackedAppCard
                      key={image.id}
                      image={image}
                      onEdit={onEdit}
                      onUpgrade={onUpgrade}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {contentTab === TRACKED_APPS_CONTENT_TABS.UP_TO_DATE && (
            <div className={styles.section}>
              <SectionHeader
                sectionKey="up-to-date-tab"
                title="Up to Date"
                count={displayedApps.length}
                isCollapsed={collapsedSections.has("up-to-date-tab")}
                onToggle={onToggleSection}
              />
              {!collapsedSections.has("up-to-date-tab") && (
                <div className={styles.gridWithoutUpdates}>
                  {displayedApps.length > 0
                    ? displayedApps.map((image) => (
                        <TrackedAppCard
                          key={image.id}
                          image={image}
                          onEdit={onEdit}
                          onUpgrade={onUpgrade}
                        />
                      ))
                    : null}
                  {/* Add new app button - always visible, even when no apps */}
                  <AddNewCard onClick={onAddNew} />
                </div>
              )}
            </div>
          )}
        </div>
      ) : // Only show empty state if we're on ALL tab and have no apps
      // UP_TO_DATE and UPDATES tabs should always show their sections
      contentTab === TRACKED_APPS_CONTENT_TABS.ALL ? (
        <div className={styles.emptyState}>
          {!hasLoadedOnce ? (
            // Don't show anything on initial load - prevents flash of empty state
            <div className={styles.emptyStateMessage}>
              <p className={styles.emptyStateText}>&nbsp;</p>
            </div>
          ) : trackedAppsCount === 0 ? (
            <div className={styles.emptyStateMessage}>
              <p className={styles.emptyStateText}>
                No tracked apps configured.{" "}
                <button type="button" onClick={onAddNew} className={styles.emptyStateLink}>
                  Add a tracked app
                </button>
                {" or "}
                <button
                  type="button"
                  onClick={onNavigateToSettings}
                  className={styles.emptyStateLink}
                >
                  disable the page in Settings
                </button>
                .
              </p>
            </div>
          ) : (
            <div className={styles.grid}>
              <AddNewCard onClick={onAddNew} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

TrackedAppsContentArea.propTypes = {
  contentTab: PropTypes.string.isRequired,
  appsWithUpdates: PropTypes.array.isRequired,
  appsWithoutUpdates: PropTypes.array.isRequired,
  displayedApps: PropTypes.array.isRequired,
  collapsedSections: PropTypes.instanceOf(Set).isRequired,
  onToggleSection: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
  onAddNew: PropTypes.func.isRequired,
  trackedAppsCount: PropTypes.number,
  isLoading: PropTypes.bool,
  hasLoadedOnce: PropTypes.bool,
  onNavigateToSettings: PropTypes.func,
};

export default TrackedAppsContentArea;

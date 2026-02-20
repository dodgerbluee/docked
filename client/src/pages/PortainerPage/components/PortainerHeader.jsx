/**
 * Portainer page header component
 */

import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { RefreshCw, Check, SlidersHorizontal, Search, X } from "lucide-react";
import Button from "../../../components/ui/Button";
import SearchInput from "../../../components/ui/SearchInput";
import styles from "../../PortainerPage.module.css";

/**
 * Portainer header component
 * @param {Object} props
 * @param {string} props.searchQuery - Search query value
 * @param {Function} props.onSearchChange - Search change handler
 * @param {Function} props.onPullDockerHub - Docker Hub pull handler
 * @param {boolean} props.pullingDockerHub - Whether pulling from Docker Hub
 * @param {boolean} props.showCheckmark - Whether to show success checkmark
 * @param {number} props.portainerInstancesCount - Number of Portainer instances
 * @param {React.ReactNode} props.toolbarActions - Toolbar action buttons
 */
const PortainerHeader = ({
  searchQuery,
  onSearchChange,
  onPullDockerHub,
  pullingDockerHub,
  showCheckmark,
  portainerInstancesCount,
  toolbarActions,
  mobileSidebarOpen,
  onMobileSidebarOpen,
}) => {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  React.useEffect(() => {
    if (!mobileSearchOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setMobileSearchOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSearchOpen]);

  const mobileRefreshTitle = useMemo(() => {
    return pullingDockerHub ? "Checking for updates..." : "Check for updates";
  }, [pullingDockerHub]);

  return (
    <div className={styles.summaryHeader}>
      <div className={styles.headerContent}>
        <h2 className={styles.portainerHeader}>
          <span className="sr-only">Portainer Containers</span>
        </h2>
        <div className={styles.headerLeft}>
          <div className={styles.desktopOnly}>
            <SearchInput
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Search containers..."
              className={styles.searchInput}
            />
          </div>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.desktopActionGroup}>
            <div className={styles.buttonContainer}>
              {toolbarActions}
              <Button
                onClick={onPullDockerHub}
                disabled={pullingDockerHub || portainerInstancesCount === 0}
                title={mobileRefreshTitle}
                variant="outline"
                icon={RefreshCw}
                size="sm"
              >
                {pullingDockerHub ? "Checking for Updates..." : "Check for Updates"}
              </Button>
              {showCheckmark && <Check className={styles.checkmark} size={20} />}
            </div>
          </div>

          <div className={styles.mobileActionRow} aria-label="Portainer actions">
            <Button
              onClick={onMobileSidebarOpen}
              variant="outline"
              icon={SlidersHorizontal}
              size="sm"
              title="Filters"
              aria-label="Open filters"
              aria-controls="portainer-filters-drawer"
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
              aria-label="Search containers"
              className={styles.iconOnlyButton}
            >
              <span className="sr-only">Search</span>
            </Button>

            {toolbarActions && <div className={styles.mobileToolbarActions}>{toolbarActions}</div>}

            <Button
              onClick={onPullDockerHub}
              disabled={pullingDockerHub || portainerInstancesCount === 0}
              title={mobileRefreshTitle}
              aria-label={mobileRefreshTitle}
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
        <div className={styles.mobileSearchOverlay} role="dialog" aria-label="Search containers">
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search containers..."
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
};

PortainerHeader.propTypes = {
  searchQuery: PropTypes.string.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  onPullDockerHub: PropTypes.func.isRequired,
  pullingDockerHub: PropTypes.bool.isRequired,
  showCheckmark: PropTypes.bool.isRequired,
  portainerInstancesCount: PropTypes.number.isRequired,
  toolbarActions: PropTypes.node,
  mobileSidebarOpen: PropTypes.bool,
  onMobileSidebarOpen: PropTypes.func,
};

export default PortainerHeader;

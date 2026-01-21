/**
 * Portainer page header component
 */

import React from "react";
import PropTypes from "prop-types";
import { RefreshCw, Check } from "lucide-react";
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
}) => {
  return (
    <div className={styles.summaryHeader}>
      <div className={styles.headerContent}>
        <h2 className={styles.portainerHeader}>
          <span className="sr-only">Portainer Containers</span>
        </h2>
        <div className={styles.headerLeft}>
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search containers..."
            className={styles.searchInput}
          />
        </div>
        <div className={styles.headerActions}>
          {toolbarActions && <div className={styles.toolbarActions}>{toolbarActions}</div>}
          <div className={styles.buttonContainer}>
            <Button
              onClick={onPullDockerHub}
              disabled={pullingDockerHub || portainerInstancesCount === 0}
              title={pullingDockerHub ? "Checking for updates..." : "Check for updates"}
              variant="outline"
              icon={RefreshCw}
              size="sm"
            >
              {pullingDockerHub ? "Checking for Updates..." : "Check for Updates"}
            </Button>
            {showCheckmark && <Check className={styles.checkmark} size={20} />}
          </div>
        </div>
      </div>
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
};

export default PortainerHeader;

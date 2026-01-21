import React from "react";
import PropTypes from "prop-types";
import { Server, Plus } from "lucide-react";
import PortainerInstanceCard from "../../../components/PortainerInstanceCard";
import styles from "./PortainerInstancesGrid.module.css";

/**
 * Grid display of Portainer instances
 */
const PortainerInstancesGrid = ({
  portainerStats,
  shouldShowEmptyState,
  onInstanceClick,
  onStatClick,
  onAddInstance,
}) => {
  return (
    <div className={styles.instancesSection}>
      <div className={styles.sectionHeader}>
        <div className={styles.headerContent}>
          <Server size={20} className={styles.headerIcon} />
          <h3 className={styles.sectionTitle}>Portainer Instances</h3>
        </div>
      </div>

      {shouldShowEmptyState || portainerStats.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyContent}>
            <Server size={48} className={styles.emptyIcon} />
            <h4 className={styles.emptyTitle}>No Portainer Instances</h4>
            <p className={styles.emptyText}>
              Get started by adding your first Portainer instance to monitor your containers.
            </p>
            <button className={styles.emptyButton} onClick={onAddInstance}>
              <Plus size={18} />
              Add Portainer Instance
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.instancesGrid}>
          {portainerStats.map((stat) => (
            <PortainerInstanceCard
              key={stat.name}
              instance={stat}
              onInstanceClick={onInstanceClick}
              onStatClick={onStatClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

PortainerInstancesGrid.propTypes = {
  portainerStats: PropTypes.array,
  shouldShowEmptyState: PropTypes.bool,
  onInstanceClick: PropTypes.func,
  onStatClick: PropTypes.func,
  onAddInstance: PropTypes.func,
};

PortainerInstancesGrid.defaultProps = {
  portainerStats: [],
  shouldShowEmptyState: false,
};

export default PortainerInstancesGrid;

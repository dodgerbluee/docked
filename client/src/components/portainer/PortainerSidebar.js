import React from "react";
import PropTypes from "prop-types";
import { Plus } from "lucide-react";
import { PORTAINER_CONTENT_TABS, PORTAINER_CONTENT_TAB_LABELS } from "../../constants/portainerPage";
import styles from "./PortainerSidebar.module.css";

/**
 * PortainerSidebar Component
 * Renders the sidebar with content tabs and instance filters
 */
const PortainerSidebar = React.memo(function PortainerSidebar({
  portainerInstances,
  contentTab,
  onContentTabChange,
  selectedPortainerInstances,
  onSelectedPortainerInstancesChange,
  onAddInstance,
}) {
  const handleInstanceToggle = (instanceName, checked) => {
    onSelectedPortainerInstancesChange((prev) => {
      const next = new Set(prev);
      
      if (checked) {
        next.add(instanceName);
        
        // Check if all instances are now selected
        const allInstances = portainerInstances.filter((inst) => inst != null && inst.name);
        const allSelected = allInstances.length > 0 &&
          allInstances.every((inst) => next.has(inst.name));
        
        // If all are selected, clear all to show all
        if (allSelected) {
          return new Set();
        }
        
        return next;
      } else {
        next.delete(instanceName);
        return next;
      }
    });
  };

  return (
    <div className={styles.sidebar}>
      {/* Views Toolbar */}
      <div className={styles.viewsToolbar}>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === PORTAINER_CONTENT_TABS.UPDATES ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(PORTAINER_CONTENT_TABS.UPDATES)}
        >
          <span className={styles.sidebarItemName}>
            {PORTAINER_CONTENT_TAB_LABELS[PORTAINER_CONTENT_TABS.UPDATES]}
          </span>
        </button>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === PORTAINER_CONTENT_TABS.CURRENT ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(PORTAINER_CONTENT_TABS.CURRENT)}
        >
          <span className={styles.sidebarItemName}>
            {PORTAINER_CONTENT_TAB_LABELS[PORTAINER_CONTENT_TABS.CURRENT]}
          </span>
        </button>
        <button
          className={`${styles.sidebarItem} ${
            contentTab === PORTAINER_CONTENT_TABS.UNUSED ? styles.active : ""
          }`}
          onClick={() => onContentTabChange(PORTAINER_CONTENT_TABS.UNUSED)}
        >
          <span className={styles.sidebarItemName}>
            {PORTAINER_CONTENT_TAB_LABELS[PORTAINER_CONTENT_TABS.UNUSED]}
          </span>
        </button>
      </div>

      {/* Instance Filter */}
      <div className={styles.sidebarHeader}>
        <h3>Filter by Instance</h3>
      </div>
      <div className={styles.filterContainer}>
        <div className={styles.filterBox}>
          {portainerInstances
            .filter((inst) => inst != null && inst.name)
            .map((instance) => (
              <div
                key={instance.name}
                className={styles.filterLabel}
              >
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={selectedPortainerInstances.has(instance.name)}
                    onChange={(e) => handleInstanceToggle(instance.name, e.target.checked)}
                    aria-label={`Filter by ${instance.name}`}
                  />
                </label>
                <span 
                  className={styles.filterText}
                  onClick={() => handleInstanceToggle(instance.name, !selectedPortainerInstances.has(instance.name))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleInstanceToggle(instance.name, !selectedPortainerInstances.has(instance.name));
                    }
                  }}
                >
                  {instance.name}
                </span>
              </div>
            ))}
        </div>
        <button
          className={`${styles.sidebarItem} ${styles.addButton}`}
          onClick={onAddInstance}
          title="Add Portainer Instance"
          aria-label="Add Portainer Instance"
        >
          <Plus size={16} aria-hidden="true" />
          <span>Add Instance</span>
        </button>
      </div>
    </div>
  );
});

PortainerSidebar.propTypes = {
  portainerInstances: PropTypes.arrayOf(PropTypes.object).isRequired,
  contentTab: PropTypes.string.isRequired,
  onContentTabChange: PropTypes.func.isRequired,
  selectedPortainerInstances: PropTypes.instanceOf(Set).isRequired,
  onSelectedPortainerInstancesChange: PropTypes.func.isRequired,
  onAddInstance: PropTypes.func.isRequired,
};

PortainerSidebar.displayName = "PortainerSidebar";

export default PortainerSidebar;


/**
 * Container data list component
 */

import React from "react";
import PropTypes from "prop-types";
import ContainerDataEntry from "./ContainerDataEntry";
import styles from "../../DataTab.module.css";

/**
 * Container data list component
 * @param {Object} props
 * @param {Array} props.dataEntries - Array of data entries
 * @param {Set} props.expandedContainers - Set of expanded container keys
 * @param {Function} props.onToggleExpansion - Handler for toggling expansion
 */
const ContainerDataList = ({ dataEntries, expandedContainers, onToggleExpansion }) => {
  if (dataEntries.length === 0) {
    return <div className={styles.empty}>No data entries found</div>;
  }

  return (
    <div className={styles.dataWrapper}>
      {dataEntries.map((entry) => (
        <ContainerDataEntry
          key={entry.key}
          entry={entry}
          expandedContainers={expandedContainers}
          onToggleExpansion={onToggleExpansion}
        />
      ))}
    </div>
  );
};

ContainerDataList.propTypes = {
  dataEntries: PropTypes.array.isRequired,
  expandedContainers: PropTypes.instanceOf(Set).isRequired,
  onToggleExpansion: PropTypes.func.isRequired,
};

export default ContainerDataList;

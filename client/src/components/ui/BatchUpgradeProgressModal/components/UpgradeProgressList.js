/**
 * Upgrade progress list component
 */

import React from "react";
import PropTypes from "prop-types";
import UpgradeProgressItem from "./UpgradeProgressItem";
import styles from "../../BatchUpgradeProgressModal.module.css";

/**
 * Upgrade progress list component
 * @param {Object} props
 * @param {Array} props.containers - Containers array
 * @param {Object} props.containerStates - Container states object
 * @param {Array} props.steps - Steps array
 */
const UpgradeProgressList = ({ containers, containerStates, steps }) => {
  return (
    <div className={styles.containersList}>
      {containers.map((container) => {
        const containerState = containerStates[container.id] || {
          status: "pending",
          currentStep: 0,
        };

        return (
          <UpgradeProgressItem
            key={container.id}
            container={container}
            containerState={containerState}
            steps={steps}
          />
        );
      })}
    </div>
  );
};

UpgradeProgressList.propTypes = {
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  containerStates: PropTypes.object.isRequired,
  steps: PropTypes.array.isRequired,
};

export default UpgradeProgressList;

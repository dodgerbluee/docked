/**
 * Reusable JSON viewer component
 */

import React from "react";
import PropTypes from "prop-types";
import styles from "../../DataTab.module.css";

/**
 * JSON viewer component for displaying structured data
 * @param {Object} props
 * @param {Object} props.data - Data object to display as JSON
 * @param {string} props.className - Optional CSS class name
 */
const JSONViewer = ({ data, className = "" }) => {
  return (
    <div className={`${styles.containerData} ${className}`}>
      <pre className={styles.dataContent}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

JSONViewer.propTypes = {
  data: PropTypes.oneOfType([PropTypes.object, PropTypes.array]).isRequired,
  className: PropTypes.string,
};

export default JSONViewer;


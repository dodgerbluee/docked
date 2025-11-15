import React from "react";
import PropTypes from "prop-types";
import styles from "./Alert.module.css";

/**
 * Alert Component
 * Reusable alert/notification component
 */
const Alert = React.memo(function Alert({ children, variant = "info", className = "", ...props }) {
  const variantClass = styles[variant] || styles.info;

  return (
    <div className={`${styles.alert} ${variantClass} ${className}`} {...props}>
      {children}
    </div>
  );
});

Alert.propTypes = {
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(["success", "error", "warning", "info"]),
  className: PropTypes.string,
};

export default Alert;

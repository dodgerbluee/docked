import React from "react";
import PropTypes from "prop-types";
import { AlertCircle } from "lucide-react";
import "./ErrorDisplay.css";

/**
 * ErrorDisplay component
 * Displays error messages in a consistent format
 */
const ErrorDisplay = ({ error, title = "Error" }) => {
  const errorMessage = error?.message || error?.toString() || "An unknown error occurred";

  return (
    <div className="error-display">
      <div className="error-icon">
        <AlertCircle size={24} />
      </div>
      <div className="error-content">
        <h3>{title}</h3>
        <p>{errorMessage}</p>
      </div>
    </div>
  );
};

ErrorDisplay.propTypes = {
  error: PropTypes.oneOfType([PropTypes.string, PropTypes.object, PropTypes.instanceOf(Error)]),
  title: PropTypes.string,
};

export default ErrorDisplay;

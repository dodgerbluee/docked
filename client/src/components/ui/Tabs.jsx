import React from "react";
import PropTypes from "prop-types";
import TabNavigation from "./TabNavigation";

/**
 * Tabs Component
 * A simple tab navigation component
 */
const Tabs = ({ options, active, onChange }) => {
  const labels = options.reduce((acc, opt) => {
    acc[opt.value] = opt.label;
    return acc;
  }, {});

  return (
    <TabNavigation
      tabs={options.map((opt) => opt.value)}
      activeTab={active}
      onTabChange={onChange}
      labels={labels}
    />
  );
};

Tabs.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      icon: PropTypes.elementType,
    })
  ).isRequired,
  active: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default Tabs;

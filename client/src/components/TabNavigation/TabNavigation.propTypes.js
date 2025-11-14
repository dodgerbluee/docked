import PropTypes from "prop-types";

export const TabNavigationPropTypes = {
  activeTab: PropTypes.oneOf(["summary", "portainer", "tracked-apps"]).isRequired,
  onTabChange: PropTypes.func.isRequired,
  containersWithUpdates: PropTypes.arrayOf(PropTypes.object),
  trackedAppsBehind: PropTypes.number,
};


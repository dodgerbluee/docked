import PropTypes from "prop-types";

export const HeaderPropTypes = {
  username: PropTypes.string,
  userRole: PropTypes.string,
  avatar: PropTypes.string.isRequired,
  darkMode: PropTypes.bool.isRequired,
  notificationCount: PropTypes.number.isRequired,
  activeContainersWithUpdates: PropTypes.arrayOf(PropTypes.object),
  activeTrackedAppsBehind: PropTypes.arrayOf(PropTypes.object),
  showNotificationMenu: PropTypes.bool.isRequired,
  showAvatarMenu: PropTypes.bool.isRequired,
  onToggleNotificationMenu: PropTypes.func.isRequired,
  onToggleAvatarMenu: PropTypes.func.isRequired,
  onNavigateToSummary: PropTypes.func.isRequired,
  onNavigateToSettings: PropTypes.func.isRequired,
  onNavigateToBatch: PropTypes.func.isRequired,
  onNavigateToPortainer: PropTypes.func.isRequired,
  onNavigateToTrackedApps: PropTypes.func.isRequired,
  onDismissContainerNotification: PropTypes.func.isRequired,
  onDismissTrackedAppNotification: PropTypes.func.isRequired,
  onTemporaryThemeToggle: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  API_BASE_URL: PropTypes.string.isRequired,
};


import PropTypes from "prop-types";

export const RateLimitErrorPropTypes = {
  error: PropTypes.string,
  dockerHubCredentials: PropTypes.object,
  onDismiss: PropTypes.func.isRequired,
  onNavigateToDockerHubSettings: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
  pulling: PropTypes.bool,
  loading: PropTypes.bool,
};


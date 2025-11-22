import PropTypes from "prop-types";

/**
 * Shared PropTypes definitions for consistent type checking across components
 */

// Container shape
export const containerShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  image: PropTypes.string,
  hasUpdate: PropTypes.bool,
  currentVersion: PropTypes.string,
  latestVersion: PropTypes.string,
  currentTag: PropTypes.string,
  latestTag: PropTypes.string,
  currentDigest: PropTypes.string,
  latestDigest: PropTypes.string,
  currentVersionPublishDate: PropTypes.string,
  latestPublishDate: PropTypes.string,
  existsInDockerHub: PropTypes.bool,
});

// Portainer instance shape
export const portainerInstanceShape = PropTypes.shape({
  name: PropTypes.string.isRequired,
  url: PropTypes.string,
  containers: PropTypes.arrayOf(containerShape),
  withUpdates: PropTypes.arrayOf(containerShape),
  upToDate: PropTypes.arrayOf(containerShape),
});

// Portainer instance stat shape (for summary)
export const portainerInstanceStatShape = PropTypes.shape({
  name: PropTypes.string.isRequired,
  url: PropTypes.string,
  total: PropTypes.number.isRequired,
  withUpdates: PropTypes.number.isRequired,
  upToDate: PropTypes.number.isRequired,
  unusedImages: PropTypes.number.isRequired,
});

// Unused image shape
export const unusedImageShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  portainerUrl: PropTypes.string,
  size: PropTypes.number,
});

// Tracked app shape
export const trackedAppShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  currentVersion: PropTypes.string,
  latestVersion: PropTypes.string,
  hasUpdate: PropTypes.bool,
  repository: PropTypes.string,
  owner: PropTypes.string,
});

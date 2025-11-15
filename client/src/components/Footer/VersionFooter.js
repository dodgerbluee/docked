import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Github } from "lucide-react";
import { GITHUB_REPO } from "../../constants/api";
import "./VersionFooter.css";

/**
 * Version Footer Component
 * Displays GitHub link and version info at the bottom right of the page
 *
 * @param {Object} props - Component props
 * @param {string|null} props.version - Application version string (e.g., "1.2.5" or "1.2.5-dev")
 * @param {boolean} props.isDevBuild - Whether this is a local development build
 * @returns {JSX.Element} Footer component with GitHub link and version
 */
const VersionFooter = ({ version, isDevBuild }) => {
  /**
   * Generates the GitHub release tag URL for the current version
   * @returns {string|null} Release tag URL or null if version is unavailable
   */
  const releaseUrl = useMemo(() => {
    if (!version) return null;

    // Construct release tag URL
    // For versions with -dev suffix, link to the dev release tag
    // For production versions, link to the production release tag
    return `${GITHUB_REPO}/releases/tag/v${version}`;
  }, [version]);

  /**
   * Formats the version string for display
   * Shows as "vX.X.X" format, or "vX.X.X-local" for local development builds
   */
  const displayVersion = useMemo(() => {
    if (!version) return null;
    // Append -local suffix for local development builds
    return isDevBuild ? `v${version}-local` : `v${version}`;
  }, [version, isDevBuild]);

  return (
    <footer className="version-footer" role="contentinfo">
      <a
        href={GITHUB_REPO}
        target="_blank"
        rel="noopener noreferrer"
        className="version-footer-link"
        aria-label="View repository on GitHub"
      >
        <Github size={14} aria-hidden="true" />
        <span>GitHub</span>
      </a>
      {displayVersion && releaseUrl && !isDevBuild ? (
        <>
          <span className="version-footer-separator" aria-hidden="true">
            |
          </span>
          <a
            href={releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="version-footer-link"
            aria-label={`View release ${displayVersion} on GitHub`}
          >
            <span>Docked</span>
            <span className="version-footer-version"> {displayVersion}</span>
          </a>
        </>
      ) : displayVersion ? (
        <>
          <span className="version-footer-separator" aria-hidden="true">
            |
          </span>
          <span
            className="version-footer-link version-footer-text"
            aria-label={`Docked ${displayVersion}`}
          >
            <span>Docked</span>
            <span className="version-footer-version"> {displayVersion}</span>
          </span>
        </>
      ) : null}
    </footer>
  );
};

VersionFooter.propTypes = {
  /** Application version string (e.g., "1.2.5" or "1.2.5-dev"), null for local dev */
  version: PropTypes.string,
  /** Whether this is a local development build (currently unused but kept for future use) */
  isDevBuild: PropTypes.bool,
};

VersionFooter.defaultProps = {
  version: null,
  isDevBuild: false,
};

export default React.memo(VersionFooter);

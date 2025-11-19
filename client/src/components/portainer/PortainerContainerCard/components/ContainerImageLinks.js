/**
 * Container image links component (Docker Hub / GitHub Container Registry)
 */

import React from "react";
import PropTypes from "prop-types";
import GitHubIcon from "../../../icons/GitHubIcon";
import styles from "../../PortainerContainerCard.module.css";

/**
 * Container image links component
 * @param {Object} props
 * @param {boolean} props.isDocker - Whether image is from Docker Hub
 * @param {boolean} props.isGitHub - Whether image is from GitHub Container Registry
 * @param {string} props.dockerHubUrl - Docker Hub URL
 * @param {string} props.githubUrl - GitHub Container Registry URL
 * @param {string} props.imageName - Image name
 */
const ContainerImageLinks = ({ isDocker, isGitHub, dockerHubUrl, githubUrl, imageName }) => {
  if (!imageName || (!isDocker && !isGitHub)) {
    return null;
  }

  return (
    <>
      {isDocker ? (
        <a
          href={dockerHubUrl || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.dockerIconLink}
          title="Open Docker Hub repository"
          aria-label="Open Docker Hub repository"
          onClick={(e) => {
            e.stopPropagation();
            if (!dockerHubUrl) {
              e.preventDefault();
            }
          }}
        >
          <img
            src="/img/docker-mark-white.svg"
            alt="Docker"
            className={styles.dockerIconSmall}
          />
        </a>
      ) : isGitHub ? (
        <a
          href={githubUrl || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.githubIconLink}
          title="Open GitHub Container Registry"
          aria-label="Open GitHub Container Registry"
          onClick={(e) => {
            e.stopPropagation();
            if (!githubUrl) {
              e.preventDefault();
            }
          }}
        >
          <GitHubIcon size={18} />
        </a>
      ) : null}
    </>
  );
};

ContainerImageLinks.propTypes = {
  isDocker: PropTypes.bool.isRequired,
  isGitHub: PropTypes.bool.isRequired,
  dockerHubUrl: PropTypes.string,
  githubUrl: PropTypes.string,
  imageName: PropTypes.string,
};

export default ContainerImageLinks;


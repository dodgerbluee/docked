/**
 * Welcome Modal Component
 * Displays a welcome message for first-time users with no Portainer instances
 */

import React from "react";
import PropTypes from "prop-types";
import { Server, BookOpen, Github, MonitorSmartphone } from "lucide-react";
import Modal from "../../../components/ui/Modal";
import Button from "../../../components/ui/Button";
import { GITHUB_REPO } from "../../../constants/api";
import styles from "./WelcomeModal.module.css";

/**
 * Streamers component for celebration effect
 */
const Streamers = () => {
  const streamers = Array.from({ length: 20 }, (_, i) => i);
  const colors = [
    "#1e88e5", // dodger-blue-light
    "#005a9c", // dodger-blue
    "#ef3e42", // dodger-red
    "#22c55e", // success-green
    "#8b5cf6", // tracked-apps-purple
  ];

  return (
    <div className={styles.streamersContainer}>
      {streamers.map((index) => {
        const color = colors[index % colors.length];
        const left = `${(index * 5) % 100}%`;
        const delay = (index * 0.1) % 2;
        const duration = 2 + (index % 3);

        return (
          <div
            key={index}
            className={styles.streamer}
            style={{
              left,
              backgroundColor: color,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
          />
        );
      })}
    </div>
  );
};

/**
 * Welcome Modal Component
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {Function} props.onClose - Close handler
 * @param {Function} props.onAddInstance - Handler to open Add Portainer Instance modal
 * @param {Function} props.onAddTrackedApp - Handler to navigate to Tracked Apps page
 */
const WelcomeModal = ({
  isOpen,
  onClose,
  onAddInstance,
  onAddTrackedApp,
  onNavigateToPortainer,
}) => {
  const handleGetStarted = () => {
    onClose();
    sessionStorage.setItem("welcomeModalShown", "true");
    // Set flag to open Portainer modal after navigation
    sessionStorage.setItem("openPortainerModal", "true");
    // Navigate to Portainer page first
    if (onNavigateToPortainer) {
      onNavigateToPortainer();
    } else if (onAddInstance) {
      // Fallback if navigation not available
      onAddInstance();
    }
  };

  const handleAddTrackedApp = () => {
    onClose();
    sessionStorage.setItem("welcomeModalShown", "true");
    // Set flag to open Tracked Apps modal after navigation
    sessionStorage.setItem("openTrackedAppModal", "true");
    // Navigate to Tracked Apps page first
    if (onAddTrackedApp) {
      onAddTrackedApp();
    }
  };

  return (
    <>
      {isOpen && <Streamers />}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" className={styles.welcomeModal}>
        <div className={styles.welcomeContent}>
          <div className={styles.logoSection}>
            <img src="/img/logo.png" alt="Docked Logo" className={styles.logo} />
          </div>

          <div className={styles.headerSection}>
            <div className={styles.titleWrapper}>
              <span className={styles.titleText}>Welcome to </span>
              <img src="/img/text-header.png" alt="docked" className={styles.titleImage} />
            </div>
            <p className={styles.subtitle}>
              Get started by adding your first Portainer instance or tracked app to begin managing
              your containers.
            </p>
          </div>

          <div className={styles.featuresSection}>
            <div className={styles.featureItem}>
              <div className={styles.featureIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0"
                  className={styles.icon}
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M12.504 0v1.023l-.01-.015l-6.106 3.526H3.417v.751h5.359v3.638h1.942V5.284h1.786V15.7c.027 0 .54-.01.751.091V5.285h.531v10.608c.293.147.55.312.751.54V5.286h6.046v-.75h-1.267l-6.061-3.5V0zm0 1.87v2.664H7.889zm.751.031l4.56 2.633h-4.56zM9.142 5.285h1.21v1.686h-1.21zm-4.736 2.73v1.951h1.942v-1.95zm2.19 0v1.951h1.941v-1.95zm-2.19 2.171v1.951h1.942v-1.95zm2.19 0v1.951h1.941v-1.95zm2.18 0v1.951h1.942v-1.95zM4.36 12.43a3.73 3.73 0 0 0-.494 1.851c0 1.227.604 2.308 1.52 2.986c.239-.064.477-.1.724-.11c.1 0 .165.01.266.019c.284-1.191 1.383-1.988 2.665-1.988c.724 0 1.438.201 1.924.668c.229-.476.302-1.007.302-1.575c0-.65-.165-1.292-.494-1.85zm4.828 3.16c-1.21 0-2.226.844-2.492 1.97a1 1 0 0 0-.275-.009a2.56 2.56 0 0 0-2.564 2.556a2.565 2.565 0 0 0 3.096 2.5A2.58 2.58 0 0 0 9.233 24c.862 0 1.622-.43 2.09-1.081a2.557 2.557 0 0 0 4.186-1.97c0-.567-.193-1.099-.504-1.52a2.557 2.557 0 0 0-3.866-2.94a2.57 2.57 0 0 0-1.951-.898z"
                  />
                </svg>
              </div>
              <div className={styles.featureContent}>
                <h3 className={styles.featureTitle}>Connect Portainer Instances</h3>
                <p className={styles.featureDescription}>
                  Add your Portainer instances to monitor and manage all your containers from one
                  place.
                </p>
              </div>
            </div>

            <div className={styles.featureItem}>
              <div className={styles.featureIcon}>
                <Server className={styles.icon} size={24} />
              </div>
              <div className={styles.featureContent}>
                <h3 className={styles.featureTitle}>Track Container Updates</h3>
                <p className={styles.featureDescription}>
                  Automatically detect when your containers have updates available and upgrade them
                  with ease.
                </p>
              </div>
            </div>

            <div className={styles.featureItem}>
              <div className={styles.featureIcon}>
                <MonitorSmartphone className={styles.icon} size={24} />
              </div>
              <div className={styles.featureContent}>
                <h3 className={styles.featureTitle}>Track App Updates</h3>
                <p className={styles.featureDescription}>
                  Monitor GitHub and GitLab repositories to track version updates and stay informed
                  when new releases are available.
                </p>
              </div>
            </div>

            <div className={styles.featureItem}>
              <div className={styles.featureIcon}>
                <BookOpen className={styles.icon} size={24} />
              </div>
              <div className={styles.featureContent}>
                <h3 className={styles.featureTitle}>Documentation</h3>
                <p className={styles.featureDescription}>
                  Learn more about Docked's features and how to get the most out of your container
                  management.{" "}
                  <a
                    href={`${GITHUB_REPO}/blob/main/README.md`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.docsLink}
                  >
                    Read the documentation
                  </a>
                  .
                </p>
              </div>
            </div>
          </div>

          <div className={styles.actionsSection}>
            <div className={styles.primaryActions}>
              <Button
                variant="outline"
                size="lg"
                onClick={handleGetStarted}
                className={styles.getStartedButton}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0"
                  style={{ marginRight: "8px", display: "inline-block", verticalAlign: "middle" }}
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M12.504 0v1.023l-.01-.015l-6.106 3.526H3.417v.751h5.359v3.638h1.942V5.284h1.786V15.7c.027 0 .54-.01.751.091V5.285h.531v10.608c.293.147.55.312.751.54V5.286h6.046v-.75h-1.267l-6.061-3.5V0zm0 1.87v2.664H7.889zm.751.031l4.56 2.633h-4.56zM9.142 5.285h1.21v1.686h-1.21zm-4.736 2.73v1.951h1.942v-1.95zm2.19 0v1.951h1.941v-1.95zm-2.19 2.171v1.951h1.942v-1.95zm2.19 0v1.951h1.941v-1.95zm2.18 0v1.951h1.942v-1.95zM4.36 12.43a3.73 3.73 0 0 0-.494 1.851c0 1.227.604 2.308 1.52 2.986c.239-.064.477-.1.724-.11c.1 0 .165.01.266.019c.284-1.191 1.383-1.988 2.665-1.988c.724 0 1.438.201 1.924.668c.229-.476.302-1.007.302-1.575c0-.65-.165-1.292-.494-1.85zm4.828 3.16c-1.21 0-2.226.844-2.492 1.97a1 1 0 0 0-.275-.009a2.56 2.56 0 0 0-2.564 2.556a2.565 2.565 0 0 0 3.096 2.5A2.58 2.58 0 0 0 9.233 24c.862 0 1.622-.43 2.09-1.081a2.557 2.557 0 0 0 4.186-1.97c0-.567-.193-1.099-.504-1.52a2.557 2.557 0 0 0-3.866-2.94a2.57 2.57 0 0 0-1.951-.898z"
                  />
                </svg>
                Add Portainer Instance
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={handleAddTrackedApp}
                className={styles.getStartedButton}
              >
                <MonitorSmartphone size={20} style={{ marginRight: "8px" }} />
                Add Tracked App
              </Button>
            </div>
            <Button variant="ghost" size="md" onClick={onClose} className={styles.skipButton}>
              I'll do this later
            </Button>
          </div>

          <div className={styles.footerSection}>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.githubLink}
              aria-label="View on GitHub"
            >
              <Github className={styles.githubIcon} size={20} />
              <span>View on GitHub</span>
            </a>
          </div>
        </div>
      </Modal>
    </>
  );
};

WelcomeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onAddInstance: PropTypes.func.isRequired,
  onAddTrackedApp: PropTypes.func,
  onNavigateToPortainer: PropTypes.func,
};

export default WelcomeModal;

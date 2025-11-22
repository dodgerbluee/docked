import React, { useState, useEffect } from "react";
import { ExternalLink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useVersion } from "../../hooks/useVersion";
import Card from "../ui/Card";
import Button from "../ui/Button";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import styles from "./AboutSection.module.css";

/**
 * AboutSection Component
 * Displays application version and update information
 */
const AboutSection = () => {
  const { version, isDevBuild, loading: versionLoading } = useVersion();
  const [updateInfo, setUpdateInfo] = useState({
    loading: false,
    hasUpdate: false,
    latestVersion: null,
    error: null,
  });
  // GitHub repository for checking updates (could be made configurable)
  const GITHUB_REPO = "dodgerbluee/docked"; // Update this to match your actual repo

  useEffect(() => {
    const checkForUpdates = async () => {
      if (!version) {
        return;
      }

      setUpdateInfo((prev) => ({ ...prev, loading: true, error: null }));

      try {
        // Use backend endpoint to check for updates (allows logging and better error handling)
        const response = await axios.get(`${API_BASE_URL}/api/version/latest-release`, {
          timeout: 10000,
        });

        if (!response.data || !response.data.success) {
          throw new Error(response.data?.error || "Failed to fetch latest release");
        }

        const latestVersion = response.data?.latestVersion?.tag_name || response.data?.tag_name;
        if (latestVersion) {
          // Normalize versions for comparison (remove "v" prefix and "-dev" suffix)
          // This allows comparing "2.0.0-dev" with "2.0.0" correctly
          const normalizeVersion = (v) => {
            if (!v) return "";
            return String(v)
              .replace(/^v/i, "")
              .replace(/-dev.*$/i, "") // Remove "-dev" and anything after it
              .trim()
              .toLowerCase();
          };

          // Compare versions using semantic version comparison
          const compareVersions = (v1, v2) => {
            const n1 = normalizeVersion(v1);
            const n2 = normalizeVersion(v2);

            // Try semantic version comparison if both look like versions
            if (n1.match(/^\d+\.\d+/) && n2.match(/^\d+\.\d+/)) {
              const parts1 = n1.split(".").map((p) => parseInt(p, 10) || 0);
              const parts2 = n2.split(".").map((p) => parseInt(p, 10) || 0);

              for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                const p1 = parts1[i] || 0;
                const p2 = parts2[i] || 0;
                if (p1 < p2) return -1;
                if (p1 > p2) return 1;
              }
              return 0;
            }

            // Fallback to string comparison
            return n1.localeCompare(n2);
          };

          // Check if update is available (current < latest)
          // Normalize both versions to strip "-dev" before comparison
          const comparison = compareVersions(version, latestVersion);
          const hasUpdate = comparison < 0;

          setUpdateInfo({
            loading: false,
            hasUpdate,
            latestVersion,
            error: null,
          });

          // Store version update info in localStorage for notification system
          if (hasUpdate && latestVersion) {
            try {
              localStorage.setItem(
                "versionUpdateInfo",
                JSON.stringify({
                  hasUpdate: true,
                  latestVersion,
                  currentVersion: version,
                  checkedAt: new Date().toISOString(),
                })
              );
            } catch (err) {
              console.error("Error saving version update info:", err);
            }
          } else {
            // Clear if no update
            try {
              localStorage.removeItem("versionUpdateInfo");
            } catch (err) {
              // Ignore errors
            }
          }
        } else {
          setUpdateInfo({
            loading: false,
            hasUpdate: false,
            latestVersion: null,
            error: null,
          });
        }
      } catch (error) {
        console.debug("Error checking for updates:", error);
        setUpdateInfo({
          loading: false,
          hasUpdate: false,
          latestVersion: null,
          error: error.message || "Failed to check for updates",
        });
      }
    };

    checkForUpdates();
  }, [version, isDevBuild]);

  const getVersionDisplay = () => {
    if (versionLoading) {
      return "Loading...";
    }
    if (!version) {
      return "Unknown";
    }
    return version;
  };

  const getUpdateStatus = () => {
    if (versionLoading || updateInfo.loading) {
      return { icon: Loader2, text: "Checking for updates...", variant: "info" };
    }

    if (isDevBuild) {
      return { icon: null, text: "Development Build", variant: "info" };
    }

    // Show error if there's an error - don't show "Up to date" on error
    if (updateInfo.error) {
      return { icon: AlertCircle, text: "Unable to check for updates", variant: "warning" };
    }

    if (updateInfo.hasUpdate) {
      return {
        icon: AlertCircle,
        text: `Update available: ${updateInfo.latestVersion}`,
        variant: "update",
      };
    }

    // Only show "Up to date" if we successfully checked and there's no update
    if (updateInfo.latestVersion !== null) {
      return { icon: CheckCircle2, text: "Up to date", variant: "success" };
    }

    // If we haven't checked yet or don't have a result, show nothing or a neutral state
    return { icon: null, text: "Version check unavailable", variant: "info" };
  };

  const updateStatus = getUpdateStatus();
  const StatusIcon = updateStatus.icon;

  return (
    <div className={styles.aboutSection}>
      <h4 className={styles.sectionTitle}>About</h4>
      <Card variant="default" padding="md" className={styles.aboutCard}>
        <div className={styles.versionSection}>
          <div className={styles.versionRow}>
            <span className={styles.versionLabel}>Version</span>
            <span className={styles.versionValue}>{getVersionDisplay()}</span>
          </div>
          <div className={styles.updateStatusRow}>
            <div className={styles.updateStatus}>
              {StatusIcon && (
                <StatusIcon
                  size={16}
                  className={`${styles.statusIcon} ${styles[updateStatus.variant]}`}
                />
              )}
              <span className={`${styles.statusText} ${styles[updateStatus.variant]}`}>
                {updateStatus.text}
              </span>
            </div>
            {updateInfo.hasUpdate && updateInfo.latestVersion && (
              <Button
                variant="outline"
                size="sm"
                icon={ExternalLink}
                onClick={() => {
                  window.open(
                    `https://github.com/${GITHUB_REPO}/releases/tag/${updateInfo.latestVersion}`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }}
                className={styles.updateButton}
              >
                View Release
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

AboutSection.propTypes = {};

export default AboutSection;

import React, { useState, useRef } from "react";
import PropTypes from "prop-types";
import { Download, Upload } from "lucide-react";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ImportCredentialsModal from "./ImportCredentialsModal";
import styles from "./UserDetailsTab.module.css";
import generalStyles from "./GeneralTab.module.css";

/**
 * UserDetailsTab Component
 * Displays user information
 */
const UserDetailsTab = React.memo(function UserDetailsTab({ userInfo }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [importConfigData, setImportConfigData] = useState(null);
  const fileInputRef = useRef(null);

  const handleExport = async () => {
    setExporting(true);
    setExportError("");
    setExportSuccess("");

    try {
      const response = await axios.get(`${API_BASE_URL}/api/user/export-config`);

      if (response.data.success) {
        // Create a blob from the JSON data
        const jsonString = JSON.stringify(response.data.data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        // Create a temporary anchor element and trigger download
        const link = document.createElement("a");
        link.href = url;
        link.download = `docked-config-export-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(link);
        link.click();

        // Cleanup
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setExportSuccess("Configuration exported successfully!");
        setTimeout(() => setExportSuccess(""), 3000);
      } else {
        setExportError(response.data.error || "Failed to export configuration");
      }
    } catch (err) {
      console.error("Error exporting configuration:", err);
      setExportError(
        err.response?.data?.error || "Failed to export configuration. Please try again."
      );
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const configData = JSON.parse(e.target.result);
        // Validate basic structure
        if (!configData || typeof configData !== "object") {
          setImportError("Invalid configuration file format");
          return;
        }

        // Check if user already exists
        if (configData.user?.username) {
          // This check will be done on the backend, but we can show a warning
        }

        setImportConfigData(configData);
        setShowCredentialsModal(true);
        setImportError("");
      } catch (err) {
        console.error("Error parsing JSON file:", err);
        setImportError("Failed to parse configuration file. Please ensure it's valid JSON.");
      }
    };
    reader.onerror = () => {
      setImportError("Failed to read file");
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleImport = async (credentials, skippedSteps = new Set()) => {
    setImporting(true);
    setImportError("");
    setImportSuccess("");
    setShowCredentialsModal(false);

    try {
      // Filter out skipped configurations from credentials
      const filteredCredentials = { ...credentials };

      if (skippedSteps.has("portainer")) {
        delete filteredCredentials.portainerInstances;
      }
      if (skippedSteps.has("dockerhub")) {
        delete filteredCredentials.dockerHub;
      }
      if (skippedSteps.has("discord")) {
        delete filteredCredentials.discordWebhooks;
      }

      const response = await axios.post(`${API_BASE_URL}/api/user/import-config`, {
        configData: importConfigData,
        credentials: filteredCredentials,
        skippedSteps: Array.from(skippedSteps),
      });

      if (response.data.success) {
        const { results } = response.data;
        const successMessages = [];
        const skippedArray = Array.from(skippedSteps);

        if (results.portainerInstances.length > 0) {
          successMessages.push(
            `${results.portainerInstances.length} Portainer instance(s) imported`
          );
        } else if (skippedArray.includes("portainer")) {
          successMessages.push("Portainer instances skipped");
        }

        if (results.dockerHubCredentials) {
          successMessages.push("Docker Hub credentials imported");
        } else if (skippedArray.includes("dockerhub")) {
          successMessages.push("Docker Hub credentials skipped");
        }

        if (results.discordWebhooks.length > 0) {
          successMessages.push(`${results.discordWebhooks.length} Discord webhook(s) imported`);
        } else if (skippedArray.includes("discord")) {
          successMessages.push("Discord webhooks skipped");
        }

        if (results.trackedImages.length > 0) {
          successMessages.push(`${results.trackedImages.length} tracked image(s) imported`);
        }
        if (results.generalSettings) {
          successMessages.push("General settings imported");
        }

        let message = successMessages.join(", ");
        if (results.errors.length > 0) {
          message += `. ${results.errors.length} error(s) occurred: ${results.errors.join("; ")}`;
        }

        setImportSuccess(message);
        setImportConfigData(null);

        // Refresh the page after a short delay to show updated data
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        setImportError(response.data.error || "Failed to import configuration");
      }
    } catch (err) {
      console.error("Error importing configuration:", err);
      setImportError(
        err.response?.data?.error || "Failed to import configuration. Please try again."
      );
    } finally {
      setImporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>User Information</h3>
      {userInfo ? (
        <>
          <Card variant="default" padding="lg" className={styles.userInfoCard}>
            <div className={styles.infoItem}>
              <strong className={styles.label}>Username:</strong>
              <span className={styles.value}>{userInfo.username}</span>
            </div>
            <div className={styles.infoItem}>
              <strong className={styles.label}>Role:</strong>
              <span className={styles.value}>{userInfo.role}</span>
            </div>
            {userInfo.created_at && (
              <div className={styles.infoItem}>
                <strong className={styles.label}>Account Created:</strong>
                <span className={styles.value}>
                  {new Date(userInfo.created_at).toLocaleDateString()}
                </span>
              </div>
            )}
          </Card>

          <div className={`${generalStyles.dataManagement} ${styles.exportContainer}`}>
            <h4 className={generalStyles.sectionTitle}>Configuration Management</h4>
            {exportSuccess && <Alert variant="info">{exportSuccess}</Alert>}
            {exportError && <Alert variant="error">{exportError}</Alert>}
            {importSuccess && <Alert variant="info">{importSuccess}</Alert>}
            {importError && <Alert variant="error">{importError}</Alert>}
            <div className={generalStyles.dataActions}>
              <div className={generalStyles.dataActionItem}>
                <div className={styles.exportButtonContainer}>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleExport}
                    disabled={exporting || importing}
                    icon={Download}
                    className={generalStyles.saveButton}
                  >
                    {exporting ? "Exporting..." : "Export Configuration"}
                  </Button>
                </div>
                <small className={`${generalStyles.dataActionHelper} ${styles.exportHelperText}`}>
                  Export all your database configurations including Portainer instances, Docker Hub
                  credentials, Discord webhooks, tracked images, and general settings in JSON
                  format.
                </small>
              </div>
              <div className={generalStyles.dataActionItem}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                <div className={styles.exportButtonContainer}>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleImportClick}
                    disabled={importing || exporting}
                    icon={Upload}
                    className={generalStyles.saveButton}
                  >
                    {importing ? "Importing..." : "Import Configuration"}
                  </Button>
                </div>
                <small className={`${generalStyles.dataActionHelper} ${styles.exportHelperText}`}>
                  Import a previously exported configuration file. You will be prompted to enter
                  credentials for Portainer instances, Docker Hub, and Discord webhooks as they were
                  not included in the export for security reasons.
                </small>
              </div>
            </div>
          </div>

          <ImportCredentialsModal
            isOpen={showCredentialsModal}
            onClose={() => {
              setShowCredentialsModal(false);
              setImportConfigData(null);
            }}
            onConfirm={handleImport}
            configData={importConfigData || {}}
            loading={importing}
          />
        </>
      ) : (
        <Card variant="secondary" padding="lg">
          <p className={styles.loadingText}>Loading user information...</p>
        </Card>
      )}
    </div>
  );
});

UserDetailsTab.propTypes = {
  userInfo: PropTypes.object,
};

export default UserDetailsTab;

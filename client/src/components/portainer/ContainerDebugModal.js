/**
 * Container Debug Modal
 * Shows all database records related to a container for debugging
 * Uses React Portal for proper rendering outside component hierarchy
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import axios from "axios";
import { Database, Package, History, AlertCircle, RefreshCw, X, ChevronDown, ChevronRight } from "lucide-react";
import LoadingSpinner from "../ui/LoadingSpinner";
import { API_BASE_URL } from "../../constants/api";
import styles from "./ContainerDebugModal.module.css";

function ContainerDebugModal({ containerId, containerName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    container: true,
    deployedImage: true,
    allDeployedImages: true,
    registryImageVersion: true,
    allRegistryImageVersions: true,
    upgradeHistory: true,
    allContainersWithSameName: true,
  });

  // Refs for cleanup and focus management
  const abortControllerRef = useRef(null);
  const modalRef = useRef(null);
  const isRefreshing = useRef(false);

  const fetchDebugInfo = useCallback(async () => {
    // Prevent concurrent requests
    if (isRefreshing.current) {
      return;
    }

    // Validate containerId
    if (!containerId || typeof containerId !== 'string' || containerId.trim() === '') {
      setError('Invalid container ID provided');
      setLoading(false);
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    isRefreshing.current = true;

    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(
        `${API_BASE_URL}/api/containers/${containerId}/debug`,
        { signal: abortControllerRef.current.signal }
      );
      setDebugInfo(response.data);
    } catch (err) {
      // Don't set error if request was cancelled
      if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') {
        setError(err.response?.data?.error || err.message || "Failed to fetch debug info");
      }
    } finally {
      setLoading(false);
      isRefreshing.current = false;
    }
  }, [containerId]);

  // Fetch data on mount
  useEffect(() => {
    fetchDebugInfo();

    // Cleanup: abort pending requests on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchDebugInfo]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    // Calculate scrollbar width
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, []);

  // Focus trap implementation
  useEffect(() => {
    if (!modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTab = (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    
    // Focus first element on mount
    setTimeout(() => firstElement?.focus(), 100);

    return () => document.removeEventListener('keydown', handleTab);
  }, [debugInfo, loading]); // Re-run when content changes

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString();
  };

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const renderJsonTable = (obj, title, sectionKey) => {
    if (!obj) return null;

    const isExpanded = expandedSections[sectionKey];

    return (
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection(sectionKey)}
          aria-expanded={isExpanded}
          aria-controls={`section-${sectionKey}`}
        >
          <h3 className={styles.sectionTitle}>
            {isExpanded ? (
              <ChevronDown size={20} className={styles.chevron} />
            ) : (
              <ChevronRight size={20} className={styles.chevron} />
            )}
            {title}
          </h3>
        </button>
        {isExpanded && (
          <div id={`section-${sectionKey}`} className={styles.sectionContent}>
            <div className={styles.tableWrapper}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(obj).map(([key, value]) => (
                    <tr key={key}>
                      <td className={styles.fieldName}>{key}</td>
                      <td className={styles.fieldValue}>
                        {value === null || value === undefined ? (
                          <span className={styles.nullValue}>null</span>
                        ) : typeof value === "boolean" ? (
                          value.toString()
                        ) : typeof value === "object" ? (
                          JSON.stringify(value, null, 2)
                        ) : (
                          String(value)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderArrayTable = (array, title, icon, sectionKey) => {
    const isExpanded = expandedSections[sectionKey];
    const isEmpty = !array || array.length === 0;

    return (
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection(sectionKey)}
          aria-expanded={isExpanded}
          aria-controls={`section-${sectionKey}`}
        >
          <h3 className={styles.sectionTitle}>
            {isExpanded ? (
              <ChevronDown size={20} className={styles.chevron} />
            ) : (
              <ChevronRight size={20} className={styles.chevron} />
            )}
            {icon}
            {title} {!isEmpty && `(${array.length})`}
          </h3>
        </button>
        {isExpanded && (
          <div id={`section-${sectionKey}`} className={styles.sectionContent}>
            {isEmpty ? (
              <p className={styles.emptyMessage}>No records found</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      {Object.keys(array[0]).map((key) => (
                        <th key={key}>{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {array.map((row, idx) => (
                      <tr key={idx} className={idx === 0 ? styles.highlightedRow : ""}>
                        {Object.keys(array[0]).map((key) => (
                          <td key={key} className={styles.fieldValue}>
                            {row[key] === null || row[key] === undefined ? (
                              <span className={styles.nullValue}>null</span>
                            ) : typeof row[key] === "boolean" ? (
                              row[key].toString()
                            ) : (
                              String(row[key])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const modalContent = (
    <div className={styles.modalOverlay} onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className={styles.modalContainer}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="debug-modal-title"
      >
        <div className={styles.modalHeader}>
          <div className={styles.headerContent}>
            <Database size={24} className={styles.headerIcon} />
            <h2 id="debug-modal-title" className={styles.modalTitle}>
              Container Debug Info
            </h2>
          </div>
          <div className={styles.headerActions}>
            <button
              onClick={fetchDebugInfo}
              className={styles.iconButton}
              title="Refresh data"
              disabled={loading}
              aria-label="Refresh debug data"
            >
              <RefreshCw size={18} className={loading ? styles.spinning : ""} />
            </button>
            <button
              onClick={onClose}
              className={styles.closeButton}
              title="Close (Esc)"
              aria-label="Close modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className={styles.modalBody}>
          {loading && !debugInfo ? (
            <div className={styles.loadingState}>
              <LoadingSpinner />
              <p className={styles.loadingText}>Loading debug information...</p>
            </div>
          ) : error ? (
            <div className={styles.errorState}>
              <AlertCircle size={48} className={styles.errorIcon} />
              <h3 className={styles.errorTitle}>Error Loading Debug Info</h3>
              <p className={styles.errorMessage}>{error}</p>
              <button onClick={fetchDebugInfo} className={styles.retryButton} disabled={loading}>
                <RefreshCw size={16} />
                Try Again
              </button>
            </div>
          ) : debugInfo ? (
            <>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Container:</span>
                  <span className={styles.infoValue}>
                    {debugInfo.container?.container_name || containerName || "Unknown"}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Container ID:</span>
                  <span className={styles.infoValue}>{containerId.substring(0, 12)}...</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Portainer:</span>
                  <span className={styles.infoValue}>
                    {debugInfo.container?.portainer_name || "Unknown"}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Queried At:</span>
                  <span className={styles.infoValue}>{formatDate(debugInfo.metadata?.queried_at)}</span>
                </div>
              </div>

              <div className={styles.sectionsContainer}>
                {renderJsonTable(
                  debugInfo.container,
                  "Container Record (containers table)",
                  "container"
                )}

                {renderJsonTable(
                  debugInfo.deployedImage,
                  "Current Deployed Image (deployed_images table)",
                  "deployedImage"
                )}

                {renderArrayTable(
                  debugInfo.allDeployedImages,
                  "All Deployed Images for this Image/Tag",
                  <Package size={18} className={styles.sectionIcon} />,
                  "allDeployedImages"
                )}

                {renderJsonTable(
                  debugInfo.registryImageVersion,
                  "Registry Image Version (registry_image_versions table)",
                  "registryImageVersion"
                )}

                {renderArrayTable(
                  debugInfo.allRegistryImageVersions,
                  "All Registry Image Versions for this Image",
                  <Database size={18} className={styles.sectionIcon} />,
                  "allRegistryImageVersions"
                )}

                {renderArrayTable(
                  debugInfo.upgradeHistory,
                  "Upgrade History",
                  <History size={18} className={styles.sectionIcon} />,
                  "upgradeHistory"
                )}

                {renderArrayTable(
                  debugInfo.allContainersWithSameName,
                  "All Containers with Same Name (check for duplicates)",
                  <AlertCircle size={18} className={styles.sectionIcon} />,
                  "allContainersWithSameName"
                )}
              </div>

              <div className={styles.modalFooter}>
                <p className={styles.footerNote}>
                  💡 Highlighted rows indicate the current/active record. Press{" "}
                  <kbd className={styles.kbd}>Esc</kbd> to close.
                </p>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  // Render modal using React Portal at document root
  return createPortal(modalContent, document.body);
}

ContainerDebugModal.propTypes = {
  containerId: PropTypes.string.isRequired,
  containerName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

export default ContainerDebugModal;

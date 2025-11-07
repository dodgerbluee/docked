import React, { useState, useEffect } from "react";
import axios from "axios";
import "./App.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:3001";

function App() {
  const [containers, setContainers] = useState([]);
  const [stacks, setStacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [upgrading, setUpgrading] = useState({});
  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [batchUpgrading, setBatchUpgrading] = useState(false);
  const [activeTab, setActiveTab] = useState("summary");
  const [contentTab, setContentTab] = useState("updates"); // "updates", "current", "unused"
  const [collapsedStacks, setCollapsedStacks] = useState(new Set());
  const [unusedImages, setUnusedImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [deletingImages, setDeletingImages] = useState(false);
  const [unusedImagesCount, setUnusedImagesCount] = useState(0);
  const [darkMode, setDarkMode] = useState(() => {
    // Check localStorage for saved preference
    const saved = localStorage.getItem("darkMode");
    return saved ? JSON.parse(saved) : false;
  });

  // Update body class when dark mode changes
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
    }
    localStorage.setItem("darkMode", JSON.stringify(darkMode));
  }, [darkMode]);

  useEffect(() => {
    fetchContainers();
    // Auto-refresh disabled - user can manually refresh if needed
  }, []);

  const fetchContainers = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/containers`);
      // Handle both grouped and flat response formats
      if (response.data.grouped && response.data.stacks) {
        setContainers(response.data.containers); // Keep flat list for filtering
        setStacks(response.data.stacks);
        setUnusedImagesCount(response.data.unusedImagesCount || 0);
      } else {
        // Backward compatibility: treat as flat array
        setContainers(Array.isArray(response.data) ? response.data : []);
        setStacks([]);
        setUnusedImagesCount(0);
      }
      setError(null);

      // Fetch unused images
      await fetchUnusedImages();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch containers");
      console.error("Error fetching containers:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUnusedImages = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/images/unused`);
      setUnusedImages(response.data.unusedImages || []);
    } catch (err) {
      console.error("Error fetching unused images:", err);
    }
  };

  const handleToggleImageSelect = (imageId) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const handleSelectAllImages = () => {
    const allSelected = unusedImages.every((img) => selectedImages.has(img.id));
    if (allSelected) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(unusedImages.map((img) => img.id)));
    }
  };

  const handleDeleteImages = async () => {
    if (selectedImages.size === 0) {
      alert("Please select at least one image to delete");
      return;
    }

    if (
      !window.confirm(
        `Delete ${selectedImages.size} selected image(s)? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      setDeletingImages(true);
      const imagesToDelete = unusedImages.filter((img) =>
        selectedImages.has(img.id)
      );

      // Deduplicate by image ID + portainerUrl + endpointId to avoid deleting the same image twice
      const uniqueImages = [];
      const seenKeys = new Set();
      for (const img of imagesToDelete) {
        const key = `${img.id}-${img.portainerUrl}-${img.endpointId}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueImages.push(img);
        }
      }

      console.log(
        `Selected ${selectedImages.size} images, sending ${uniqueImages.length} unique images to delete`
      );

      const response = await axios.post(`${API_BASE_URL}/api/images/delete`, {
        images: uniqueImages.map((img) => ({
          id: img.id,
          portainerUrl: img.portainerUrl,
          endpointId: img.endpointId,
        })),
      });

      if (response.data.success) {
        const deletedCount = response.data.deleted || 0;
        alert(`Successfully deleted ${deletedCount} image(s)`);

        // Refresh containers and unused images
        await fetchContainers();
        setSelectedImages(new Set());
      } else {
        alert(`Failed to delete some images. Check console for details.`);
        console.error("Delete errors:", response.data.errors);
      }
    } catch (err) {
      alert(
        `Failed to delete images: ${err.response?.data?.error || err.message}`
      );
      console.error("Error deleting images:", err);
    } finally {
      setDeletingImages(false);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const handleUpgrade = async (container) => {
    try {
      setUpgrading({ ...upgrading, [container.id]: true });
      const response = await axios.post(
        `${API_BASE_URL}/api/containers/${container.id}/upgrade`,
        {
          endpointId: container.endpointId,
          imageName: container.image,
          portainerUrl: container.portainerUrl,
        }
      );

      if (response.data.success) {
        // Refresh containers after upgrade
        await fetchContainers();
        const oldImage = response.data.oldImage || container.image;
        const newImage = response.data.newImage || container.image;
        alert(
          `Container ${container.name} upgraded successfully!\n` +
            `From: ${oldImage}\n` +
            `To: ${newImage}`
        );
        // Remove from selection if it was selected
        setSelectedContainers((prev) => {
          const next = new Set(prev);
          next.delete(container.id);
          return next;
        });
      }
    } catch (err) {
      alert(
        `Failed to upgrade ${container.name}: ${
          err.response?.data?.error || err.message
        }`
      );
      console.error("Error upgrading container:", err);
    } finally {
      setUpgrading({ ...upgrading, [container.id]: false });
    }
  };

  const handleToggleSelect = (containerId) => {
    setSelectedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(containerId)) {
        next.delete(containerId);
      } else {
        next.add(containerId);
      }
      return next;
    });
  };

  const handleSelectAll = (containersToSelect) => {
    // Filter out Portainer containers
    const selectableContainers = containersToSelect.filter(
      (c) => !isPortainerContainer(c)
    );
    const allSelected = selectableContainers.every((c) =>
      selectedContainers.has(c.id)
    );
    if (allSelected) {
      // Deselect all
      setSelectedContainers(new Set());
    } else {
      // Select all (excluding Portainer containers)
      setSelectedContainers(new Set(selectableContainers.map((c) => c.id)));
    }
  };

  const handleBatchUpgrade = async () => {
    if (selectedContainers.size === 0) {
      alert("Please select at least one container to upgrade");
      return;
    }

    const containersToUpgrade = containers.filter((c) =>
      selectedContainers.has(c.id)
    );

    if (
      !window.confirm(
        `Upgrade ${containersToUpgrade.length} selected container(s)?`
      )
    ) {
      return;
    }

    // Mark all selected containers as upgrading
    const upgradingState = {};
    containersToUpgrade.forEach((c) => {
      upgradingState[c.id] = true;
    });
    setUpgrading((prev) => ({ ...prev, ...upgradingState }));

    try {
      setBatchUpgrading(true);

      const response = await axios.post(
        `${API_BASE_URL}/api/containers/batch-upgrade`,
        {
          containers: containersToUpgrade.map((c) => ({
            containerId: c.id,
            endpointId: c.endpointId,
            imageName: c.image,
            containerName: c.name,
            portainerUrl: c.portainerUrl,
          })),
        }
      );

      // Refresh containers after upgrade
      await fetchContainers();

      // Show results
      const successCount = response.data.results?.length || 0;
      const errorCount = response.data.errors?.length || 0;

      let message = `Batch upgrade completed!\n`;
      message += `✓ Successfully upgraded: ${successCount}\n`;
      if (errorCount > 0) {
        message += `✗ Failed: ${errorCount}\n\n`;
        message += `Errors:\n`;
        response.data.errors.forEach((err) => {
          message += `- ${err.containerName}: ${err.error}\n`;
        });
      }

      alert(message);

      // Clear selection
      setSelectedContainers(new Set());
    } catch (err) {
      alert(
        `Batch upgrade failed: ${err.response?.data?.error || err.message}`
      );
      console.error("Error in batch upgrade:", err);
    } finally {
      setBatchUpgrading(false);
      // Clear upgrading state for all containers
      const clearedState = {};
      containersToUpgrade.forEach((c) => {
        clearedState[c.id] = false;
      });
      setUpgrading((prev) => ({ ...prev, ...clearedState }));
    }
  };

  const containersWithUpdates = containers.filter((c) => c.hasUpdate);
  const containersUpToDate = containers.filter((c) => !c.hasUpdate);

  const toggleStack = (stackKey) => {
    setCollapsedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(stackKey)) {
        next.delete(stackKey);
      } else {
        next.add(stackKey);
      }
      return next;
    });
  };

  // Check if a container is a Portainer instance
  const isPortainerContainer = (container) => {
    const imageName = container.image?.toLowerCase() || "";
    const containerName = container.name?.toLowerCase() || "";
    return (
      imageName.includes("portainer") || containerName.includes("portainer")
    );
  };

  // Group containers by Portainer instance
  const containersByPortainer = containers.reduce((acc, container) => {
    const portainerName =
      container.portainerName || container.portainerUrl || "Unknown";
    if (!acc[portainerName]) {
      acc[portainerName] = {
        name: portainerName,
        url: container.portainerUrl,
        containers: [],
        withUpdates: [],
        upToDate: [],
      };
    }
    acc[portainerName].containers.push(container);
    if (container.hasUpdate) {
      acc[portainerName].withUpdates.push(container);
    } else {
      acc[portainerName].upToDate.push(container);
    }
    return acc;
  }, {});

  const portainerInstances = Object.values(containersByPortainer);

  // Calculate unused images per Portainer instance
  const unusedImagesByPortainer = unusedImages.reduce((acc, img) => {
    const portainerName = img.portainerName || "Unknown";
    acc[portainerName] = (acc[portainerName] || 0) + 1;
    return acc;
  }, {});

  // Calculate summary statistics
  const summaryStats = {
    totalPortainers: portainerInstances.length,
    totalContainers: containers.length,
    containersWithUpdates: containersWithUpdates.length,
    containersUpToDate: containersUpToDate.length,
    unusedImages: unusedImagesCount,
    portainerStats: portainerInstances.map((p) => ({
      name: p.name,
      url: p.url,
      total: p.containers.length,
      withUpdates: p.withUpdates.length,
      upToDate: p.upToDate.length,
      unusedImages: unusedImagesByPortainer[p.name] || 0,
    })),
  };

  // Render a stack group
  const renderStackGroup = (stack, containersInStack, showUpdates) => {
    const stackContainersWithUpdates = containersInStack.filter(
      (c) => c.hasUpdate
    );
    const stackContainersUpToDate = containersInStack.filter(
      (c) => !c.hasUpdate
    );

    // If showing updates section, only show stacks with updates
    if (showUpdates && stackContainersWithUpdates.length === 0) {
      return null;
    }

    // If showing up-to-date section, only show stacks with up-to-date containers
    if (!showUpdates && stackContainersUpToDate.length === 0) {
      return null;
    }

    const stackKey = `${stack.stackName}-${
      showUpdates ? "updates" : "current"
    }`;
    const isCollapsed = collapsedStacks.has(stackKey);
    const displayName =
      stack.stackName === "Standalone"
        ? "Standalone Containers"
        : `Stack: ${stack.stackName}`;

    return (
      <div key={stackKey} className="stack-group">
        <div className="stack-header" onClick={() => toggleStack(stackKey)}>
          <div className="stack-header-left">
            <button className="stack-toggle" aria-label="Toggle stack">
              {isCollapsed ? "▶" : "▼"}
            </button>
            <h3 className="stack-name">{displayName}</h3>
          </div>
          <span className="stack-count">
            {showUpdates && stackContainersWithUpdates.length > 0 && (
              <span className="update-count">
                {stackContainersWithUpdates.length} update
                {stackContainersWithUpdates.length !== 1 ? "s" : ""} available
              </span>
            )}
            {!showUpdates && (
              <span>
                {stackContainersUpToDate.length} container
                {stackContainersUpToDate.length !== 1 ? "s" : ""}
              </span>
            )}
          </span>
        </div>
        {!isCollapsed && (
          <>
            {showUpdates && stackContainersWithUpdates.length > 0 && (
              <div className="containers-grid">
                {stackContainersWithUpdates.map((container) => {
                  const isPortainer = isPortainerContainer(container);
                  return (
                    <div
                      key={container.id}
                      className={`container-card update-available ${
                        isPortainer ? "portainer-disabled" : ""
                      }`}
                      title={
                        isPortainer
                          ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                          : ""
                      }
                    >
                      <div
                        className="card-header"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        <label className="container-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedContainers.has(container.id)}
                            onChange={() => handleToggleSelect(container.id)}
                            disabled={
                              upgrading[container.id] ||
                              isPortainerContainer(container)
                            }
                            title={
                              isPortainer
                                ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                                : ""
                            }
                          />
                          <h3>{container.name}</h3>
                        </label>
                      </div>
                      <div
                        className="card-body"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        {container.portainerName && (
                          <p className="portainer-info">
                            <strong>Portainer:</strong>{" "}
                            <span className="portainer-badge">
                              {container.portainerName}
                            </span>
                          </p>
                        )}
                        <p className="image-info">
                          <strong>Image:</strong> {container.image}
                        </p>
                        <p className="status-info">
                          <strong>Status:</strong> {container.status}
                        </p>
                        <p className="tag-info">
                          <strong>Current:</strong>{" "}
                          <span className="version-badge current">
                            {container.currentDigest
                              ? `sha256:${container.currentDigest}`
                              : container.currentVersion ||
                                container.currentTag ||
                                "latest"}
                          </span>
                        </p>
                        <p className="tag-info">
                          <strong>Latest:</strong>{" "}
                          <span className="version-badge new">
                            {container.latestDigest
                              ? `sha256:${container.latestDigest}`
                              : container.newVersion ||
                                container.latestTag ||
                                "latest"}
                          </span>
                        </p>
                      </div>
                      <div
                        className="card-footer"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        <button
                          className="upgrade-button"
                          onClick={() => handleUpgrade(container)}
                          disabled={
                            upgrading[container.id] ||
                            isPortainerContainer(container)
                          }
                          title={
                            isPortainerContainer(container)
                              ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                              : ""
                          }
                        >
                          {upgrading[container.id]
                            ? "Upgrading..."
                            : "Upgrade Now"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!showUpdates && stackContainersUpToDate.length > 0 && (
              <div className="containers-grid">
                {stackContainersUpToDate.map((container) => {
                  const isPortainer = isPortainerContainer(container);
                  return (
                    <div
                      key={container.id}
                      className={`container-card ${
                        isPortainer ? "portainer-disabled" : ""
                      }`}
                      title={
                        isPortainer
                          ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                          : ""
                      }
                    >
                      <div
                        className="card-header"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        <h3>{container.name}</h3>
                      </div>
                      <div
                        className="card-body"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        {container.portainerName && (
                          <p className="portainer-info">
                            <strong>Portainer:</strong>{" "}
                            <span className="portainer-badge">
                              {container.portainerName}
                            </span>
                          </p>
                        )}
                        <p className="image-info">
                          <strong>Image:</strong> {container.image}
                        </p>
                        <p className="status-info">
                          <strong>Status:</strong> {container.status}
                        </p>
                        {container.currentDigest && (
                          <p className="tag-info">
                            <strong>Digest:</strong>{" "}
                            <span className="version-badge current">
                              sha256:{container.currentDigest}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // Render summary page
  const renderSummary = () => {
    return (
      <div className="summary-page">
        <h2>Summary Dashboard</h2>
        <div className="summary-stats">
          <div className="stat-card">
            <div className="stat-value">{summaryStats.totalPortainers}</div>
            <div className="stat-label">Portainer Instances</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summaryStats.totalContainers}</div>
            <div className="stat-label">Total Containers</div>
          </div>
          <div className="stat-card update-available">
            <div className="stat-value">
              {summaryStats.containersWithUpdates}
            </div>
            <div className="stat-label">Updates Available</div>
          </div>
          <div className="stat-card current">
            <div className="stat-value">{summaryStats.containersUpToDate}</div>
            <div className="stat-label">Up to Date</div>
          </div>
          <div className="stat-card unused-images">
            <div className="stat-value">{summaryStats.unusedImages}</div>
            <div className="stat-label">Unused Images</div>
          </div>
        </div>

        <div className="portainer-instances-list">
          <h3>Portainer Instances</h3>
          <div className="instances-grid">
            {summaryStats.portainerStats.map((stat) => (
              <div
                key={stat.name}
                className="instance-card"
                onClick={() => setActiveTab(stat.name)}
              >
                <div className="instance-header">
                  <h4>{stat.name}</h4>
                  {stat.withUpdates > 0 && (
                    <span className="update-badge">
                      {stat.withUpdates} updates
                    </span>
                  )}
                </div>
                <div className="instance-stats">
                  <div className="instance-stat">
                    <span className="stat-number">{stat.total}</span>
                    <span className="stat-text">Total</span>
                  </div>
                  <div className="instance-stat">
                    <span className="stat-number update">
                      {stat.withUpdates}
                    </span>
                    <span className="stat-text">Updates</span>
                  </div>
                  <div className="instance-stat">
                    <span className="stat-number current">{stat.upToDate}</span>
                    <span className="stat-text">Current</span>
                  </div>
                  <div className="instance-stat">
                    <span className="stat-number">{stat.unusedImages}</span>
                    <span className="stat-text">Unused</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Render containers for a specific Portainer instance
  const renderPortainerTab = (portainerName) => {
    const portainerData = containersByPortainer[portainerName];
    if (!portainerData) return null;

    const instanceContainersWithUpdates = portainerData.withUpdates;
    const instanceContainersUpToDate = portainerData.upToDate;

    // Group by stack for this instance
    const instanceStacks = portainerData.containers.reduce((acc, container) => {
      const stackName = container.stackName || "Standalone";
      if (!acc[stackName]) {
        acc[stackName] = [];
      }
      acc[stackName].push(container);
      return acc;
    }, {});

    const groupedStacks = Object.keys(instanceStacks).map((stackName) => ({
      stackName: stackName,
      containers: instanceStacks[stackName],
    }));

    groupedStacks.sort((a, b) => {
      if (a.stackName === "Standalone") return 1;
      if (b.stackName === "Standalone") return -1;
      return a.stackName.localeCompare(b.stackName);
    });

    // Filter unused images for this portainer
    const portainerUnusedImages = unusedImages.filter(
      (img) => img.portainerName === portainerName
    );

    return (
      <div className="portainer-tab-content">
        <div className="portainer-header">
          <h2>{portainerName}</h2>
          <div className="portainer-stats-inline">
            <span className="stat-inline">
              <strong>{portainerData.containers.length}</strong> containers
            </span>
            {portainerData.withUpdates.length > 0 && (
              <span className="stat-inline update">
                <strong>{portainerData.withUpdates.length}</strong> updates
                available
              </span>
            )}
          </div>
        </div>

        {/* Content Tabs */}
        <div className="content-tabs">
          <button
            className={`content-tab ${
              contentTab === "updates" ? "active" : ""
            }`}
            onClick={() => setContentTab("updates")}
          >
            Updates Available ({instanceContainersWithUpdates.length})
          </button>
          <button
            className={`content-tab ${
              contentTab === "current" ? "active" : ""
            }`}
            onClick={() => setContentTab("current")}
          >
            Current Containers ({instanceContainersUpToDate.length})
          </button>
          <button
            className={`content-tab ${contentTab === "unused" ? "active" : ""}`}
            onClick={() => setContentTab("unused")}
          >
            Unused Images ({portainerUnusedImages.length})
          </button>
        </div>

        {/* Updates Tab */}
        {contentTab === "updates" && (
          <div className="content-tab-panel">
            {instanceContainersWithUpdates.length > 0 ? (
              <>
                <div className="section-header">
                  <h3>
                    Available Updates ({instanceContainersWithUpdates.length})
                  </h3>
                  <div className="batch-actions">
                    <label className="select-all-checkbox">
                      <input
                        type="checkbox"
                        checked={
                          instanceContainersWithUpdates.filter(
                            (c) => !isPortainerContainer(c)
                          ).length > 0 &&
                          instanceContainersWithUpdates
                            .filter((c) => !isPortainerContainer(c))
                            .every((c) => selectedContainers.has(c.id))
                        }
                        onChange={() =>
                          handleSelectAll(instanceContainersWithUpdates)
                        }
                      />
                      Select All
                    </label>
                    {selectedContainers.size > 0 && (
                      <button
                        className="batch-upgrade-button"
                        onClick={handleBatchUpgrade}
                        disabled={batchUpgrading}
                      >
                        {batchUpgrading
                          ? `Upgrading ${selectedContainers.size}...`
                          : `Upgrade Selected (${selectedContainers.size})`}
                      </button>
                    )}
                  </div>
                </div>
                {groupedStacks.map((stack) =>
                  renderStackGroup(stack, stack.containers, true)
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>No containers with updates available.</p>
              </div>
            )}
          </div>
        )}

        {/* Current Containers Tab */}
        {contentTab === "current" && (
          <div className="content-tab-panel">
            {instanceContainersUpToDate.length > 0 ? (
              <>
                <div className="section-header">
                  <h3>
                    Current Containers ({instanceContainersUpToDate.length})
                  </h3>
                </div>
                {groupedStacks.map((stack) =>
                  renderStackGroup(stack, stack.containers, false)
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>No up-to-date containers found.</p>
              </div>
            )}
          </div>
        )}

        {/* Unused Images Tab */}
        {contentTab === "unused" && (
          <div className="content-tab-panel">
            {portainerUnusedImages.length > 0 ? (
              <>
                <div className="section-header">
                  <div>
                    <h3>Unused Images ({portainerUnusedImages.length})</h3>
                    <p className="unused-images-total-size">
                      Total Size:{" "}
                      <strong>
                        {formatBytes(
                          portainerUnusedImages.reduce(
                            (sum, img) => sum + (img.size || 0),
                            0
                          )
                        )}
                      </strong>
                    </p>
                  </div>
                  <div className="batch-actions">
                    <label className="select-all-checkbox">
                      <input
                        type="checkbox"
                        checked={
                          portainerUnusedImages.length > 0 &&
                          portainerUnusedImages.every((img) =>
                            selectedImages.has(img.id)
                          )
                        }
                        onChange={() => {
                          const allSelected = portainerUnusedImages.every(
                            (img) => selectedImages.has(img.id)
                          );
                          if (allSelected) {
                            const newSet = new Set(selectedImages);
                            portainerUnusedImages.forEach((img) =>
                              newSet.delete(img.id)
                            );
                            setSelectedImages(newSet);
                          } else {
                            const newSet = new Set(selectedImages);
                            portainerUnusedImages.forEach((img) =>
                              newSet.add(img.id)
                            );
                            setSelectedImages(newSet);
                          }
                        }}
                      />
                      Select All
                    </label>
                    {selectedImages.size > 0 && (
                      <button
                        className="delete-images-button"
                        onClick={handleDeleteImages}
                        disabled={deletingImages}
                      >
                        {deletingImages
                          ? `Deleting ${selectedImages.size}...`
                          : `Delete Selected (${selectedImages.size})`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="unused-images-grid">
                  {portainerUnusedImages.map((image) => (
                    <div key={image.id} className="unused-image-card">
                      <label className="image-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedImages.has(image.id)}
                          onChange={() => handleToggleImageSelect(image.id)}
                        />
                        <div className="image-info">
                          <div className="image-tags-header">
                            <strong>Image Tags:</strong>
                          </div>
                          <div className="image-tags">
                            {image.repoTags && image.repoTags.length > 0 ? (
                              image.repoTags.map((tag, idx) => (
                                <span key={idx} className="image-tag-badge">
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="image-tag-badge no-tag">
                                &lt;none&gt;
                              </span>
                            )}
                          </div>
                          <div className="image-meta">
                            <span className="image-size">
                              <strong>Size:</strong> {formatBytes(image.size)}
                            </span>
                            <span className="image-portainer">
                              <strong>Portainer:</strong> {image.portainerName}
                            </span>
                          </div>
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <p>No unused images found.</p>
              </div>
            )}
          </div>
        )}

        {portainerData.containers.length === 0 &&
          portainerUnusedImages.length === 0 && (
            <div className="empty-state">
              <p>No containers or images found for this Portainer instance.</p>
            </div>
          )}
      </div>
    );
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <div>
            <h1>🐳 Docked</h1>
            <p>Docker Container Update Manager</p>
          </div>
          <div className="header-actions">
            <button
              className="theme-toggle-button"
              onClick={() => setDarkMode(!darkMode)}
              aria-label="Toggle dark mode"
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
            <button
              className="refresh-button"
              onClick={fetchContainers}
              aria-label="Refresh containers"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        {/* Tabs */}
        <div className="tabs-container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === "summary" ? "active" : ""}`}
              onClick={() => setActiveTab("summary")}
            >
              📊 Summary
            </button>
            {portainerInstances.map((instance) => (
              <button
                key={instance.name}
                className={`tab ${activeTab === instance.name ? "active" : ""}`}
                onClick={() => setActiveTab(instance.name)}
              >
                {instance.name}
                {instance.withUpdates.length > 0 && (
                  <span className="tab-badge">
                    {instance.withUpdates.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {loading && <div className="loading">Loading containers...</div>}

          {error && (
            <div className="error">
              <p>Error: {error}</p>
              <button onClick={fetchContainers}>Retry</button>
            </div>
          )}

          {!loading && !error && (
            <>
              {activeTab === "summary" && renderSummary()}
              {activeTab !== "summary" && renderPortainerTab(activeTab)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;

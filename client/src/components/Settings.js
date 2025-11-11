/**
 * Settings Component
 * Allows users to update their username and password
 */

import React, { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import axios from "axios";
import {
  Monitor,
  Sun,
  Moon,
  Info,
  Search,
  Lock,
  AlertTriangle,
  Pencil,
  Trash2,
} from "lucide-react";
import "./Settings.css";
import DockerHubCredsModal from "./DockerHubCredsModal";
import DiscordWebhookModal from "./DiscordWebhookModal";

// In production, API is served from same origin, so use relative URLs
const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

function Settings({
  username,
  onUsernameUpdate,
  onLogout,
  isFirstLogin = false,
  onPasswordUpdateSuccess,
  onPortainerInstancesChange,
  activeSection = "general",
  onSectionChange = null,
  showUserInfoAboveTabs = false,
  onEditInstance = null,
  avatar,
  recentAvatars = [],
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
  onBatchConfigUpdate = null,
  colorScheme = "system",
  onColorSchemeChange = null,
  refreshInstances = null,
  onClearPortainerData = null,
  onClearTrackedAppData = null,
}) {
  // Store callbacks in refs to avoid stale closure issues
  const onBatchConfigUpdateRef = useRef(onBatchConfigUpdate);
  const onAvatarChangeRef = useRef(onAvatarChange);

  // Update refs whenever props change
  useEffect(() => {
    onBatchConfigUpdateRef.current = onBatchConfigUpdate;
  }, [onBatchConfigUpdate]);

  useEffect(() => {
    onAvatarChangeRef.current = onAvatarChange;
  }, [onAvatarChange]);


  const [userInfo, setUserInfo] = useState(null);
  // Use prop if provided, otherwise use internal state
  const [internalActiveSection, setInternalActiveSection] =
    useState(activeSection);
  // If first login, always show password section regardless of activeSection prop
  const currentActiveSection = isFirstLogin
    ? "password"
    : activeSection || internalActiveSection;
  const setActiveSection = onSectionChange || setInternalActiveSection;

  // Portainer instances state
  const [portainerInstances, setPortainerInstances] = useState([]);
  const [editingInstance, setEditingInstance] = useState(null);
  const [instanceForm, setInstanceForm] = useState({
    name: "",
    url: "",
    username: "",
    password: "",
  });
  const [instanceError, setInstanceError] = useState("");
  const [instanceSuccess, setInstanceSuccess] = useState("");
  const [instanceLoading, setInstanceLoading] = useState(false);

  // Username update state
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameSuccess, setUsernameSuccess] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);

  // Password update state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Docker Hub credentials state
  const [dockerHubCredentials, setDockerHubCredentials] = useState(null);
  const [showDockerHubModal, setShowDockerHubModal] = useState(false);
  const [dockerHubSuccess, setDockerHubSuccess] = useState("");

  // Batch configuration state - separate for each job type
  const [batchConfigs, setBatchConfigs] = useState({
    "docker-hub-pull": {
      enabled: false,
      intervalMinutes: 60,
      intervalValue: 60,
      intervalUnit: "minutes",
    },
    "tracked-apps-check": {
      enabled: false,
      intervalMinutes: 60,
      intervalValue: 60,
      intervalUnit: "minutes",
    },
  });
  const [batchError, setBatchError] = useState("");
  const [batchSuccess, setBatchSuccess] = useState("");
  const [batchLoading, setBatchLoading] = useState({});

  // Avatar upload state
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarImage, setAvatarImage] = useState(null);
  const [avatarCrop, setAvatarCrop] = useState({
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  });
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarSuccess, setAvatarSuccess] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [avatarPan, setAvatarPan] = useState({ x: 0, y: 0 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Clear data state
  const [clearingPortainerData, setClearingPortainerData] = useState(false);
  const [clearingTrackedAppData, setClearingTrackedAppData] = useState(false);

  // General settings state (local state before saving)
  const [localColorScheme, setLocalColorScheme] = useState(colorScheme);
  const [logLevel, setLogLevel] = useState('info');
  const [localLogLevel, setLocalLogLevel] = useState('info');
  const [generalSettingsChanged, setGeneralSettingsChanged] = useState(false);
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);

  // Discord settings state
  const [discordWebhooks, setDiscordWebhooks] = useState([]);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [editingDiscordWebhook, setEditingDiscordWebhook] = useState(null);
  const [discordSuccess, setDiscordSuccess] = useState("");

  useEffect(() => {
    fetchUserInfo();
    fetchPortainerInstances();
    fetchDockerHubCredentials();
    fetchBatchConfig();
    fetchLogLevel();
    fetchDiscordWebhooks();
    // If first login, always show password section (priority over activeSection)
    if (isFirstLogin) {
      if (onSectionChange) {
        onSectionChange("password");
      } else {
        setInternalActiveSection("password");
      }
    } else if (activeSection) {
      // Only update internal state when prop changes if not first login
      setInternalActiveSection(activeSection);
    }
  }, [isFirstLogin, activeSection, onSectionChange]);

  // Sync local color scheme with prop changes
  useEffect(() => {
    setLocalColorScheme(colorScheme);
    setGeneralSettingsChanged(false);
  }, [colorScheme]);

  // Sync local log level with fetched log level
  useEffect(() => {
    setLocalLogLevel(logLevel);
  }, [logLevel]);

  // Refresh instances list when portainer section becomes active
  // This ensures the auth method badges are up to date after modal edits
  useEffect(() => {
    if (currentActiveSection === "portainer") {
      fetchPortainerInstances();
    }
  }, [currentActiveSection]);

  // Also refresh when refreshInstances prop changes (triggered after modal closes)
  // When editingPortainerInstance becomes null, refreshInstances prop changes
  // which triggers this effect to refresh the instances list
  useEffect(() => {
    if (refreshInstances && currentActiveSection === "portainer") {
      // Small delay to ensure modal has closed and data is saved
      const timeout = setTimeout(() => {
        fetchPortainerInstances();
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [refreshInstances, currentActiveSection]);

  const fetchPortainerInstances = async () => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/portainer/instances`
      );
      if (response.data.success) {
        setPortainerInstances(response.data.instances || []);
      }
    } catch (err) {
      console.error("Error fetching Portainer instances:", err);
    }
  };

  const fetchDockerHubCredentials = async () => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/docker-hub/credentials`
      );
      if (response.data.success) {
        setDockerHubCredentials(response.data.credentials);
      }
    } catch (err) {
      console.error("Error fetching Docker Hub credentials:", err);
    }
  };

  const fetchLogLevel = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/log-level`);
      if (response.data.success) {
        setLogLevel(response.data.logLevel || 'info');
      }
    } catch (err) {
      console.error("Error fetching log level:", err);
    }
  };

  const fetchDiscordWebhooks = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/discord/webhooks`);
      if (response.data.success) {
        setDiscordWebhooks(response.data.webhooks || []);
      }
    } catch (err) {
      console.error("Error fetching Discord webhooks:", err);
    }
  };

  const handleDiscordModalSuccess = async () => {
    setDiscordSuccess("Discord webhook saved successfully!");
    await fetchDiscordWebhooks();
    setTimeout(() => setDiscordSuccess(""), 3000);
  };

  const handleDeleteDiscordWebhook = async (id) => {
    if (!window.confirm("Are you sure you want to remove this Discord webhook?")) {
      return;
    }

    try {
      const response = await axios.delete(
        `${API_BASE_URL}/api/discord/webhooks/${id}`
      );

      if (response.data.success) {
        setDiscordSuccess("Discord webhook removed successfully!");
        await fetchDiscordWebhooks();
        setTimeout(() => setDiscordSuccess(""), 3000);
      }
    } catch (err) {
      console.error("Failed to remove Discord webhook:", err);
      alert(err.response?.data?.error || "Failed to remove Discord webhook");
    }
  };

  const handleTestDiscordWebhook = async (webhookId) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/discord/webhooks/${webhookId}/test`
      );

      if (!response.data.success) {
        alert(response.data.error || "Webhook test failed");
      }
    } catch (err) {
      console.error("Failed to test Discord webhook:", err);
      alert(err.response?.data?.error || "Failed to test Discord webhook");
    }
  };

  const handleLogLevelChange = (newLevel) => {
    setLocalLogLevel(newLevel);
    setGeneralSettingsChanged(true);
  };

  const fetchBatchConfig = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/config`);
      if (response.data.success) {
        const configs = response.data.config || {};
        const newConfigs = { ...batchConfigs };

        // Update each job type config
        ["docker-hub-pull", "tracked-apps-check"].forEach((jobType) => {
          const config = configs[jobType] || {
            enabled: false,
            intervalMinutes: 60,
          };
          const minutes = config.intervalMinutes || 60;

          // Convert minutes to display value and unit
          if (minutes >= 60 && minutes % 60 === 0) {
            newConfigs[jobType] = {
              enabled: config.enabled || false,
              intervalMinutes: minutes,
              intervalValue: minutes / 60,
              intervalUnit: "hours",
            };
          } else {
            newConfigs[jobType] = {
              enabled: config.enabled || false,
              intervalMinutes: minutes,
              intervalValue: minutes,
              intervalUnit: "minutes",
            };
          }
        });

        setBatchConfigs(newConfigs);
      }
    } catch (err) {
      console.error("Error fetching batch config:", err);
    }
  };

  const fetchUserInfo = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/auth/me`);
      if (response.data.success) {
        setUserInfo(response.data.user);
      }
    } catch (err) {
      console.error("Error fetching user info:", err);
    }
  };

  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    setUsernameError("");
    setUsernameSuccess("");
    setUsernameLoading(true);

    // Validate username
    if (newUsername.trim().length < 3) {
      setUsernameError("Username must be at least 3 characters long");
      setUsernameLoading(false);
      return;
    }

    if (newUsername.trim() === username) {
      setUsernameError("New username must be different from current username");
      setUsernameLoading(false);
      return;
    }

    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/auth/update-username`,
        {
          newUsername: newUsername.trim(),
          password: usernamePassword,
        }
      );

      if (response.data.success) {
        setUsernameSuccess("Username updated successfully!");
        setNewUsername("");
        setUsernamePassword("");
        // Update username in parent component
        // Update token if provided (new token format with user ID)
        if (response.data.token) {
          // Update token in parent component
          if (onUsernameUpdate) {
            onUsernameUpdate(response.data.newUsername, response.data.token);
          }
        } else {
          // Fallback for old API format
          if (onUsernameUpdate) {
            onUsernameUpdate(response.data.newUsername);
          }
        }
        // Refresh user info
        await fetchUserInfo();
        // Clear success message after 3 seconds
        setTimeout(() => setUsernameSuccess(""), 3000);
      } else {
        setUsernameError(response.data.error || "Failed to update username");
      }
    } catch (err) {
      setUsernameError(
        err.response?.data?.error ||
          "Failed to update username. Please try again."
      );
    } finally {
      setUsernameLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    setPasswordLoading(true);

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      setPasswordLoading(false);
      return;
    }

    // Validate password length
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters long");
      setPasswordLoading(false);
      return;
    }

    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/auth/update-password`,
        {
          currentPassword,
          newPassword,
        }
      );

      if (response.data.success) {
        setPasswordSuccess("Password updated successfully!");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        // Refresh user info
        await fetchUserInfo();
        // If first login, notify parent to close settings
        if (isFirstLogin && onPasswordUpdateSuccess) {
          setTimeout(() => {
            onPasswordUpdateSuccess();
          }, 1500);
        } else {
          // Clear success message after 3 seconds
          setTimeout(() => setPasswordSuccess(""), 3000);
        }
      } else {
        setPasswordError(response.data.error || "Failed to update password");
      }
    } catch (err) {
      setPasswordError(
        err.response?.data?.error ||
          "Failed to update password. Please try again."
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleInstanceSubmit = async (e) => {
    e.preventDefault();
    setInstanceError("");
    setInstanceSuccess("");
    setInstanceLoading(true);

    try {
      if (editingInstance) {
        // Update existing instance
        await axios.put(
          `${API_BASE_URL}/api/portainer/instances/${editingInstance.id}`,
          instanceForm
        );
        setInstanceSuccess("Portainer instance updated successfully!");
      } else {
        // Create new instance
        await axios.post(
          `${API_BASE_URL}/api/portainer/instances`,
          instanceForm
        );
        setInstanceSuccess("Portainer instance added successfully!");
      }

      setInstanceForm({ name: "", url: "", username: "", password: "" });
      setEditingInstance(null);
      await fetchPortainerInstances();
      // Notify parent to refresh containers
      if (onPortainerInstancesChange) {
        onPortainerInstancesChange();
      }
      setTimeout(() => setInstanceSuccess(""), 3000);
    } catch (err) {
      setInstanceError(
        err.response?.data?.error || "Failed to save Portainer instance"
      );
    } finally {
      setInstanceLoading(false);
    }
  };

  const handleEditInstance = (instance) => {
    setEditingInstance(instance);
    setInstanceForm({
      name: instance.name,
      url: instance.url,
      username: instance.username || "",
      password: "", // Don't pre-fill password for security
    });
    setActiveSection("portainer");
  };

  const handleDeleteInstance = async (id) => {
    if (
      !window.confirm(
        "Are you sure you want to delete this Portainer instance?"
      )
    ) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/api/portainer/instances/${id}`);
      setInstanceSuccess("Portainer instance deleted successfully!");
      await fetchPortainerInstances();
      // Notify parent to refresh containers
      if (onPortainerInstancesChange) {
        onPortainerInstancesChange();
      }
      setTimeout(() => setInstanceSuccess(""), 3000);
    } catch (err) {
      setInstanceError(
        err.response?.data?.error || "Failed to delete Portainer instance"
      );
    }
  };

  const handleCancelEdit = () => {
    setEditingInstance(null);
    setInstanceForm({ name: "", url: "", username: "", password: "" });
    setInstanceError("");
  };

  const handleDockerHubModalSuccess = async () => {
    setDockerHubSuccess("Docker Hub credentials saved successfully!");
    await fetchDockerHubCredentials();
    setTimeout(() => setDockerHubSuccess(""), 3000);
  };

  const handleDeleteDockerHubCreds = async () => {
    if (
      !window.confirm(
        "Are you sure you want to remove Docker Hub credentials? This will revert to anonymous rate limits."
      )
    ) {
      return;
    }

    try {
      const response = await axios.delete(
        `${API_BASE_URL}/api/docker-hub/credentials`
      );
      if (response.data.success) {
        setDockerHubSuccess("Docker Hub credentials removed successfully!");
        setDockerHubCredentials(null);
        await fetchDockerHubCredentials();
        setTimeout(() => setDockerHubSuccess(""), 3000);
      }
    } catch (err) {
      console.error("Failed to remove Docker Hub credentials:", err);
    }
  };

  const handleBatchConfigSubmit = async (e) => {
    e.preventDefault();
    setBatchError("");
    setBatchSuccess("");
    setBatchLoading({ "docker-hub-pull": true, "tracked-apps-check": true });

    try {
      // Save both configs
      const promises = ["docker-hub-pull", "tracked-apps-check"].map(
        async (jobType) => {
          const config = batchConfigs[jobType];

          // Convert display value to minutes based on selected unit
          const intervalMinutes =
            config.intervalUnit === "hours"
              ? config.intervalValue * 60
              : config.intervalValue;

          const response = await axios.post(
            `${API_BASE_URL}/api/batch/config`,
            {
              jobType: jobType,
              enabled: config.enabled,
              intervalMinutes: intervalMinutes,
            }
          );

          if (response.data.success) {
            // Update local state with the saved config
            const updatedConfigs = { ...batchConfigs };
            updatedConfigs[jobType] = {
              ...config,
              intervalMinutes: intervalMinutes,
            };
            setBatchConfigs(updatedConfigs);
            return true;
          } else {
            throw new Error(
              response.data.error || "Failed to update batch configuration"
            );
          }
        }
      );

      await Promise.all(promises);

      setBatchSuccess("Batch configurations updated successfully!");
      setTimeout(() => setBatchSuccess(""), 3000);

      // Notify parent component to refetch batch config
      const callback = onBatchConfigUpdateRef.current;
      if (callback && typeof callback === "function") {
        try {
          await callback();
        } catch (err) {
          console.error("Error calling onBatchConfigUpdate:", err);
        }
      }
    } catch (err) {
      setBatchError(
        err.response?.data?.error ||
          err.message ||
          "Failed to update batch configuration. Please try again."
      );
    } finally {
      setBatchLoading({
        "docker-hub-pull": false,
        "tracked-apps-check": false,
      });
    }
  };

  // Avatar upload handlers
  const handleAvatarFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check if image
    if (!file.type.startsWith("image/")) {
      setAvatarError("Please select an image file");
      return;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Image size must be less than 5MB");
      return;
    }

    setAvatarFile(file);
    setAvatarError("");

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setAvatarImage(img);
        // Set initial crop to center square (400x400 preview area)
        const previewSize = 400;
        // Calculate how image will be displayed (fit to container)
        const imageAspect = img.width / img.height;
        let displayedWidth, displayedHeight;
        if (imageAspect > 1) {
          // Wider than tall
          displayedWidth = previewSize;
          displayedHeight = previewSize / imageAspect;
        } else {
          // Taller than wide
          displayedHeight = previewSize;
          displayedWidth = previewSize * imageAspect;
        }

        // Crop area should be square, centered
        const cropSize = Math.min(displayedWidth, displayedHeight);
        const cropX = (previewSize - cropSize) / 2;
        const cropY = (previewSize - cropSize) / 2;

        setAvatarCrop({
          x: cropX,
          y: cropY,
          width: cropSize,
          height: cropSize,
        });
        setAvatarPreview(e.target.result);
        setAvatarZoom(1);
        setAvatarPan({ x: 0, y: 0 });
        setShowPreviewModal(true);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const cropImage = (image, crop, zoom, pan, previewSize = 400) => {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // Calculate how image is displayed in preview (fit to 300x300)
      const imageAspect = image.width / image.height;
      let displayedWidth, displayedHeight;
      if (imageAspect > 1) {
        // Wider - fit to width
        displayedWidth = previewSize;
        displayedHeight = previewSize / imageAspect;
      } else {
        // Taller - fit to height
        displayedHeight = previewSize;
        displayedWidth = previewSize * imageAspect;
      }

      // Apply zoom
      const zoomedWidth = displayedWidth * zoom;
      const zoomedHeight = displayedHeight * zoom;

      // Calculate offset to center zoomed image
      const offsetX = (previewSize - zoomedWidth) / 2;
      const offsetY = (previewSize - zoomedHeight) / 2;

      // Convert crop from preview coordinates to image coordinates
      // Crop is relative to preview (0,0) at top-left
      const cropXInPreview = crop.x;
      const cropYInPreview = crop.y;
      const cropSizeInPreview = crop.width;

      // Adjust for zoom offset and pan
      const cropXAdjusted = cropXInPreview - offsetX - (pan?.x || 0);
      const cropYAdjusted = cropYInPreview - offsetY - (pan?.y || 0);

      // Scale to original image size
      const scaleToImage = image.width / zoomedWidth;
      const sourceX = Math.max(0, cropXAdjusted * scaleToImage);
      const sourceY = Math.max(0, cropYAdjusted * scaleToImage);
      const sourceSize = Math.min(
        cropSizeInPreview * scaleToImage,
        image.width - sourceX,
        image.height - sourceY,
        Math.min(image.width, image.height) // Ensure square
      );

      // Output size - smaller for better storage (128x128 is plenty for avatars)
      const outputSize = 128;
      canvas.width = outputSize;
      canvas.height = outputSize;

      // Draw cropped and resized
      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        outputSize,
        outputSize
      );

      // Convert to blob with compression (JPEG is smaller than PNG)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const url = URL.createObjectURL(blob);
          resolve(url);
        },
        "image/jpeg",
        0.85
      ); // JPEG at 85% quality for smaller file size
    });
  };

  const handleDeleteAvatar = async () => {
    try {
      setAvatarError("");
      const response = await axios.delete(`${API_BASE_URL}/api/avatars`);

      if (response.data.success) {
        // Revoke old blob URL if it exists
        if (avatar && avatar.startsWith("blob:")) {
          URL.revokeObjectURL(avatar);
        }

        // Set to default avatar immediately
        const callback = onAvatarChangeRef.current;
        if (callback && typeof callback === "function") {
          try {
            await callback("/img/default-avatar.jpg");
          } catch (err) {
            console.error("Error in onAvatarChange:", err);
          }
        }

        // Clear recent avatars
        if (onRecentAvatarsChange) {
          onRecentAvatarsChange([]);
        }

        setAvatarSuccess(
          "Avatar deleted successfully. Reverted to default avatar."
        );
        setShowDeleteConfirm(false);

        // Notify parent to refresh avatar from server
        if (onAvatarUploaded) {
          setTimeout(() => {
            onAvatarUploaded();
          }, 200);
        }
      } else {
        throw new Error(response.data.error || "Failed to delete avatar");
      }
    } catch (err) {
      console.error("Error deleting avatar:", err);
      setAvatarError(
        err.response?.data?.error ||
          "Failed to delete avatar. Please try again."
      );
      setShowDeleteConfirm(false);
    }
  };

  const handleAvatarUpload = async () => {
    if (!avatarFile || !avatarPreview || !avatarImage) {
      setAvatarError("Please select an image first");
      return;
    }

    setAvatarUploading(true);
    setAvatarError("");

    try {
      const croppedImageUrl = await cropImage(
        avatarImage,
        avatarCrop,
        avatarZoom,
        avatarPan
      );

      if (!croppedImageUrl) {
        throw new Error("Failed to crop image");
      }

      console.log("Image cropped, converting to base64...");

      // Convert blob URL to base64 for storage
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();

      // Convert blob to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          console.log("Base64 conversion complete");
          resolve(reader.result);
        };
        reader.onerror = (err) => {
          console.error("FileReader error:", err);
          reject(new Error("Failed to read image"));
        };
        reader.readAsDataURL(blob);
      });

      console.log("Base64 ready, uploading to server...", {
        base64Length: base64.length,
      });

      // Upload to server
      const uploadResponse = await axios.post(`${API_BASE_URL}/api/avatars`, {
        avatar: base64,
      });

      if (uploadResponse.data.success) {
        // Update avatar URL
        const avatarUrl = uploadResponse.data.avatarUrl;
        const callback = onAvatarChangeRef.current;
        if (callback && typeof callback === "function") {
          try {
            await callback(avatarUrl);
          } catch (err) {
            console.error("Error in onAvatarChange:", err);
          }
        }

        // Update recent avatars from server response
        const serverRecentAvatars = uploadResponse.data.recentAvatars || [];
        if (onRecentAvatarsChange) {
          onRecentAvatarsChange(serverRecentAvatars);
        }
      } else {
        throw new Error(uploadResponse.data.error || "Failed to upload avatar");
      }

      // Show success message (persists until page is left)
      setAvatarSuccess("Avatar uploaded successfully!");
      setAvatarUploading(false);

      // Close modal and reset state
      setShowPreviewModal(false);
      setAvatarPreview(null);
      setAvatarFile(null);
      setAvatarImage(null);
      setAvatarCrop({ x: 0, y: 0, width: 200, height: 200 });
      setAvatarZoom(1);
      setAvatarPan({ x: 0, y: 0 });

      // Clean up blob URL
      URL.revokeObjectURL(croppedImageUrl);

      // Reset file input
      const fileInput = document.getElementById("avatar-upload-input");
      if (fileInput) {
        fileInput.value = "";
      }

      // Notify parent to refresh avatar
      if (onAvatarUploaded) {
        setTimeout(() => {
          onAvatarUploaded();
        }, 200);
      }
    } catch (err) {
      console.error("Avatar upload error:", err);
      setAvatarError(`Failed to upload avatar: ${err.message}`);
      setAvatarUploading(false);
      // Keep modal open on error so user can try again
    }
  };

  const handleSaveGeneralSettings = async () => {
    if (!generalSettingsChanged) return;

    setGeneralSettingsSaving(true);
    try {
      if (onColorSchemeChange) {
        onColorSchemeChange(localColorScheme);
      }

      // Save log level if it changed
      if (localLogLevel !== logLevel) {
        try {
          const response = await axios.post(`${API_BASE_URL}/api/batch/log-level`, {
            logLevel: localLogLevel,
          });
          if (response.data.success) {
            setLogLevel(localLogLevel);
          }
        } catch (err) {
          console.error("Error setting log level:", err);
          throw new Error("Failed to save log level");
        }
      }

      setGeneralSettingsChanged(false);
      // Show success message
      setInstanceSuccess("General settings saved successfully!");
      setTimeout(() => {
        setInstanceSuccess("");
      }, 3000);
    } catch (err) {
      console.error("Error saving general settings:", err);
      setInstanceError("Failed to save general settings. Please try again.");
      setTimeout(() => {
        setInstanceError("");
      }, 3000);
    } finally {
      setGeneralSettingsSaving(false);
    }
  };

  const handleSelectAvatar = async (avatarUrl) => {
    // If selecting default avatar, just update the state
    if (avatarUrl === "/img/default-avatar.jpg") {
      const callback = onAvatarChangeRef.current;
      if (callback && typeof callback === "function") {
        await callback(avatarUrl);
      }
      return;
    }

    // If selecting a recent avatar, set it as current on the server
    if (avatarUrl.startsWith("/api/avatars/recent/")) {
      try {
        const filename = avatarUrl.split("/").pop();
        const response = await axios.post(
          `${API_BASE_URL}/api/avatars/set-current`,
          {
            filename: filename,
          }
        );

        if (response.data.success) {
          // Fetch the updated avatar
          const avatarResponse = await axios.get(
            `${API_BASE_URL}/api/avatars`,
            {
              responseType: "blob",
            }
          );
          const blobUrl = URL.createObjectURL(avatarResponse.data);

          if (onAvatarChange) {
            onAvatarChange(blobUrl);
          }

          // Refresh recent avatars
          if (onRecentAvatarsChange) {
            const recentResponse = await axios.get(
              `${API_BASE_URL}/api/avatars/recent`
            );
            if (recentResponse.data.success) {
              onRecentAvatarsChange(recentResponse.data.avatars || []);
            }
          }
        }
      } catch (err) {
        console.error("Error setting avatar as current:", err);
        // Fallback: just fetch and display
        try {
          const response = await axios.get(`${API_BASE_URL}${avatarUrl}`, {
            responseType: "blob",
          });
          const blobUrl = URL.createObjectURL(response.data);
          const callback = onAvatarChangeRef.current;
          if (callback && typeof callback === "function") {
            await callback(blobUrl);
          }
        } catch (fetchErr) {
          console.error("Error loading avatar:", fetchErr);
        }
      }
    } else {
      // For other URLs, just set directly
      const callback = onAvatarChangeRef.current;
      if (callback && typeof callback === "function") {
        await callback(avatarUrl);
      }
    }
  };

  return (
    <>
      {isFirstLogin && (
        <div className="first-login-warning">
          <h2>
            <AlertTriangle size={20} style={{ display: "inline-block", verticalAlign: "middle", marginRight: "8px" }} />
            First Time Login
          </h2>
          <p>You must change your password before accessing the application.</p>
        </div>
      )}

      {!showUserInfoAboveTabs && (
        <div className="settings-sections">
          {currentActiveSection === "general" && (
            <div className="update-section">
              <h3>General Settings</h3>
              <form
                className="update-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveGeneralSettings();
                }}
              >
                <div className="form-group">
                  <label htmlFor="colorScheme">Color Scheme Preference</label>
                  <div className="color-scheme-toggle">
                    <button
                      type="button"
                      className={`color-scheme-option ${
                        localColorScheme === "system" ? "active" : ""
                      }`}
                      onClick={() => {
                        setLocalColorScheme("system");
                        setGeneralSettingsChanged(true);
                      }}
                    >
                      <span className="color-scheme-icon">
                        <Monitor size={16} />
                      </span>
                      <span>System</span>
                    </button>
                    <button
                      type="button"
                      className={`color-scheme-option ${
                        localColorScheme === "light" ? "active" : ""
                      }`}
                      onClick={() => {
                        setLocalColorScheme("light");
                        setGeneralSettingsChanged(true);
                      }}
                    >
                      <span className="color-scheme-icon">
                        <Sun size={16} />
                      </span>
                      <span>Light</span>
                    </button>
                    <button
                      type="button"
                      className={`color-scheme-option ${
                        localColorScheme === "dark" ? "active" : ""
                      }`}
                      onClick={() => {
                        setLocalColorScheme("dark");
                        setGeneralSettingsChanged(true);
                      }}
                    >
                      <span className="color-scheme-icon">
                        <Moon size={16} />
                      </span>
                      <span>Dark</span>
                    </button>
                  </div>
                  <small>
                    Choose how the application theme is determined. "System"
                    will follow your browser or operating system preference.
                  </small>
                </div>
                <div className="form-group">
                  <label htmlFor="logLevel">Batch Logging Level</label>
                  <div className="color-scheme-toggle batch-logging-toggle">
                    <button
                      type="button"
                      className={`color-scheme-option ${
                        localLogLevel === "info" ? "active" : ""
                      }`}
                      onClick={() => handleLogLevelChange("info")}
                    >
                      <span className="color-scheme-icon">
                        <Info size={16} />
                      </span>
                      <span>Info</span>
                    </button>
                    <button
                      type="button"
                      className={`color-scheme-option ${
                        localLogLevel === "debug" ? "active" : ""
                      }`}
                      onClick={() => handleLogLevelChange("debug")}
                    >
                      <span className="color-scheme-icon">
                        <Search size={16} />
                      </span>
                      <span>Debug</span>
                    </button>
                  </div>
                  <small>
                    Control the verbosity of batch job logs. "Info" shows core events (job starts, completions, errors). "Debug" includes detailed scheduling and comparison information.
                  </small>
                </div>
                {instanceError && (
                  <div className="error-message">{instanceError}</div>
                )}
                {instanceSuccess && (
                  <div className="success-message">{instanceSuccess}</div>
                )}
                <div className="form-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!generalSettingsChanged || generalSettingsSaving}
                  >
                    {generalSettingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
              <div style={{ marginTop: "30px", paddingTop: "30px", borderTop: "1px solid var(--border-color)" }}>
                <h4 style={{ marginBottom: "15px", color: "var(--text-primary)" }}>Data Management</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "600px" }}>
                  <div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!onClearPortainerData) {
                          alert("Error: Clear Portainer Data handler is not available. Please refresh the page.");
                          return;
                        }
                        setClearingPortainerData(true);
                        onClearPortainerData()
                          .then(() => {
                            setClearingPortainerData(false);
                          })
                          .catch((error) => {
                            console.error("Error clearing Portainer data:", error);
                            alert("Error clearing Portainer data: " + (error.message || "Unknown error"));
                            setClearingPortainerData(false);
                          });
                      }}
                      disabled={clearingPortainerData}
                      className="update-button danger-button"
                      style={{
                        padding: "10px 20px",
                        fontSize: "1rem",
                        marginTop: 0,
                        width: "auto",
                        alignSelf: "flex-start",
                        cursor: "pointer",
                        pointerEvents: "auto",
                        zIndex: 10,
                        position: "relative",
                      }}
                    >
                      {clearingPortainerData ? "Clearing..." : "Clear Portainer Data"}
                    </button>
                    <small style={{ 
                      display: "block", 
                      marginTop: "8px", 
                      color: "var(--text-secondary)",
                      fontSize: "0.85rem",
                      lineHeight: "1.4"
                    }}>
                      Removes all cached container information from Portainer instances. This will clear container data, stacks, and unused images until you pull again. Portainer instance configurations will be preserved.
                    </small>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!onClearTrackedAppData) {
                          alert("Error: Clear Tracked App Data handler is not available. Please refresh the page.");
                          return;
                        }
                        setClearingTrackedAppData(true);
                        onClearTrackedAppData()
                          .then(() => {
                            setClearingTrackedAppData(false);
                          })
                          .catch((error) => {
                            console.error("Error clearing tracked app data:", error);
                            alert("Error clearing tracked app data: " + (error.message || "Unknown error"));
                            setClearingTrackedAppData(false);
                          });
                      }}
                      disabled={clearingTrackedAppData}
                      className="update-button danger-button"
                      style={{
                        padding: "10px 20px",
                        fontSize: "1rem",
                        marginTop: 0,
                        width: "auto",
                        alignSelf: "flex-start",
                        cursor: "pointer",
                        pointerEvents: "auto",
                        zIndex: 10,
                        position: "relative",
                      }}
                    >
                      {clearingTrackedAppData ? "Clearing..." : "Clear Tracked Application Data"}
                    </button>
                    <small style={{ 
                      display: "block", 
                      marginTop: "8px", 
                      color: "var(--text-secondary)",
                      fontSize: "0.85rem",
                      lineHeight: "1.4"
                    }}>
                      Clears the latest version data for all tracked apps. This will reset the "Latest" version information and force fresh data to be fetched on the next check. Your tracked app configurations will be preserved.
                    </small>
                  </div>
                </div>
              </div>
            </div>
          )}
          {currentActiveSection === "username" && (
            <div className="update-section">
              <h3>Change Username</h3>
              <form onSubmit={handleUsernameSubmit} className="update-form">
                <div className="form-group">
                  <label htmlFor="newUsername">New Username</label>
                  <input
                    type="text"
                    id="newUsername"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    required
                    autoComplete="username"
                    disabled={usernameLoading}
                    minLength={3}
                  />
                  <small>Must be at least 3 characters long</small>
                </div>
                <div className="form-group">
                  <label htmlFor="usernamePassword">Current Password</label>
                  <input
                    type="password"
                    id="usernamePassword"
                    value={usernamePassword}
                    onChange={(e) => setUsernamePassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    disabled={usernameLoading}
                  />
                  <small>Enter your current password to confirm</small>
                </div>
                {usernameError && (
                  <div className="error-message">{usernameError}</div>
                )}
                {usernameSuccess && (
                  <div className="success-message">{usernameSuccess}</div>
                )}
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    usernameLoading || !newUsername || !usernamePassword
                  }
                >
                  {usernameLoading ? "Updating..." : "Update Username"}
                </button>
              </form>
            </div>
          )}

          {currentActiveSection === "password" && (
            <div className="update-section">
              <h3>Change Password</h3>
              <form onSubmit={handlePasswordSubmit} className="update-form">
                {!isFirstLogin && (
                  <div className="form-group">
                    <label htmlFor="currentPassword">Current Password</label>
                    <input
                      type="password"
                      id="currentPassword"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      disabled={passwordLoading}
                    />
                  </div>
                )}
                {isFirstLogin && (
                  <div className="form-group">
                    <label htmlFor="currentPassword">Current Password</label>
                    <input
                      type="password"
                      id="currentPassword"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      disabled={passwordLoading}
                    />
                    <small>Enter your current password to change it</small>
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="newPassword">New Password</label>
                  <input
                    type="password"
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    disabled={passwordLoading}
                    minLength={6}
                  />
                  <small>Must be at least 6 characters long</small>
                </div>
                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm New Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    disabled={passwordLoading}
                    minLength={6}
                  />
                </div>
                {passwordError && (
                  <div className="error-message">{passwordError}</div>
                )}
                {passwordSuccess && (
                  <div className="success-message">{passwordSuccess}</div>
                )}
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    passwordLoading ||
                    !newPassword ||
                    !confirmPassword ||
                    (!isFirstLogin && !currentPassword)
                  }
                >
                  {passwordLoading ? "Updating..." : "Update Password"}
                </button>
              </form>
            </div>
          )}

          {currentActiveSection === "portainer" && (
            <div className="update-section">
              <h3>Manage Portainer Instances</h3>
              <p
                style={{ color: "var(--text-secondary)", marginBottom: "20px" }}
              >
                Manage your Portainer instances. Add new instances from the home
                page.
              </p>

              <div style={{ marginTop: "20px" }}>
                <h4
                  style={{ color: "var(--text-primary)", marginBottom: "15px" }}
                >
                  Existing Instances
                </h4>
                {portainerInstances.length === 0 ? (
                  <div
                    className="empty-state"
                    style={{ padding: "20px", textAlign: "center" }}
                  >
                    <p>
                      No Portainer instances configured. Add one from the home
                      page to get started.
                    </p>
                  </div>
                ) : (
                  <div className="instances-list">
                    {portainerInstances.map((instance) => (
                      <div
                        key={instance.id}
                        className="instance-item"
                        style={{
                          background: "var(--bg-secondary)",
                          padding: "15px",
                          borderRadius: "8px",
                          marginBottom: "10px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              marginBottom: "5px",
                            }}
                          >
                            <strong style={{ color: "var(--text-primary)" }}>
                              {instance.name}
                            </strong>
                            {instance.auth_type === "apikey" ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  fontSize: "0.75rem",
                                  fontWeight: "600",
                                  background: "rgba(30, 136, 229, 0.15)",
                                  color: "var(--dodger-blue)",
                                  border: "1px solid var(--dodger-blue)",
                                }}
                              >
                                🔑 API Key
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  fontSize: "0.75rem",
                                  fontWeight: "600",
                                  background: "rgba(0, 90, 156, 0.15)",
                                  color: "var(--dodger-blue)",
                                  border: "1px solid var(--dodger-blue)",
                                }}
                              >
                                <Lock size={14} style={{ display: "inline-block", verticalAlign: "middle", marginRight: "4px" }} />
                                Username / Password
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              color: "var(--text-secondary)",
                              fontSize: "0.9rem",
                              marginTop: "5px",
                            }}
                          >
                            {instance.url}
                          </div>
                          {instance.auth_type === "password" &&
                            instance.username && (
                              <div
                                style={{
                                  color: "var(--text-tertiary)",
                                  fontSize: "0.85rem",
                                  marginTop: "3px",
                                }}
                              >
                                Username: {instance.username}
                              </div>
                            )}
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                          <button
                            onClick={() => {
                              if (onEditInstance) {
                                onEditInstance(instance);
                              } else {
                                handleEditInstance(instance);
                              }
                            }}
                            className="update-button"
                            title="Edit"
                            style={{ 
                              padding: "8px 16px", 
                              fontSize: "0.9rem",
                              lineHeight: "1.5",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 0,
                              boxSizing: "border-box",
                              height: "auto",
                              minHeight: 0,
                              borderWidth: "1px",
                              fontWeight: "600",
                              background: "rgba(128, 128, 128, 0.2)",
                              borderColor: "var(--text-secondary)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteInstance(instance.id)}
                            className="update-button danger-button"
                            title="Delete"
                            style={{
                              padding: "8px 16px",
                              fontSize: "0.9rem",
                              lineHeight: "1.5",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 0,
                              boxSizing: "border-box",
                              height: "auto",
                              minHeight: 0,
                              borderWidth: "1px",
                              fontWeight: "600",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {currentActiveSection === "avatar" && (
            <div className="update-section">
              <h3>Avatar Settings</h3>

              {avatarError && (
                <div className="error-message" style={{ marginBottom: "16px" }}>
                  {avatarError}
                </div>
              )}
              {avatarSuccess && (
                <div
                  className="success-message"
                  style={{ marginBottom: "16px" }}
                >
                  {avatarSuccess}
                </div>
              )}

              {/* Upload New Avatar */}
              <div className="form-group">
                <label
                  style={{
                    display: "block",
                    marginBottom: "12px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                  }}
                >
                  Upload New Avatar
                </label>
                <div
                  style={{
                    border: "2px dashed var(--border-color)",
                    borderRadius: "12px",
                    padding: "24px",
                    textAlign: "center",
                    background: "var(--bg-secondary)",
                    transition: "all 0.3s",
                    marginBottom: "16px",
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarFileSelect}
                    id="avatar-upload-input"
                    style={{ display: "none" }}
                  />
                  <label
                    htmlFor="avatar-upload-input"
                    className="avatar-button-label"
                    style={{
                      display: "inline-block",
                      padding: "12px 24px",
                      background: "rgba(30, 144, 255, 0.2)",
                      color: "var(--dodger-blue)",
                      border: "1px solid var(--dodger-blue)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "1rem",
                      fontWeight: "600",
                      transition: "all 0.3s",
                      width: "auto",
                      minWidth: "140px",
                      textAlign: "center",
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = "rgba(30, 144, 255, 0.3)";
                      e.target.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = "rgba(30, 144, 255, 0.2)";
                      e.target.style.transform = "translateY(0)";
                    }}
                  >
                    Choose Image
                  </label>
                  <small
                    style={{
                      display: "block",
                      color: "var(--text-secondary)",
                      marginTop: "12px",
                    }}
                  >
                    Max size: 5MB. Image will be cropped to square
                    automatically.
                  </small>
                </div>
              </div>

              {/* Preview & Adjust Modal */}
              {showPreviewModal && avatarPreview && avatarImage && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "rgba(0, 0, 0, 0.7)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                  }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) {
                      setShowPreviewModal(false);
                    }
                  }}
                >
                  <div
                    style={{
                      background: "var(--bg-primary)",
                      padding: "24px",
                      borderRadius: "12px",
                      maxWidth: "600px",
                      width: "90%",
                      maxHeight: "90vh",
                      overflow: "auto",
                      border: "1px solid var(--border-color)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "20px",
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          color: "var(--text-primary)",
                        }}
                      >
                        Preview & Adjust
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPreviewModal(false);
                          setAvatarPreview(null);
                          setAvatarFile(null);
                          setAvatarImage(null);
                          setAvatarCrop({
                            x: 0,
                            y: 0,
                            width: 200,
                            height: 200,
                          });
                          setAvatarZoom(1);
                          setAvatarPan({ x: 0, y: 0 });
                          setAvatarError("");
                          const fileInput = document.getElementById(
                            "avatar-upload-input"
                          );
                          if (fileInput) {
                            fileInput.value = "";
                          }
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--text-secondary)",
                          fontSize: "24px",
                          cursor: "pointer",
                          padding: "0",
                          width: "20px",
                          height: "20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "18px",
                        }}
                      >
                        ×
                      </button>
                    </div>

                    <div
                      style={{
                        position: "relative",
                        display: "inline-block",
                        border: "2px solid var(--border-color)",
                        borderRadius: "12px",
                        overflow: "hidden",
                        background: "var(--bg-tertiary)",
                        marginBottom: "20px",
                        width: "100%",
                        maxWidth: "400px",
                      }}
                    >
                      <div
                        style={{
                          position: "relative",
                          width: "400px",
                          height: "400px",
                          overflow: "hidden",
                          background: "var(--bg-tertiary)",
                          cursor: isDragging ? "grabbing" : "grab",
                        }}
                        onMouseDown={(e) => {
                          setIsDragging(true);
                          setDragStart({
                            x: e.clientX - avatarPan.x,
                            y: e.clientY - avatarPan.y,
                          });
                        }}
                        onMouseMove={(e) => {
                          if (isDragging) {
                            setAvatarPan({
                              x: e.clientX - dragStart.x,
                              y: e.clientY - dragStart.y,
                            });
                          }
                        }}
                        onMouseUp={() => setIsDragging(false)}
                        onMouseLeave={() => setIsDragging(false)}
                      >
                        {avatarImage &&
                          (() => {
                            const aspect =
                              avatarImage.width / avatarImage.height;
                            let displayedWidth, displayedHeight;
                            if (aspect > 1) {
                              displayedWidth = 400;
                              displayedHeight = 400 / aspect;
                            } else {
                              displayedHeight = 400;
                              displayedWidth = 400 * aspect;
                            }
                            const zoomedWidth = displayedWidth * avatarZoom;
                            const zoomedHeight = displayedHeight * avatarZoom;
                            const offsetX =
                              (400 - zoomedWidth) / 2 + avatarPan.x;
                            const offsetY =
                              (400 - zoomedHeight) / 2 + avatarPan.y;

                            return (
                              <img
                                src={avatarPreview}
                                alt="Preview"
                                draggable={false}
                                style={{
                                  position: "absolute",
                                  left: `${offsetX}px`,
                                  top: `${offsetY}px`,
                                  width: `${zoomedWidth}px`,
                                  height: `${zoomedHeight}px`,
                                  objectFit: "contain",
                                  pointerEvents: "none",
                                }}
                              />
                            );
                          })()}
                        {/* Crop overlay - square in center */}
                        <div
                          style={{
                            position: "absolute",
                            border: "3px solid var(--dodger-blue)",
                            borderRadius: "8px",
                            pointerEvents: "none",
                            left: `${avatarCrop.x}px`,
                            top: `${avatarCrop.y}px`,
                            width: `${avatarCrop.width}px`,
                            height: `${avatarCrop.height}px`,
                            boxSizing: "border-box",
                            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
                          }}
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: "block",
                            marginBottom: "8px",
                            fontSize: "0.9rem",
                            color: "var(--text-primary)",
                            fontWeight: "500",
                          }}
                        >
                          Zoom:{" "}
                          <span
                            style={{
                              color: "var(--dodger-blue)",
                              fontWeight: "600",
                            }}
                          >
                            {Math.round(avatarZoom * 100)}%
                          </span>
                        </label>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.1"
                          value={avatarZoom}
                          onChange={(e) =>
                            setAvatarZoom(parseFloat(e.target.value))
                          }
                          style={{
                            width: "100%",
                            accentColor: "var(--dodger-blue)",
                          }}
                        />
                      </div>
                      <p
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "0.85rem",
                          margin: 0,
                        }}
                      >
                        Drag the image to adjust position. Use zoom to resize.
                      </p>
                      <div style={{ display: "flex", gap: "12px" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleAvatarUpload();
                          }}
                          disabled={avatarUploading}
                          className="primary-button"
                          style={{ flex: 1 }}
                        >
                          {avatarUploading ? "Processing..." : "Upload Avatar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowPreviewModal(false);
                            setAvatarPreview(null);
                            setAvatarFile(null);
                            setAvatarImage(null);
                            setAvatarCrop({
                              x: 0,
                              y: 0,
                              width: 200,
                              height: 200,
                            });
                            setAvatarZoom(1);
                            setAvatarPan({ x: 0, y: 0 });
                            setAvatarError("");
                            const fileInput = document.getElementById(
                              "avatar-upload-input"
                            );
                            if (fileInput) {
                              fileInput.value = "";
                            }
                          }}
                          className="update-button"
                          style={{
                            flex: 1,
                            background: "transparent",
                            border: "2px solid var(--border-color)",
                            color: "var(--text-primary)",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Delete Avatar */}
              <div style={{ marginTop: "32px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "8px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                  }}
                >
                  Delete Avatar
                </label>
                <small
                  style={{
                    display: "block",
                    color: "var(--text-secondary)",
                    marginBottom: "12px",
                  }}
                >
                  Delete your current avatar. It will revert to the default
                  avatar.
                </small>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="update-button danger-button avatar-delete-button"
                  style={{
                    padding: "10px 20px",
                    fontSize: "1rem",
                    marginTop: 0,
                    display: "inline-block",
                    width: "auto",
                    alignSelf: "flex-start",
                  }}
                >
                  Delete Avatar
                </button>
              </div>

              {/* Delete Confirmation Modal */}
              {showDeleteConfirm && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "rgba(0, 0, 0, 0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                  }}
                >
                  <div
                    style={{
                      background: "var(--bg-primary)",
                      padding: "24px",
                      borderRadius: "12px",
                      maxWidth: "400px",
                      width: "90%",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>
                      Delete Avatar?
                    </h3>
                    <p
                      style={{
                        color: "var(--text-secondary)",
                        marginBottom: "24px",
                      }}
                    >
                      This will delete your current avatar and revert to the
                      default avatar. This action cannot be undone.
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: "12px",
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="update-button"
                        style={{
                          background: "transparent",
                          borderColor: "var(--border-color)",
                          color: "var(--text-primary)",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteAvatar}
                        className="update-button danger-button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentActiveSection === "dockerhub" && (
            <div className="update-section">
              <h3>Docker Hub Authentication</h3>
              <div
                style={{
                  background: "var(--bg-secondary)",
                  padding: "20px",
                  borderRadius: "8px",
                  marginBottom: "20px",
                  border: "1px solid var(--border-color)",
                }}
              >
                <h4 style={{ marginTop: 0, color: "var(--text-primary)", marginBottom: "12px" }}>
                  What is this used for?
                </h4>
                <p
                  style={{
                    color: "var(--text-secondary)",
                    lineHeight: "1.6",
                    marginBottom: "15px",
                    paddingBottom: "5px",
                  }}
                >
                  Docker Hub authentication allows the application to use your
                  personal account's rate limits instead of anonymous IP-based
                  limits when checking for container updates.
                </p>
                <h4 style={{ color: "var(--text-primary)" }}>Benefits:</h4>
                <ul
                  style={{
                    color: "var(--text-secondary)",
                    lineHeight: "1.6",
                    marginBottom: 0,
                    paddingLeft: "20px",
                  }}
                >
                  <li>
                    <strong>Higher Rate Limits:</strong> Authenticated users get
                    200 API requests per 6 hours vs 100 for anonymous users
                  </li>
                  <li>
                    <strong>Faster Updates:</strong> With higher limits, the
                    application can check more containers without hitting rate
                    limits
                  </li>
                  <li>
                    <strong>Reduced Errors:</strong> Fewer 429 (rate limit)
                    errors means more reliable update detection
                  </li>
                  <li>
                    <strong>Better Performance:</strong> Shorter delays between
                    API calls (500ms vs 1000ms) when authenticated
                  </li>
                </ul>
                <p
                  style={{
                    color: "var(--text-tertiary)",
                    fontSize: "0.9rem",
                    marginTop: "10px",
                    marginBottom: 0,
                    fontStyle: "italic",
                  }}
                >
                  <strong>Note:</strong> Your credentials are stored securely in
                  the database and only used for Docker Hub API authentication.
                  You can create a Personal Access Token at{" "}
                  <a
                    href="https://hub.docker.com/settings/security"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--dodger-blue)" }}
                  >
                    hub.docker.com
                  </a>
                  .
                </p>
              </div>

              {dockerHubSuccess && (
                <div className="success-message" style={{ marginBottom: "20px" }}>
                  {dockerHubSuccess}
                </div>
              )}

              {dockerHubCredentials ? (
                <div
                  style={{
                    background: "var(--bg-secondary)",
                    padding: "15px",
                    borderRadius: "8px",
                    marginBottom: "20px",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ color: "var(--text-primary)" }}>
                        Current Configuration
                      </strong>
                      <div
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "0.9rem",
                          marginTop: "5px",
                        }}
                      >
                        Username: {dockerHubCredentials.username}
                      </div>
                      <div
                        style={{
                          color: "var(--text-tertiary)",
                          fontSize: "0.85rem",
                          marginTop: "3px",
                        }}
                      >
                        {dockerHubCredentials.hasToken
                          ? "✓ Token configured"
                          : "✗ No token"}
                        {dockerHubCredentials.updated_at && (
                          <span style={{ marginLeft: "10px" }}>
                            • Last updated:{" "}
                            {new Date(
                              dockerHubCredentials.updated_at
                            ).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        onClick={() => setShowDockerHubModal(true)}
                        className="update-button"
                        title="Edit"
                        style={{
                          padding: "8px 16px",
                          fontSize: "0.9rem",
                          lineHeight: "1.5",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginTop: 0,
                          boxSizing: "border-box",
                          height: "auto",
                          minHeight: 0,
                          borderWidth: "1px",
                          fontWeight: "600",
                          background: "rgba(128, 128, 128, 0.2)",
                          borderColor: "var(--text-secondary)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={handleDeleteDockerHubCreds}
                        className="update-button danger-button"
                        title="Delete"
                        style={{
                          padding: "8px 16px",
                          fontSize: "0.9rem",
                          lineHeight: "1.5",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginTop: 0,
                          boxSizing: "border-box",
                          height: "auto",
                          minHeight: 0,
                          borderWidth: "1px",
                          fontWeight: "600",
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: "var(--bg-secondary)",
                    padding: "20px",
                    borderRadius: "8px",
                    marginBottom: "20px",
                    border: "1px solid var(--border-color)",
                    textAlign: "center",
                  }}
                >
                  <p
                    style={{
                      color: "var(--text-secondary)",
                      marginBottom: "15px",
                    }}
                  >
                    No Docker Hub credentials configured. Add credentials to
                    increase your rate limits.
                  </p>
                  <button
                    onClick={() => setShowDockerHubModal(true)}
                    className="primary-button"
                    style={{
                      padding: "10px 20px",
                      fontSize: "1rem",
                    }}
                  >
                    Create Entry
                  </button>
                </div>
              )}

              <DockerHubCredsModal
                isOpen={showDockerHubModal}
                onClose={() => setShowDockerHubModal(false)}
                onSuccess={handleDockerHubModalSuccess}
                existingCredentials={dockerHubCredentials}
              />
            </div>
          )}

          {currentActiveSection === "batch" && (
            <div className="update-section">
              <h3>Batch Processing Configuration</h3>

              <form onSubmit={handleBatchConfigSubmit} className="update-form">
                {/* Docker Hub Scan Configuration */}
                <div style={{ marginBottom: "30px" }}>
                  <h4
                    style={{
                      marginTop: 0,
                      marginBottom: "20px",
                      color: "var(--text-primary)",
                    }}
                  >
                    Docker Hub Scan
                  </h4>
                  <div className="form-group" style={{ marginTop: 0 }}>
                    <label
                      htmlFor="dockerHubScanEnabled"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        id="dockerHubScanEnabled"
                        checked={batchConfigs["docker-hub-pull"].enabled}
                        onChange={(e) => {
                          const updatedConfigs = { ...batchConfigs };
                          updatedConfigs["docker-hub-pull"].enabled =
                            e.target.checked;
                          setBatchConfigs(updatedConfigs);
                        }}
                        disabled={batchLoading["docker-hub-pull"]}
                        style={{
                          width: "20px",
                          height: "20px",
                          cursor: "pointer",
                        }}
                      />
                      <span
                        style={{
                          fontWeight: "600",
                          color: "var(--text-primary)",
                        }}
                      >
                        Enable Docker Hub Scan
                      </span>
                    </label>
                    <small
                      style={{
                        color: "var(--text-secondary)",
                        lineHeight: "1.5",
                        display: "block",
                        marginTop: "4px",
                        paddingLeft: "32px",
                      }}
                    >
                      Fetches container update information from Docker Hub at
                      defined interval. Respects Docker Hub rate limits.
                    </small>
                  </div>

                  {batchConfigs["docker-hub-pull"].enabled && (
                    <div className="form-group" style={{ marginTop: "20px" }}>
                      <label htmlFor="dockerHubScanInterval" style={{ paddingLeft: "32px" }}>
                        Update Interval
                      </label>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                          paddingLeft: "32px",
                        }}
                      >
                        <input
                          type="text"
                          inputMode="numeric"
                          id="dockerHubScanInterval"
                          value={batchConfigs["docker-hub-pull"].intervalValue}
                          onKeyPress={(e) => {
                            if (
                              !/[0-9]/.test(e.key) &&
                              e.key !== "Backspace" &&
                              e.key !== "Delete" &&
                              e.key !== "ArrowLeft" &&
                              e.key !== "ArrowRight" &&
                              e.key !== "Tab"
                            ) {
                              e.preventDefault();
                            }
                          }}
                          onChange={(e) => {
                            const inputValue = e.target.value.replace(
                              /[^0-9]/g,
                              ""
                            );
                            if (inputValue === "") {
                              const updatedConfigs = { ...batchConfigs };
                              updatedConfigs["docker-hub-pull"].intervalValue =
                                "";
                              setBatchConfigs(updatedConfigs);
                              return;
                            }
                            const numValue = parseInt(inputValue, 10);
                            if (isNaN(numValue)) return;
                            const max =
                              batchConfigs["docker-hub-pull"].intervalUnit ===
                              "hours"
                                ? 24
                                : 1440;
                            const validatedValue = Math.max(
                              1,
                              Math.min(numValue, max)
                            );
                            const updatedConfigs = { ...batchConfigs };
                            updatedConfigs["docker-hub-pull"].intervalValue =
                              validatedValue;
                            const minutes =
                              updatedConfigs["docker-hub-pull"].intervalUnit ===
                              "hours"
                                ? validatedValue * 60
                                : validatedValue;
                            updatedConfigs["docker-hub-pull"].intervalMinutes =
                              minutes;
                            setBatchConfigs(updatedConfigs);
                          }}
                          onBlur={(e) => {
                            if (
                              e.target.value === "" ||
                              parseInt(e.target.value, 10) < 1
                            ) {
                              const updatedConfigs = { ...batchConfigs };
                              updatedConfigs[
                                "docker-hub-pull"
                              ].intervalValue = 1;
                              const minutes =
                                updatedConfigs["docker-hub-pull"]
                                  .intervalUnit === "hours"
                                  ? 60
                                  : 1;
                              updatedConfigs[
                                "docker-hub-pull"
                              ].intervalMinutes = minutes;
                              setBatchConfigs(updatedConfigs);
                            }
                          }}
                          required
                          disabled={batchLoading["docker-hub-pull"]}
                          style={{
                            width: "80px",
                            padding: "6px 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            fontSize: "14px",
                            textAlign: "center",
                            WebkitAppearance: "none",
                            MozAppearance: "textfield",
                          }}
                        />
                        <div className="batch-interval-toggle">
                          <button
                            type="button"
                            className={`batch-interval-option ${
                              batchConfigs["docker-hub-pull"].intervalUnit ===
                              "minutes"
                                ? "active"
                                : ""
                            }`}
                            onClick={() => {
                              if (
                                !batchLoading["docker-hub-pull"] &&
                                batchConfigs["docker-hub-pull"].intervalUnit !==
                                  "minutes"
                              ) {
                                const updatedConfigs = { ...batchConfigs };
                                const minutes =
                                  updatedConfigs["docker-hub-pull"]
                                    .intervalValue * 60;
                                updatedConfigs["docker-hub-pull"].intervalUnit =
                                  "minutes";
                                updatedConfigs[
                                  "docker-hub-pull"
                                ].intervalValue = minutes;
                                updatedConfigs[
                                  "docker-hub-pull"
                                ].intervalMinutes = minutes;
                                setBatchConfigs(updatedConfigs);
                              }
                            }}
                            disabled={batchLoading["docker-hub-pull"]}
                          >
                            Minutes
                          </button>
                          <button
                            type="button"
                            className={`batch-interval-option ${
                              batchConfigs["docker-hub-pull"].intervalUnit ===
                              "hours"
                                ? "active"
                                : ""
                            }`}
                            onClick={() => {
                              if (
                                !batchLoading["docker-hub-pull"] &&
                                batchConfigs["docker-hub-pull"].intervalUnit !==
                                  "hours"
                              ) {
                                const updatedConfigs = { ...batchConfigs };
                                const hours =
                                  Math.round(
                                    updatedConfigs["docker-hub-pull"]
                                      .intervalMinutes / 60
                                  ) || 1;
                                updatedConfigs["docker-hub-pull"].intervalUnit =
                                  "hours";
                                updatedConfigs[
                                  "docker-hub-pull"
                                ].intervalValue = hours;
                                setBatchConfigs(updatedConfigs);
                              }
                            }}
                            disabled={batchLoading["docker-hub-pull"]}
                          >
                            Hours
                          </button>
                        </div>
                      </div>
                      <small style={{ paddingLeft: "32px", display: "block" }}>
                        How often to fetch updates.{" "}
                        {batchConfigs["docker-hub-pull"].intervalUnit ===
                        "hours"
                          ? `Range: 1-24 hours (${
                              batchConfigs["docker-hub-pull"].intervalValue * 60
                            } minutes)`
                          : `Range: 1-1440 minutes (${
                              batchConfigs["docker-hub-pull"].intervalMinutes >=
                              60
                                ? `${(
                                    batchConfigs["docker-hub-pull"]
                                      .intervalMinutes / 60
                                  ).toFixed(1)} hours`
                                : `${batchConfigs["docker-hub-pull"].intervalMinutes} minutes`
                            })`}
                      </small>
                    </div>
                  )}
                </div>

                {/* Tracked Apps Scan Configuration */}
                <div style={{ marginBottom: "30px" }}>
                  <h4
                    style={{
                      marginTop: 0,
                      marginBottom: "20px",
                      color: "var(--text-primary)",
                    }}
                  >
                    Tracked Apps Scan
                  </h4>
                  <div className="form-group" style={{ marginTop: 0 }}>
                    <label
                      htmlFor="trackedAppsScanEnabled"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        id="trackedAppsScanEnabled"
                        checked={batchConfigs["tracked-apps-check"].enabled}
                        onChange={(e) => {
                          const updatedConfigs = { ...batchConfigs };
                          updatedConfigs["tracked-apps-check"].enabled =
                            e.target.checked;
                          setBatchConfigs(updatedConfigs);
                        }}
                        disabled={batchLoading["tracked-apps-check"]}
                        style={{
                          width: "20px",
                          height: "20px",
                          cursor: "pointer",
                        }}
                      />
                      <span
                        style={{
                          fontWeight: "600",
                          color: "var(--text-primary)",
                        }}
                      >
                        Enable Tracked Apps Scan
                      </span>
                    </label>
                    <small
                      style={{
                        color: "var(--text-secondary)",
                        lineHeight: "1.5",
                        display: "block",
                        marginTop: "4px",
                        paddingLeft: "32px",
                      }}
                    >
                      Automatically checks tracked GitHub repositories for new
                      releases at regular intervals. Keeps your tracked apps
                      up-to-date and notifies you when updates are available.
                    </small>
                  </div>

                  {batchConfigs["tracked-apps-check"].enabled && (
                    <div className="form-group" style={{ marginTop: "20px" }}>
                      <label htmlFor="trackedAppsScanInterval" style={{ paddingLeft: "32px" }}>
                        Update Interval
                      </label>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                          paddingLeft: "32px",
                        }}
                      >
                        <input
                          type="text"
                          inputMode="numeric"
                          id="trackedAppsScanInterval"
                          value={
                            batchConfigs["tracked-apps-check"].intervalValue
                          }
                          onKeyPress={(e) => {
                            if (
                              !/[0-9]/.test(e.key) &&
                              e.key !== "Backspace" &&
                              e.key !== "Delete" &&
                              e.key !== "ArrowLeft" &&
                              e.key !== "ArrowRight" &&
                              e.key !== "Tab"
                            ) {
                              e.preventDefault();
                            }
                          }}
                          onChange={(e) => {
                            const inputValue = e.target.value.replace(
                              /[^0-9]/g,
                              ""
                            );
                            if (inputValue === "") {
                              const updatedConfigs = { ...batchConfigs };
                              updatedConfigs[
                                "tracked-apps-check"
                              ].intervalValue = "";
                              setBatchConfigs(updatedConfigs);
                              return;
                            }
                            const numValue = parseInt(inputValue, 10);
                            if (isNaN(numValue)) return;
                            const max =
                              batchConfigs["tracked-apps-check"]
                                .intervalUnit === "hours"
                                ? 24
                                : 1440;
                            const validatedValue = Math.max(
                              1,
                              Math.min(numValue, max)
                            );
                            const updatedConfigs = { ...batchConfigs };
                            updatedConfigs["tracked-apps-check"].intervalValue =
                              validatedValue;
                            const minutes =
                              updatedConfigs["tracked-apps-check"]
                                .intervalUnit === "hours"
                                ? validatedValue * 60
                                : validatedValue;
                            updatedConfigs[
                              "tracked-apps-check"
                            ].intervalMinutes = minutes;
                            setBatchConfigs(updatedConfigs);
                          }}
                          onBlur={(e) => {
                            if (
                              e.target.value === "" ||
                              parseInt(e.target.value, 10) < 1
                            ) {
                              const updatedConfigs = { ...batchConfigs };
                              updatedConfigs[
                                "tracked-apps-check"
                              ].intervalValue = 1;
                              const minutes =
                                updatedConfigs["tracked-apps-check"]
                                  .intervalUnit === "hours"
                                  ? 60
                                  : 1;
                              updatedConfigs[
                                "tracked-apps-check"
                              ].intervalMinutes = minutes;
                              setBatchConfigs(updatedConfigs);
                            }
                          }}
                          required
                          disabled={batchLoading["tracked-apps-check"]}
                          style={{
                            width: "80px",
                            padding: "6px 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            fontSize: "14px",
                            textAlign: "center",
                            WebkitAppearance: "none",
                            MozAppearance: "textfield",
                          }}
                        />
                        <div className="batch-interval-toggle">
                          <button
                            type="button"
                            className={`batch-interval-option ${
                              batchConfigs["tracked-apps-check"]
                                .intervalUnit === "minutes"
                                ? "active"
                                : ""
                            }`}
                            onClick={() => {
                              if (
                                !batchLoading["tracked-apps-check"] &&
                                batchConfigs["tracked-apps-check"]
                                  .intervalUnit !== "minutes"
                              ) {
                                const updatedConfigs = { ...batchConfigs };
                                const minutes =
                                  updatedConfigs["tracked-apps-check"]
                                    .intervalValue * 60;
                                updatedConfigs[
                                  "tracked-apps-check"
                                ].intervalUnit = "minutes";
                                updatedConfigs[
                                  "tracked-apps-check"
                                ].intervalValue = minutes;
                                updatedConfigs[
                                  "tracked-apps-check"
                                ].intervalMinutes = minutes;
                                setBatchConfigs(updatedConfigs);
                              }
                            }}
                            disabled={batchLoading["tracked-apps-check"]}
                          >
                            Minutes
                          </button>
                          <button
                            type="button"
                            className={`batch-interval-option ${
                              batchConfigs["tracked-apps-check"]
                                .intervalUnit === "hours"
                                ? "active"
                                : ""
                            }`}
                            onClick={() => {
                              if (
                                !batchLoading["tracked-apps-check"] &&
                                batchConfigs["tracked-apps-check"]
                                  .intervalUnit !== "hours"
                              ) {
                                const updatedConfigs = { ...batchConfigs };
                                const hours =
                                  Math.round(
                                    updatedConfigs["tracked-apps-check"]
                                      .intervalMinutes / 60
                                  ) || 1;
                                updatedConfigs[
                                  "tracked-apps-check"
                                ].intervalUnit = "hours";
                                updatedConfigs[
                                  "tracked-apps-check"
                                ].intervalValue = hours;
                                setBatchConfigs(updatedConfigs);
                              }
                            }}
                            disabled={batchLoading["tracked-apps-check"]}
                          >
                            Hours
                          </button>
                        </div>
                      </div>
                      <small style={{ paddingLeft: "32px", display: "block" }}>
                        How often to check for updates.{" "}
                        {batchConfigs["tracked-apps-check"].intervalUnit ===
                        "hours"
                          ? `Range: 1-24 hours (${
                              batchConfigs["tracked-apps-check"].intervalValue *
                              60
                            } minutes)`
                          : `Range: 1-1440 minutes (${
                              batchConfigs["tracked-apps-check"]
                                .intervalMinutes >= 60
                                ? `${(
                                    batchConfigs["tracked-apps-check"]
                                      .intervalMinutes / 60
                                  ).toFixed(1)} hours`
                                : `${batchConfigs["tracked-apps-check"].intervalMinutes} minutes`
                            })`}
                      </small>
                    </div>
                  )}
                </div>

                {batchError && (
                  <div className="error-message">{batchError}</div>
                )}
                {batchSuccess && (
                  <div className="success-message">{batchSuccess}</div>
                )}
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    batchLoading["docker-hub-pull"] ||
                    batchLoading["tracked-apps-check"] ||
                    (batchConfigs["docker-hub-pull"].enabled &&
                      batchConfigs["docker-hub-pull"].intervalValue < 1) ||
                    (batchConfigs["tracked-apps-check"].enabled &&
                      batchConfigs["tracked-apps-check"].intervalValue < 1)
                  }
                >
                  {batchLoading["docker-hub-pull"] ||
                  batchLoading["tracked-apps-check"]
                    ? "Saving..."
                    : "Save Configuration"}
                </button>
              </form>
            </div>
          )}

          {currentActiveSection === "discord" && (
            <div className="update-section">
              <h3>Discord Notifications</h3>
              <p style={{ color: "var(--text-secondary)", marginBottom: "20px" }}>
                Configure Discord webhooks to receive notifications when new versions of tracked software are available.
                You can add up to 3 webhooks.
              </p>

              {discordSuccess && (
                <div className="success-message" style={{ marginBottom: "20px" }}>
                  {discordSuccess}
        </div>
      )}

              {discordWebhooks.length > 0 && (
                <div style={{ marginBottom: "20px" }}>
                  {discordWebhooks.map((webhook) => (
                    <div
                      key={webhook.id}
                      style={{
                        background: "var(--bg-secondary)",
                        padding: "15px",
                        borderRadius: "8px",
                        marginBottom: "12px",
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {webhook.avatarUrl && (
                            <img
                              src={webhook.avatarUrl}
                              alt="Server avatar"
                              style={{
                                width: "48px",
                                height: "48px",
                                borderRadius: "50%",
                                objectFit: "cover",
                                border: "2px solid var(--border-color)",
                              }}
                              onError={(e) => {
                                // If image fails to load, hide it
                                e.target.style.display = "none";
                              }}
                            />
                          )}
                          <div>
                            <strong style={{ color: "var(--text-primary)" }}>
                              {webhook.serverName || "Unnamed Server"}
                            </strong>
                            {webhook.channelName && (
                              <div
                                style={{
                                  color: "var(--text-secondary)",
                                  fontSize: "0.9rem",
                                  marginTop: "5px",
                                }}
                              >
                                Channel: {webhook.channelName}
                              </div>
                            )}
                          <div
                            style={{
                              color: "var(--text-tertiary)",
                              fontSize: "0.85rem",
                              marginTop: "3px",
                            }}
                          >
                            {webhook.enabled ? (
                              <span style={{ color: "var(--dodger-blue)" }}>✓ Enabled</span>
                            ) : (
                              <span style={{ color: "var(--dodger-red)" }}>✗ Disabled</span>
                            )}
                            {webhook.updatedAt && (
                              <span style={{ marginLeft: "10px" }}>
                                • Last updated:{" "}
                                {new Date(webhook.updatedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingDiscordWebhook(webhook);
                              setShowDiscordModal(true);
                            }}
                            className="update-button"
                            title="Edit"
                            style={{
                              padding: "8px 16px",
                              fontSize: "0.9rem",
                              lineHeight: "1.5",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 0,
                              boxSizing: "border-box",
                              height: "auto",
                              minHeight: 0,
                              borderWidth: "1px",
                              fontWeight: "600",
                              background: "rgba(128, 128, 128, 0.2)",
                              borderColor: "var(--text-secondary)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleTestDiscordWebhook(webhook.id);
                            }}
                            className="update-button"
                            style={{
                              padding: "8px 16px",
                              fontSize: "0.9rem",
                              lineHeight: "1.5",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 0,
                              boxSizing: "border-box",
                              height: "auto",
                              minHeight: 0,
                              borderWidth: "1px",
                              fontWeight: "600",
                              background: "rgba(30, 144, 255, 0.2)",
                              borderColor: "var(--dodger-blue)",
                              color: "var(--dodger-blue)",
                            }}
                          >
                            Test
                          </button>
                          <button
                            onClick={() => handleDeleteDiscordWebhook(webhook.id)}
                            className="update-button danger-button"
                            title="Delete"
                            style={{
                              padding: "8px 16px",
                              fontSize: "0.9rem",
                              lineHeight: "1.5",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 0,
                              boxSizing: "border-box",
                              height: "auto",
                              minHeight: 0,
                              borderWidth: "1px",
                              fontWeight: "600",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {discordWebhooks.length < 3 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Add Webhook button clicked');
                    console.log('Current showDiscordModal state:', showDiscordModal);
                    flushSync(() => {
                      setEditingDiscordWebhook(null);
                      setShowDiscordModal(true);
                    });
                    console.log('After state update, showDiscordModal should be:', true);
                  }}
                  className="primary-button"
                  style={{
                    marginTop: "10px",
                  }}
                >
                  + Add Webhook
                </button>
              )}

              {discordWebhooks.length >= 3 && (
                <p style={{ color: "var(--text-tertiary)", fontSize: "0.9rem", marginTop: "10px" }}>
                  Maximum of 3 webhooks reached. Remove an existing webhook to add a new one.
                </p>
              )}

              <div
                style={{
                  marginTop: "30px",
                  padding: "16px",
                  background: "var(--bg-secondary)",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                }}
              >
                <h4 style={{ marginTop: 0, marginBottom: "12px", color: "var(--text-primary)" }}>
                  How to Set Up Discord Webhooks
                </h4>
                <ol style={{ color: "var(--text-secondary)", lineHeight: "1.8", margin: 0, paddingLeft: "20px" }}>
                  <li>Open your Discord server</li>
                  <li>Go to <strong>Server Settings</strong> → <strong>Integrations</strong> → <strong>Webhooks</strong></li>
                  <li>Click <strong>"New Webhook"</strong></li>
                  <li>
                    Open and customize the webhook details:
                    <ul style={{ marginTop: "8px", marginBottom: "8px", paddingLeft: "20px" }}>
                      <li>Choose the channel where you want notifications</li>
                      <li>Rename it <strong><i>Docked</i></strong></li>
                      <li>
                        Use the Docked logo as the webhook avatar
                        <button
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = '/img/image.png';
                            link.download = 'docked-logo.png';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          style={{
                            marginLeft: '8px',
                            padding: '4px 12px',
                            fontSize: '0.85rem',
                            background: 'rgba(30, 144, 255, 0.2)',
                            color: 'var(--dodger-blue)',
                            border: '1px solid var(--dodger-blue)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          Download Logo
                        </button>
                      </li>
                    </ul>
                  </li>
                  <li>Copy the webhook URL</li>
                  <li>Click <strong>"Add Webhook"</strong> above and paste the URL</li>
                  <li>Optionally add a server name for easy identification</li>
                </ol>
              </div>
            </div>
          )}

          {currentActiveSection === "userdetails" && (
            <div className="update-section">
              <h3>User Information</h3>
              {userInfo ? (
                <div className="user-info-section" style={{ marginTop: "20px" }}>
                  <div className="info-item">
                    <strong>Username:</strong> {userInfo.username}
                  </div>
                  <div className="info-item">
                    <strong>Role:</strong> {userInfo.role}
                  </div>
                  {userInfo.created_at && (
                    <div className="info-item">
                      <strong>Account Created:</strong>{" "}
                      {new Date(userInfo.created_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: "var(--text-secondary)" }}>Loading user information...</p>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Modals - rendered outside conditional sections so they're always in DOM */}
      <DiscordWebhookModal
        isOpen={showDiscordModal}
        onClose={() => {
          setShowDiscordModal(false);
          setEditingDiscordWebhook(null);
        }}
        onSuccess={handleDiscordModalSuccess}
        existingWebhook={editingDiscordWebhook}
      />
    </>
  );
}

export default Settings;

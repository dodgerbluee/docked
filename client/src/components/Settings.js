/**
 * Settings Component
 * Allows users to update their username and password
 */

import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./Settings.css";

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
  activeSection = "password",
  onSectionChange = null,
  showUserInfoAboveTabs = false,
  onEditInstance = null,
  avatar,
  recentAvatars = [],
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
  onBatchConfigUpdate = null,
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
  const currentActiveSection = activeSection || internalActiveSection;
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
  const [dockerHubUsername, setDockerHubUsername] = useState("");
  const [dockerHubToken, setDockerHubToken] = useState("");
  const [dockerHubError, setDockerHubError] = useState("");
  const [dockerHubSuccess, setDockerHubSuccess] = useState("");
  const [dockerHubLoading, setDockerHubLoading] = useState(false);
  const [dockerHubCredentials, setDockerHubCredentials] = useState(null);

  // Batch configuration state
  const [batchEnabled, setBatchEnabled] = useState(false);
  const [batchIntervalMinutes, setBatchIntervalMinutes] = useState(60);
  const [batchIntervalValue, setBatchIntervalValue] = useState(60);
  const [batchIntervalUnit, setBatchIntervalUnit] = useState("minutes"); // "minutes" or "hours"
  const [batchError, setBatchError] = useState("");
  const [batchSuccess, setBatchSuccess] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);

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

  useEffect(() => {
    fetchUserInfo();
    fetchPortainerInstances();
    fetchDockerHubCredentials();
    fetchBatchConfig();
    // Update internal state when prop changes
    if (activeSection) {
      setInternalActiveSection(activeSection);
    }
    if (isFirstLogin) {
      if (onSectionChange) {
        onSectionChange("password");
      } else {
        setInternalActiveSection("password");
      }
    }
  }, [isFirstLogin, activeSection]);

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
        if (response.data.credentials) {
          setDockerHubUsername(response.data.credentials.username || "");
        }
      }
    } catch (err) {
      console.error("Error fetching Docker Hub credentials:", err);
    }
  };

  const fetchBatchConfig = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/config`);
      if (response.data.success) {
        setBatchEnabled(response.data.config.enabled || false);
        const minutes = response.data.config.intervalMinutes || 60;
        setBatchIntervalMinutes(minutes);

        // Convert minutes to display value and unit
        // If it's a multiple of 60, show in hours; otherwise show in minutes
        if (minutes >= 60 && minutes % 60 === 0) {
          setBatchIntervalUnit("hours");
          setBatchIntervalValue(minutes / 60);
        } else {
          setBatchIntervalUnit("minutes");
          setBatchIntervalValue(minutes);
        }
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

  const handleDockerHubSubmit = async (e) => {
    e.preventDefault();
    setDockerHubError("");
    setDockerHubSuccess("");
    setDockerHubLoading(true);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/docker-hub/credentials`,
        {
          username: dockerHubUsername.trim(),
          token: dockerHubToken.trim(),
        }
      );

      if (response.data.success) {
        setDockerHubSuccess("Docker Hub credentials updated successfully!");
        setDockerHubToken("");
        await fetchDockerHubCredentials();
        setTimeout(() => setDockerHubSuccess(""), 3000);
      } else {
        setDockerHubError(
          response.data.error || "Failed to update Docker Hub credentials"
        );
      }
    } catch (err) {
      setDockerHubError(
        err.response?.data?.error ||
          "Failed to update Docker Hub credentials. Please try again."
      );
    } finally {
      setDockerHubLoading(false);
    }
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
        setDockerHubUsername("");
        setDockerHubToken("");
        setDockerHubCredentials(null);
        await fetchDockerHubCredentials();
        setTimeout(() => setDockerHubSuccess(""), 3000);
      } else {
        setDockerHubError(
          response.data.error || "Failed to remove Docker Hub credentials"
        );
      }
    } catch (err) {
      setDockerHubError(
        err.response?.data?.error ||
          "Failed to remove Docker Hub credentials. Please try again."
      );
    }
  };

  const handleBatchConfigSubmit = async (e) => {
    e.preventDefault();
    setBatchError("");
    setBatchSuccess("");
    setBatchLoading(true);

    // Convert display value to minutes based on selected unit
    const intervalMinutes =
      batchIntervalUnit === "hours"
        ? batchIntervalValue * 60
        : batchIntervalValue;

    try {
      const response = await axios.post(`${API_BASE_URL}/api/batch/config`, {
        enabled: batchEnabled,
        intervalMinutes: intervalMinutes,
      });

      // Update the minutes state for consistency
      setBatchIntervalMinutes(intervalMinutes);

      if (response.data.success) {
        setBatchSuccess("Batch configuration updated successfully!");
        setTimeout(() => setBatchSuccess(""), 3000);
        // Notify parent component to refetch batch config
        // Use ref to get the latest callback value (avoids stale closure)
        const callback = onBatchConfigUpdateRef.current;
        console.log("🔔 Settings: Calling onBatchConfigUpdate callback");
        console.log(
          "🔍 Settings: onBatchConfigUpdate at call time (from ref):",
          {
            exists: !!callback,
            isFunction: typeof callback === "function",
            value: callback,
          }
        );
        if (callback && typeof callback === "function") {
          console.log("✅ Settings: onBatchConfigUpdate exists, calling it...");
          try {
            await callback();
            console.log("✅ Settings: onBatchConfigUpdate completed");
          } catch (err) {
            console.error(
              "❌ Settings: Error calling onBatchConfigUpdate:",
              err
            );
          }
        } else {
          console.error(
            "❌ Settings: onBatchConfigUpdate is null/undefined or not a function!"
          );
        }
      } else {
        setBatchError(
          response.data.error || "Failed to update batch configuration"
        );
      }
    } catch (err) {
      setBatchError(
        err.response?.data?.error ||
          "Failed to update batch configuration. Please try again."
      );
    } finally {
      setBatchLoading(false);
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
          <h2>⚠️ First Time Login</h2>
          <p>You must change your password before accessing the application.</p>
        </div>
      )}

      {showUserInfoAboveTabs && userInfo && (
        <div className="user-info-section">
          <h3>User Information</h3>
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
      )}

      {!showUserInfoAboveTabs && (
        <div className="settings-sections">
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
                  className="update-button"
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
                  className="update-button"
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
                        <div>
                          <strong style={{ color: "var(--text-primary)" }}>
                            {instance.name}
                          </strong>
                          <div
                            style={{
                              color: "var(--text-secondary)",
                              fontSize: "0.9rem",
                              marginTop: "5px",
                            }}
                          >
                            {instance.url}
                          </div>
                          <div
                            style={{
                              color: "var(--text-tertiary)",
                              fontSize: "0.85rem",
                              marginTop: "3px",
                            }}
                          >
                            Username: {instance.username}
                          </div>
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
                            style={{ padding: "8px 16px", fontSize: "0.9rem" }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteInstance(instance.id)}
                            className="update-button"
                            style={{
                              padding: "8px 16px",
                              fontSize: "0.9rem",
                              background: "rgba(239, 62, 66, 0.2)",
                              borderColor: "var(--dodger-red)",
                              color: "var(--dodger-red)",
                            }}
                          >
                            Delete
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
                    style={{
                      display: "inline-block",
                      padding: "12px 24px",
                      background: "var(--dodger-blue)",
                      color: "white",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: "600",
                      transition: "all 0.3s",
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = "var(--dodger-blue-light)";
                      e.target.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = "var(--dodger-blue)";
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
                          width: "30px",
                          height: "30px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
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
                          className="update-button"
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
              <div className="form-group" style={{ marginTop: "32px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "12px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                  }}
                >
                  Delete Avatar
                </label>
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: "0.9rem",
                    marginBottom: "12px",
                    marginTop: 0,
                  }}
                >
                  Delete your current avatar to revert to the original default
                  avatar.
                </p>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="update-button"
                  style={{
                    background: "rgba(239, 62, 66, 0.2)",
                    borderColor: "var(--dodger-red)",
                    color: "var(--dodger-red)",
                    padding: "8px 16px",
                    fontSize: "0.9rem",
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
                        className="update-button"
                        style={{
                          background: "rgba(239, 62, 66, 0.2)",
                          borderColor: "var(--dodger-red)",
                          color: "var(--dodger-red)",
                        }}
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
                  padding: "15px",
                  borderRadius: "8px",
                  marginBottom: "20px",
                  border: "1px solid var(--border-color)",
                }}
              >
                <h4 style={{ marginTop: 0, color: "var(--text-primary)" }}>
                  What is this used for?
                </h4>
                <p
                  style={{
                    color: "var(--text-secondary)",
                    lineHeight: "1.6",
                    marginBottom: "10px",
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

              {dockerHubCredentials && (
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
                    <button
                      onClick={handleDeleteDockerHubCreds}
                      className="update-button"
                      style={{
                        padding: "8px 16px",
                        fontSize: "0.9rem",
                        background: "rgba(239, 62, 66, 0.2)",
                        borderColor: "var(--dodger-red)",
                        color: "var(--dodger-red)",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleDockerHubSubmit} className="update-form">
                <div className="form-group">
                  <label htmlFor="dockerHubUsername">Docker Hub Username</label>
                  <input
                    type="text"
                    id="dockerHubUsername"
                    value={dockerHubUsername}
                    onChange={(e) => setDockerHubUsername(e.target.value)}
                    required
                    placeholder="your-dockerhub-username"
                    disabled={dockerHubLoading}
                  />
                  <small>Your Docker Hub account username</small>
                </div>
                <div className="form-group">
                  <label htmlFor="dockerHubToken">Personal Access Token</label>
                  <input
                    type="password"
                    id="dockerHubToken"
                    value={dockerHubToken}
                    onChange={(e) => setDockerHubToken(e.target.value)}
                    required={!dockerHubCredentials}
                    placeholder={
                      dockerHubCredentials
                        ? "Leave blank to keep current token"
                        : "dckr_pat_..."
                    }
                    disabled={dockerHubLoading}
                  />
                  <small>
                    {dockerHubCredentials
                      ? "Leave blank to keep the current token, or enter a new token to update"
                      : "Create a Personal Access Token at hub.docker.com/settings/security"}
                  </small>
                </div>
                {dockerHubError && (
                  <div className="error-message">{dockerHubError}</div>
                )}
                {dockerHubSuccess && (
                  <div className="success-message">{dockerHubSuccess}</div>
                )}
                <button
                  type="submit"
                  className="update-button"
                  disabled={
                    dockerHubLoading ||
                    !dockerHubUsername ||
                    (!dockerHubToken && !dockerHubCredentials)
                  }
                >
                  {dockerHubLoading
                    ? "Saving..."
                    : dockerHubCredentials
                    ? "Update Credentials"
                    : "Save Credentials"}
                </button>
              </form>
            </div>
          )}

          {currentActiveSection === "batch" && (
            <div className="update-section">
              <h3>Batch Processing Configuration</h3>
              <div
                style={{
                  background: "var(--bg-secondary)",
                  padding: "15px",
                  borderRadius: "8px",
                  marginBottom: "20px",
                  border: "1px solid var(--border-color)",
                }}
              >
                <h4 style={{ marginTop: 0, color: "var(--text-primary)" }}>
                  What is this?
                </h4>
                <p
                  style={{
                    color: "var(--text-secondary)",
                    lineHeight: "1.6",
                    marginBottom: "10px",
                  }}
                >
                  Batch processing automatically fetches container update
                  information from Docker Hub at regular intervals in the
                  background. This keeps your container data up-to-date without
                  manual intervention.
                </p>
                <h4 style={{ color: "var(--text-primary)" }}>How it works:</h4>
                <ul
                  style={{
                    color: "var(--text-secondary)",
                    lineHeight: "1.6",
                    marginBottom: 0,
                    paddingLeft: "20px",
                  }}
                >
                  <li>
                    <strong>Automatic Updates:</strong> When enabled, the system
                    will automatically pull fresh data from Docker Hub at the
                    configured interval
                  </li>
                  <li>
                    <strong>Background Processing:</strong> Updates run in the
                    background and won't interrupt your work
                  </li>
                  <li>
                    <strong>Configurable Interval:</strong> Set how often the
                    batch process runs (in minutes or hours)
                  </li>
                  <li>
                    <strong>Rate Limit Aware:</strong> The system respects
                    Docker Hub rate limits and will adjust accordingly
                  </li>
                </ul>
              </div>

              <form onSubmit={handleBatchConfigSubmit} className="update-form">
                <div className="form-group">
                  <label
                    htmlFor="batchEnabled"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      id="batchEnabled"
                      checked={batchEnabled}
                      onChange={(e) => setBatchEnabled(e.target.checked)}
                      disabled={batchLoading}
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
                      Enable Batch Processing
                    </span>
                  </label>
                  <small>
                    When enabled, Docker Hub data will be fetched automatically
                    at the configured interval
                  </small>
                </div>

                {batchEnabled && (
                  <div className="form-group">
                    <label htmlFor="batchInterval">Update Interval</label>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        id="batchInterval"
                        value={batchIntervalValue}
                        onKeyPress={(e) => {
                          // Only allow digits (0-9)
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
                          // Only allow digits
                          const inputValue = e.target.value.replace(
                            /[^0-9]/g,
                            ""
                          );
                          if (inputValue === "") {
                            setBatchIntervalValue("");
                            return;
                          }
                          const numValue = parseInt(inputValue, 10);
                          if (isNaN(numValue)) {
                            return;
                          }
                          // Validate against min/max
                          const max = batchIntervalUnit === "hours" ? 24 : 1440;
                          const validatedValue = Math.max(
                            1,
                            Math.min(numValue, max)
                          );
                          setBatchIntervalValue(validatedValue);
                          // Update minutes for validation
                          const minutes =
                            batchIntervalUnit === "hours"
                              ? validatedValue * 60
                              : validatedValue;
                          setBatchIntervalMinutes(minutes);
                        }}
                        onBlur={(e) => {
                          // Ensure value is set on blur if empty
                          if (
                            e.target.value === "" ||
                            parseInt(e.target.value, 10) < 1
                          ) {
                            setBatchIntervalValue(1);
                            const minutes =
                              batchIntervalUnit === "hours" ? 60 : 1;
                            setBatchIntervalMinutes(minutes);
                          }
                        }}
                        required
                        disabled={batchLoading}
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
                      <select
                        id="batchIntervalUnit"
                        value={batchIntervalUnit}
                        onChange={(e) => {
                          const newUnit = e.target.value;
                          setBatchIntervalUnit(newUnit);
                          // Convert current value to new unit
                          if (newUnit === "hours") {
                            // Convert minutes to hours (round to nearest)
                            const hours =
                              Math.round(batchIntervalMinutes / 60) || 1;
                            setBatchIntervalValue(hours);
                          } else {
                            // Convert hours to minutes
                            const minutes = batchIntervalValue * 60;
                            setBatchIntervalValue(minutes);
                            setBatchIntervalMinutes(minutes);
                          }
                        }}
                        disabled={batchLoading}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-color)",
                          background: "var(--bg-primary)",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          fontSize: "14px",
                        }}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                      </select>
                    </div>
                    <small>
                      How often to fetch updates.{" "}
                      {batchIntervalUnit === "hours"
                        ? `Range: 1-24 hours (${
                            batchIntervalValue * 60
                          } minutes)`
                        : `Range: 1-1440 minutes (${
                            batchIntervalMinutes >= 60
                              ? `${(batchIntervalMinutes / 60).toFixed(
                                  1
                                )} hours`
                              : `${batchIntervalMinutes} minutes`
                          })`}
                    </small>
                  </div>
                )}

                {batchError && (
                  <div className="error-message">{batchError}</div>
                )}
                {batchSuccess && (
                  <div className="success-message">{batchSuccess}</div>
                )}
                <button
                  type="submit"
                  className="update-button"
                  disabled={
                    batchLoading || (batchEnabled && batchIntervalValue < 1)
                  }
                >
                  {batchLoading ? "Saving..." : "Save Configuration"}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default Settings;

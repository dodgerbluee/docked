import React, { useState } from "react";
import PropTypes from "prop-types";
import { Download, ChevronRight, ChevronDown, User, Lock, Image } from "lucide-react";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Input from "../ui/Input";
import AvatarUploader from "./avatar/AvatarUploader";
import AvatarPreviewModal from "./avatar/AvatarPreviewModal";
import ConfirmDialog from "../ui/ConfirmDialog";
import styles from "./UserDetailsTab.module.css";
import generalStyles from "./GeneralTab.module.css";

/**
 * UserDetailsTab Component
 * Merged user management tab with collapsible sections for Username, Password, and Avatar
 */
const UserDetailsTab = React.memo(function UserDetailsTab({
  userInfo,
  // Username props
  newUsername,
  setNewUsername,
  usernamePassword,
  setUsernamePassword,
  usernameError,
  usernameSuccess,
  usernameLoading,
  handleUsernameSubmit,
  // Password props
  isFirstLogin,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordError,
  passwordSuccess,
  passwordLoading,
  handlePasswordSubmit,
  // Avatar props
  avatar,
  recentAvatars = [],
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");

  // Collapsible sections state
  // Auto-expand password section on first login
  const [expandedSections, setExpandedSections] = useState({
    username: false,
    password: isFirstLogin || false,
    avatar: false,
  });

  // Avatar state
  const [avatarPreview, setAvatarPreview] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarImage, setAvatarImage] = useState(null);
  const [avatarCrop, setAvatarCrop] = useState({
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  });
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarPan, setAvatarPan] = useState({ x: 0, y: 0 });
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarSuccess, setAvatarSuccess] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError("");
    setExportSuccess("");

    try {
      const response = await axios.get(`${API_BASE_URL}/api/user/export-config`);

      if (response.data.success) {
        const jsonString = JSON.stringify(response.data.data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `docked-config-export-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(link);
        link.click();

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


  // Avatar handlers
  const handleAvatarFileSelect = (file) => {
    if (!file.type.startsWith("image/")) {
      setAvatarError("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Image size must be less than 5MB");
      return;
    }

    setAvatarFile(file);
    setAvatarError("");

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setAvatarImage(img);
        const previewSize = 400;
        const imageAspect = img.width / img.height;
        let displayedWidth, displayedHeight;
        if (imageAspect > 1) {
          displayedWidth = previewSize;
          displayedHeight = previewSize / imageAspect;
        } else {
          displayedHeight = previewSize;
          displayedWidth = previewSize * imageAspect;
        }

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

  const handleAvatarUpload = async (croppedImageUrl) => {
    if (!croppedImageUrl) {
      setAvatarError("Failed to crop image");
      return;
    }

    setAvatarUploading(true);
    setAvatarError("");

    try {
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();

      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(blob);
      });

      const uploadResponse = await axios.post(`${API_BASE_URL}/api/avatars`, {
        avatar: base64,
      });

      if (uploadResponse.data.success) {
        const avatarUrl = uploadResponse.data.avatarUrl;
        if (onAvatarChange) {
          await onAvatarChange(avatarUrl);
        }

        const serverRecentAvatars = uploadResponse.data.recentAvatars || [];
        if (onRecentAvatarsChange) {
          onRecentAvatarsChange(serverRecentAvatars);
        }

        setAvatarSuccess("Avatar uploaded successfully!");
        setAvatarUploading(false);

        resetAvatarState();
        URL.revokeObjectURL(croppedImageUrl);

        if (onAvatarUploaded) {
          setTimeout(() => {
            onAvatarUploaded();
          }, 200);
        }
      } else {
        throw new Error(uploadResponse.data.error || "Failed to upload avatar");
      }
    } catch (err) {
      console.error("Avatar upload error:", err);
      setAvatarError(`Failed to upload avatar: ${err.message}`);
      setAvatarUploading(false);
    }
  };

  const handleDeleteAvatar = async () => {
    try {
      setAvatarError("");
      const response = await axios.delete(`${API_BASE_URL}/api/avatars`);

      if (response.data.success) {
        if (avatar && avatar.startsWith("blob:")) {
          URL.revokeObjectURL(avatar);
        }

        if (onAvatarChange) {
          await onAvatarChange("/img/default-avatar.jpg");
        }

        if (onRecentAvatarsChange) {
          onRecentAvatarsChange([]);
        }

        setAvatarSuccess("Avatar deleted successfully. Reverted to default avatar.");
        setShowDeleteConfirm(false);

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
      setAvatarError(err.response?.data?.error || "Failed to delete avatar. Please try again.");
      setShowDeleteConfirm(false);
    }
  };

  const resetAvatarState = () => {
    setShowPreviewModal(false);
    setAvatarPreview(null);
    setAvatarFile(null);
    setAvatarImage(null);
    setAvatarCrop({ x: 0, y: 0, width: 200, height: 200 });
    setAvatarZoom(1);
    setAvatarPan({ x: 0, y: 0 });
    setAvatarError("");
  };

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>User Settings</h3>

      {/* User Information Section */}
      {userInfo && (
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
      )}

      {/* Username Section */}
      <div className={styles.section}>
        <button
          type="button"
          className={styles.sectionHeader}
          onClick={() => toggleSection("username")}
        >
          <div className={styles.sectionHeaderContent}>
            <User size={20} className={styles.sectionIcon} />
            <h4 className={styles.sectionTitle}>Change Username</h4>
          </div>
          {expandedSections.username ? (
            <ChevronDown size={20} className={styles.chevron} />
          ) : (
            <ChevronRight size={20} className={styles.chevron} />
          )}
        </button>
        {expandedSections.username && (
          <div className={styles.sectionContent}>
            {usernameSuccess && <Alert variant="info">{usernameSuccess}</Alert>}
            {usernameError && <Alert variant="error">{usernameError}</Alert>}
            <form onSubmit={handleUsernameSubmit} className={styles.form}>
              <Input
                id="newUsername"
                label="New Username"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                autoComplete="username"
                disabled={usernameLoading}
                minLength={3}
                helperText="Must be at least 3 characters long"
              />
              <Input
                id="usernamePassword"
                label="Current Password"
                type="password"
                value={usernamePassword}
                onChange={(e) => setUsernamePassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={usernameLoading}
                helperText="Enter your current password to confirm"
              />
              <div className={styles.actions}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={usernameLoading || !newUsername || !usernamePassword}
                  className={styles.submitButton}
                >
                  {usernameLoading ? "Updating..." : "Update Username"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Password Section */}
      <div className={styles.section}>
        <button
          type="button"
          className={styles.sectionHeader}
          onClick={() => toggleSection("password")}
        >
          <div className={styles.sectionHeaderContent}>
            <Lock size={20} className={styles.sectionIcon} />
            <h4 className={styles.sectionTitle}>Change Password</h4>
          </div>
          {expandedSections.password ? (
            <ChevronDown size={20} className={styles.chevron} />
          ) : (
            <ChevronRight size={20} className={styles.chevron} />
          )}
        </button>
        {expandedSections.password && (
          <div className={styles.sectionContent}>
            {passwordSuccess && <Alert variant="info">{passwordSuccess}</Alert>}
            {passwordError && <Alert variant="error">{passwordError}</Alert>}
            <form onSubmit={handlePasswordSubmit} className={styles.form}>
              {!isFirstLogin && (
                <Input
                  id="currentPassword"
                  label="Current Password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={passwordLoading}
                />
              )}
              <Input
                id="newPassword"
                label="New Password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={passwordLoading}
                minLength={6}
                helperText="Must be at least 6 characters long"
              />
              <Input
                id="confirmPassword"
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={passwordLoading}
                minLength={6}
              />
              <div className={styles.actions}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    passwordLoading ||
                    !newPassword ||
                    !confirmPassword ||
                    (!isFirstLogin && !currentPassword)
                  }
                  className={styles.submitButton}
                >
                  {passwordLoading ? "Updating..." : "Update Password"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Avatar Section */}
      <div className={styles.section}>
        <button
          type="button"
          className={styles.sectionHeader}
          onClick={() => toggleSection("avatar")}
        >
          <div className={styles.sectionHeaderContent}>
            <Image size={20} className={styles.sectionIcon} />
            <h4 className={styles.sectionTitle}>Avatar Settings</h4>
          </div>
          {expandedSections.avatar ? (
            <ChevronDown size={20} className={styles.chevron} />
          ) : (
            <ChevronRight size={20} className={styles.chevron} />
          )}
        </button>
        {expandedSections.avatar && (
          <div className={styles.sectionContent}>
            {avatarError && <Alert variant="error">{avatarError}</Alert>}
            {avatarSuccess && <Alert variant="info">{avatarSuccess}</Alert>}

            <div className={styles.formGroup}>
              <label className={styles.uploadLabel}>Upload New Avatar</label>
              <AvatarUploader onFileSelect={handleAvatarFileSelect} isUploading={avatarUploading} />
            </div>

            <AvatarPreviewModal
              isOpen={showPreviewModal}
              onClose={resetAvatarState}
              imageSrc={avatarPreview}
              imageElement={avatarImage}
              crop={avatarCrop}
              zoom={avatarZoom}
              pan={avatarPan}
              onZoomChange={setAvatarZoom}
              onPanChange={setAvatarPan}
              onUpload={handleAvatarUpload}
              isUploading={avatarUploading}
            />

            <div className={styles.deleteSection}>
              <label className={styles.deleteLabel}>Delete Avatar</label>
              <Button
                type="button"
                variant="danger"
                onClick={() => setShowDeleteConfirm(true)}
                className={styles.deleteButton}
              >
                Delete Avatar
              </Button>
              <small className={styles.deleteHelperText}>
                Delete your current avatar. It will revert to the default avatar.
              </small>
            </div>

            <ConfirmDialog
              isOpen={showDeleteConfirm}
              onClose={() => setShowDeleteConfirm(false)}
              onConfirm={handleDeleteAvatar}
              title="Delete Avatar?"
              message="This will delete your current avatar and revert to the default avatar. This action cannot be undone."
              confirmText="Delete"
              cancelText="Cancel"
              variant="danger"
            />
          </div>
        )}
      </div>

      {/* Configuration Management Section */}
      <div className={`${generalStyles.dataManagement} ${styles.exportContainer}`}>
        <h4 className={generalStyles.sectionTitle}>Configuration Management</h4>
        {exportSuccess && <Alert variant="info">{exportSuccess}</Alert>}
        {exportError && <Alert variant="error">{exportError}</Alert>}
        <div className={generalStyles.dataActions}>
          <div className={generalStyles.dataActionItem}>
            <div className={styles.exportButtonContainer}>
              <Button
                type="button"
                variant="primary"
                onClick={handleExport}
                disabled={exporting}
                icon={Download}
                className={generalStyles.saveButton}
              >
                {exporting ? "Exporting..." : "Export Configuration"}
              </Button>
            </div>
            <small className={`${generalStyles.dataActionHelper} ${styles.exportHelperText}`}>
              Export all your database configurations including Portainer instances, Docker Hub
              credentials, Discord webhooks, tracked images, and general settings in JSON format.
            </small>
          </div>
        </div>
      </div>
    </div>
  );
});

UserDetailsTab.propTypes = {
  userInfo: PropTypes.object,
  // Username props
  newUsername: PropTypes.string.isRequired,
  setNewUsername: PropTypes.func.isRequired,
  usernamePassword: PropTypes.string.isRequired,
  setUsernamePassword: PropTypes.func.isRequired,
  usernameError: PropTypes.string,
  usernameSuccess: PropTypes.string,
  usernameLoading: PropTypes.bool.isRequired,
  handleUsernameSubmit: PropTypes.func.isRequired,
  // Password props
  isFirstLogin: PropTypes.bool.isRequired,
  currentPassword: PropTypes.string.isRequired,
  setCurrentPassword: PropTypes.func.isRequired,
  newPassword: PropTypes.string.isRequired,
  setNewPassword: PropTypes.func.isRequired,
  confirmPassword: PropTypes.string.isRequired,
  setConfirmPassword: PropTypes.func.isRequired,
  passwordError: PropTypes.string,
  passwordSuccess: PropTypes.string,
  passwordLoading: PropTypes.bool.isRequired,
  handlePasswordSubmit: PropTypes.func.isRequired,
  // Avatar props
  avatar: PropTypes.string,
  recentAvatars: PropTypes.arrayOf(PropTypes.string),
  onAvatarChange: PropTypes.func.isRequired,
  onRecentAvatarsChange: PropTypes.func,
  onAvatarUploaded: PropTypes.func,
};

export default UserDetailsTab;

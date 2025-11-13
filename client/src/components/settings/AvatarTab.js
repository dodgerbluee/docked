import React, { useState } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ConfirmDialog from "../ui/ConfirmDialog";
import AvatarUploader from "./avatar/AvatarUploader";
import AvatarPreviewModal from "./avatar/AvatarPreviewModal";
import styles from "./AvatarTab.module.css";

/**
 * AvatarTab Component
 * Handles avatar upload, cropping, and deletion
 */
const AvatarTab = React.memo(function AvatarTab({
  avatar,
  recentAvatars = [],
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
}) {
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
  const [avatarPan, setAvatarPan] = useState({ x: 0, y: 0 });
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarSuccess, setAvatarSuccess] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const handleFileSelect = (file) => {
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

  const handleUpload = async (croppedImageUrl) => {
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

        setAvatarSuccess(
          "Avatar deleted successfully. Reverted to default avatar."
        );
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
      setAvatarError(
        err.response?.data?.error || "Failed to delete avatar. Please try again."
      );
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
      <h3 className={styles.title}>Avatar Settings</h3>

      {avatarError && <Alert variant="error">{avatarError}</Alert>}
      {avatarSuccess && <Alert variant="info">{avatarSuccess}</Alert>}

      <div className={styles.formGroup}>
        <label className={styles.uploadLabel}>Upload New Avatar</label>
        <AvatarUploader
          onFileSelect={handleFileSelect}
          isUploading={avatarUploading}
        />
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
        onUpload={handleUpload}
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
  );
});

AvatarTab.propTypes = {
  avatar: PropTypes.string,
  recentAvatars: PropTypes.arrayOf(PropTypes.string),
  onAvatarChange: PropTypes.func.isRequired,
  onRecentAvatarsChange: PropTypes.func,
  onAvatarUploaded: PropTypes.func,
};

export default AvatarTab;

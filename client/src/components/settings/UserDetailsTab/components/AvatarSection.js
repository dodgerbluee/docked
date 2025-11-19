/**
 * Avatar section component
 */

import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Image as ImageIcon, ChevronRight, ChevronDown } from "lucide-react";
import Button from "../../../ui/Button";
import Alert from "../../../ui/Alert";
import AvatarUploader from "../../avatar/AvatarUploader";
import AvatarPreviewModal from "../../avatar/AvatarPreviewModal";
import ConfirmDialog from "../../../ui/ConfirmDialog";
import { useAvatarUpload } from "../hooks/useAvatarUpload";
import { useAvatarCrop } from "../hooks/useAvatarCrop";
import styles from "../../UserDetailsTab.module.css";

/**
 * Avatar section component
 * @param {Object} props
 * @param {boolean} props.isExpanded - Whether section is expanded
 * @param {Function} props.onToggle - Toggle expansion handler
 * @param {string} props.avatar - Current avatar URL
 * @param {Array} props.recentAvatars - Recent avatars array
 * @param {Function} props.onAvatarChange - Avatar change handler
 * @param {Function} props.onRecentAvatarsChange - Recent avatars change handler
 * @param {Function} props.onAvatarUploaded - Avatar uploaded callback
 */
const AvatarSection = ({
  isExpanded,
  onToggle,
  avatar,
  recentAvatars = [],
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Use extracted hooks
  const {
    avatarPreview,
    avatarImage,
    avatarCrop,
    avatarZoom,
    avatarPan,
    showPreviewModal,
    setAvatarZoom,
    setAvatarPan,
    handleAvatarFileSelect,
    resetAvatarState,
  } = useAvatarCrop();

  const {
    avatarUploading,
    avatarError,
    avatarSuccess,
    setAvatarError,
    handleAvatarUpload,
    handleDeleteAvatar,
  } = useAvatarUpload({
    avatar,
    onAvatarChange,
    onRecentAvatarsChange,
    onAvatarUploaded,
  });

  const handleFileSelect = (file) => {
    setAvatarError("");
    handleAvatarFileSelect(file, (error) => {
      setAvatarError(error);
    });
  };

  // Close modal when upload is successful
  useEffect(() => {
    if (avatarSuccess && !avatarError && !avatarUploading) {
      resetAvatarState();
    }
  }, [avatarSuccess, avatarError, avatarUploading, resetAvatarState]);

  const handleUpload = async (croppedImageUrl) => {
    await handleAvatarUpload(croppedImageUrl);
  };

  const handleDelete = async () => {
    await handleDeleteAvatar();
    setShowDeleteConfirm(false);
  };

  return (
    <div className={styles.section}>
      <button type="button" className={styles.sectionHeader} onClick={onToggle}>
        <div className={styles.sectionHeaderContent}>
          <ImageIcon size={20} className={styles.sectionIcon} />
          <h4 className={styles.sectionTitle}>Avatar Settings</h4>
        </div>
        {isExpanded ? (
          <ChevronDown size={20} className={styles.chevron} />
        ) : (
          <ChevronRight size={20} className={styles.chevron} />
        )}
      </button>
      {isExpanded && (
        <div className={styles.sectionContent}>
          {avatarError && <Alert variant="error">{avatarError}</Alert>}
          {avatarSuccess && <Alert variant="info">{avatarSuccess}</Alert>}

          <div className={styles.formGroup}>
            <label className={styles.uploadLabel}>Upload New Avatar</label>
            <AvatarUploader onFileSelect={handleFileSelect} isUploading={avatarUploading} />
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
            onConfirm={handleDelete}
            title="Delete Avatar?"
            message="This will delete your current avatar and revert to the default avatar. This action cannot be undone."
            confirmText="Delete"
            cancelText="Cancel"
            variant="danger"
          />
        </div>
      )}
    </div>
  );
};

AvatarSection.propTypes = {
  isExpanded: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  avatar: PropTypes.string,
  recentAvatars: PropTypes.arrayOf(PropTypes.string),
  onAvatarChange: PropTypes.func.isRequired,
  onRecentAvatarsChange: PropTypes.func,
  onAvatarUploaded: PropTypes.func,
};

export default AvatarSection;

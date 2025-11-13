import React from "react";
import PropTypes from "prop-types";
import Button from "../../ui/Button";
import styles from "./AvatarUploader.module.css";

/**
 * AvatarUploader Component
 * Handles file selection and upload area
 */
const AvatarUploader = React.memo(function AvatarUploader({
  onFileSelect,
  isUploading,
}) {
  const fileInputRef = React.useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onFileSelect(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={styles.uploadArea}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        id="avatar-upload-input"
        className={styles.fileInput}
      />
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={isUploading}
        className={styles.uploadButton}
      >
        Choose Image
      </Button>
      <small className={styles.helperText}>
        Max size: 5MB. Image will be cropped to square automatically.
      </small>
    </div>
  );
});

AvatarUploader.propTypes = {
  onFileSelect: PropTypes.func.isRequired,
  isUploading: PropTypes.bool,
};

export default AvatarUploader;


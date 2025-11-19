import React from "react";
import PropTypes from "prop-types";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ImportSummaryCard from "./ImportSummaryCard";
import { Upload, File } from "lucide-react";
import styles from "../ImportUsersModal.module.css";

/**
 * FileUploadStep Component
 * Handles file upload UI for user import
 */
function FileUploadStep({
  file,
  usersData,
  preImportErrors,
  error,
  loading,
  fileInputRef,
  onFileChange,
  onFileButtonClick,
  onStartImport,
  onClose,
}) {
  return (
    <div className={styles.form}>
      <div className={styles.uploadArea}>
        <input
          ref={fileInputRef}
          type="file"
          id="usersFile"
          accept=".json,application/json"
          onChange={onFileChange}
          disabled={loading}
          className={styles.fileInput}
        />
        <Button
          variant="outline"
          onClick={onFileButtonClick}
          disabled={loading}
          className={styles.uploadButton}
          icon={Upload}
          iconPosition="left"
        >
          Choose JSON File
        </Button>
        {file && (
          <div className={styles.fileInfo}>
            <File size={16} />
            <span className={styles.fileName}>{file.name}</span>
          </div>
        )}
      </div>

      {usersData && (
        <ImportSummaryCard
          users={usersData.users}
          instanceAdminUsers={usersData.instanceAdminUsers}
          skippedUsers={preImportErrors || []}
        />
      )}

      {error && (
        <Alert variant="error" className={styles.alert}>
          {error}
        </Alert>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onStartImport}
          disabled={!file || !usersData || loading}
        >
          {usersData && usersData.users.length === 0 ? "Finish" : "Start Import"}
        </Button>
      </div>
    </div>
  );
}

FileUploadStep.propTypes = {
  file: PropTypes.object,
  usersData: PropTypes.object,
  preImportErrors: PropTypes.array,
  error: PropTypes.string,
  loading: PropTypes.bool,
  fileInputRef: PropTypes.object.isRequired,
  onFileChange: PropTypes.func.isRequired,
  onFileButtonClick: PropTypes.func.isRequired,
  onStartImport: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default FileUploadStep;


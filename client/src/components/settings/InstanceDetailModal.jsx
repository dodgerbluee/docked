import React from "react";
import PropTypes from "prop-types";
import { Lock, Package, Pencil, Trash2 } from "lucide-react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import styles from "./InstanceDetailModal.module.css";

/**
 * InstanceDetailModal Component
 * Shows Portainer instance details with Edit and Delete actions
 */
function InstanceDetailModal({ instance, isOpen, onClose, onEdit, onDelete }) {
  if (!instance) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={instance.name || "Instance Details"}
      size="sm"
      fullScreenMobile
    >
      <div className={styles.modalBody}>
        <div className={styles.detailSection}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Auth Type</span>
            <span className={styles.detailValue}>
              {instance.auth_type === "apikey" ? (
                <span className={styles.authBadge}>
                  <Package size={12} className={styles.badgeIcon} />
                  API Key
                </span>
              ) : (
                <span className={styles.authBadge}>
                  <Lock size={12} className={styles.badgeIcon} />
                  Password
                </span>
              )}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>URL</span>
            <span className={styles.detailValue}>{instance.url}</span>
          </div>
          {instance.auth_type === "password" && instance.username && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Username</span>
              <span className={styles.detailValue}>{instance.username}</span>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            onClick={() => {
              onClose();
              if (onDelete) onDelete(instance.id);
            }}
          >
            Delete
          </Button>
          <div className={styles.footerRight}>
            <button type="button" className={styles.editButton} onClick={() => onEdit(instance)}>
              <Pencil size={16} className={styles.editButtonIcon} />
              <span className={styles.editButtonText}>Edit Instance</span>
            </button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

InstanceDetailModal.propTypes = {
  instance: PropTypes.object,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
};

export default InstanceDetailModal;

import React from "react";
import PropTypes from "prop-types";
import { Pencil, Trash2 } from "lucide-react";
import styles from "./ActionButtons.module.css";

/**
 * ActionButtons Component
 * Modern, clean edit/delete button group with text labels
 */
const ActionButtons = React.memo(function ActionButtons({
  onEdit,
  onDelete,
  editLabel = "Edit",
  deleteLabel = "Delete",
  className = "",
}) {
  return (
    <div className={`${styles.actions} ${className}`}>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className={styles.editButton}
          title={editLabel}
          aria-label={editLabel}
        >
          <Pencil size={16} className={styles.icon} />
          <span className={styles.label}>{editLabel}</span>
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className={styles.deleteButton}
          title={deleteLabel}
          aria-label={deleteLabel}
        >
          <Trash2 size={16} className={styles.icon} />
          <span className={styles.label}>{deleteLabel}</span>
        </button>
      )}
    </div>
  );
});

ActionButtons.propTypes = {
  onEdit: PropTypes.func,
  onDelete: PropTypes.func.isRequired,
  editLabel: PropTypes.string,
  deleteLabel: PropTypes.string,
  className: PropTypes.string,
};

export default ActionButtons;

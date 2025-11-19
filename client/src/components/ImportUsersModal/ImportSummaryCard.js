import React from "react";
import PropTypes from "prop-types";
import { Users, Shield, XCircle, CheckCircle2 } from "lucide-react";
import styles from "./ImportSummaryCard.module.css";

/**
 * ImportSummaryCard Component
 * Displays a modern, eye-catching summary of what will be imported
 */
function ImportSummaryCard({ users, instanceAdminUsers, skippedUsers }) {
  // Extract usernames from skipped error messages
  const skippedUsernames = skippedUsers
    .map((error) => {
      const match = error.match(/User "([^"]+)" already exists/);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  const userCount = users?.length || 0;
  const instanceAdminCount = instanceAdminUsers?.length || 0;
  const skippedCount = skippedUsernames.length;

  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryHeader}>
        <CheckCircle2 className={styles.icon} size={20} />
        <h3 className={styles.summaryTitle}>Import Summary</h3>
      </div>

      <div className={styles.summaryContent}>
        {userCount > 0 && (
          <div className={styles.summaryItem}>
            <div className={styles.summaryItemIcon}>
              <Users className={styles.icon} size={24} />
            </div>
            <div className={styles.summaryItemContent}>
              <div className={styles.summaryItemLabel}>Users to Import ({userCount})</div>
              <div className={styles.summaryItemList}>
                {users.map((user) => user.username).join(", ")}
              </div>
            </div>
          </div>
        )}

        {instanceAdminCount > 0 && (
          <div className={`${styles.summaryItem} ${styles.summaryItemWarning}`}>
            <div className={styles.summaryItemIcon}>
              <Shield className={styles.icon} size={24} />
            </div>
            <div className={styles.summaryItemContent}>
              <div className={styles.summaryItemLabel}>
                Requires Verification ({instanceAdminCount})
              </div>
              <div className={styles.summaryItemList}>
                {instanceAdminUsers.map((user) => user.username).join(", ")}
              </div>
            </div>
          </div>
        )}

        {skippedCount > 0 && (
          <div className={`${styles.summaryItem} ${styles.summaryItemSkipped}`}>
            <div className={styles.summaryItemIcon}>
              <XCircle className={styles.icon} size={24} />
            </div>
            <div className={styles.summaryItemContent}>
              <div className={styles.summaryItemLabel}>Skipped ({skippedCount})</div>
              <div className={styles.summaryItemList}>{skippedUsernames.join(", ")}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

ImportSummaryCard.propTypes = {
  users: PropTypes.array,
  instanceAdminUsers: PropTypes.array,
  skippedUsers: PropTypes.array,
};

ImportSummaryCard.defaultProps = {
  users: [],
  instanceAdminUsers: [],
  skippedUsers: [],
};

export default ImportSummaryCard;

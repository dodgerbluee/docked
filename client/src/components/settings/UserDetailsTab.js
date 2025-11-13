import React from "react";
import PropTypes from "prop-types";
import Card from "../ui/Card";
import styles from "./UserDetailsTab.module.css";

/**
 * UserDetailsTab Component
 * Displays user information
 */
const UserDetailsTab = React.memo(function UserDetailsTab({ userInfo }) {
  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>User Information</h3>
      {userInfo ? (
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
      ) : (
        <Card variant="secondary" padding="lg">
          <p className={styles.loadingText}>Loading user information...</p>
        </Card>
      )}
    </div>
  );
});

UserDetailsTab.propTypes = {
  userInfo: PropTypes.object,
};

export default UserDetailsTab;


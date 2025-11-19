/**
 * User info card component
 */

import React from "react";
import PropTypes from "prop-types";
import Card from "../../../ui/Card";
import styles from "../../UserDetailsTab.module.css";

/**
 * User info card component
 * @param {Object} props
 * @param {Object} props.userInfo - User information object
 */
const UserInfoCard = ({ userInfo }) => {
  if (!userInfo) return null;

  return (
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
  );
};

UserInfoCard.propTypes = {
  userInfo: PropTypes.object,
};

export default UserInfoCard;


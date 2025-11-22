/**
 * Settings header component
 */

import React from "react";
import PropTypes from "prop-types";
import "../../Settings.css";

/**
 * Settings header component
 * @param {Object} props
 * @param {Object} props.userInfo - User info object
 * @param {boolean} props.showUserInfoAboveTabs - Whether to show user info above tabs
 */
const SettingsHeader = ({ userInfo, showUserInfoAboveTabs }) => {
  const renderUserInfo = () => {
    if (!userInfo) return null;

    return (
      <div className="user-info-section">
        <h3>User Information</h3>
        <div className="info-item">
          <strong>Username:</strong> {userInfo.username}
        </div>
        <div className="info-item">
          <strong>Role:</strong> {userInfo.role}
        </div>
        {userInfo.created_at && (
          <div className="info-item">
            <strong>Account Created:</strong> {new Date(userInfo.created_at).toLocaleDateString()}
          </div>
        )}
      </div>
    );
  };

  return <>{showUserInfoAboveTabs && renderUserInfo()}</>;
};

SettingsHeader.propTypes = {
  userInfo: PropTypes.object,
  showUserInfoAboveTabs: PropTypes.bool.isRequired,
};

export default SettingsHeader;

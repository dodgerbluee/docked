/**
 * Settings header component
 */

import React from "react";
import PropTypes from "prop-types";
import { AlertTriangle } from "lucide-react";
import "../../Settings.css";

/**
 * Settings header component
 * @param {Object} props
 * @param {boolean} props.isFirstLogin - Whether this is first login
 * @param {Object} props.userInfo - User info object
 * @param {boolean} props.showUserInfoAboveTabs - Whether to show user info above tabs
 */
const SettingsHeader = ({ isFirstLogin, userInfo, showUserInfoAboveTabs }) => {
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
            <strong>Account Created:</strong>{" "}
            {new Date(userInfo.created_at).toLocaleDateString()}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {isFirstLogin && (
        <div className="first-login-warning">
          <h2>
            <AlertTriangle
              size={20}
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                marginRight: "8px",
              }}
            />
            First Time Login
          </h2>
          <p>You must change your password before accessing the application.</p>
        </div>
      )}

      {showUserInfoAboveTabs && renderUserInfo()}
    </>
  );
};

SettingsHeader.propTypes = {
  isFirstLogin: PropTypes.bool.isRequired,
  userInfo: PropTypes.object,
  showUserInfoAboveTabs: PropTypes.bool.isRequired,
};

export default SettingsHeader;

import React from "react";
import PropTypes from "prop-types";
import Settings from "./Settings";

/**
 * FirstLoginPage Component
 * Displays settings page for first-time login (password change required)
 */
function FirstLoginPage({
  username,
  onUsernameUpdate,
  onLogout,
  avatar,
  recentAvatars,
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
  onPasswordUpdateSuccess,
  onPortainerInstancesChange,
  onBatchConfigUpdate,
}) {
  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <div>
            <h1>
              <img
                src="/img/logo.png"
                alt="Docked"
                style={{ height: "1.9em", verticalAlign: "middle", marginRight: "12px" }}
              />
              <img
                src="/img/text-header.png"
                alt="docked"
                style={{ height: "1.25em", verticalAlign: "middle", maxWidth: "50%" }}
              />
            </h1>
            <p>Portainer Container Manager</p>
          </div>
        </div>
      </header>
      <div className="container">
        <Settings
          username={username}
          onUsernameUpdate={onUsernameUpdate}
          onLogout={onLogout}
          isFirstLogin={true}
          avatar={avatar}
          recentAvatars={recentAvatars}
          onAvatarChange={onAvatarChange}
          onRecentAvatarsChange={onRecentAvatarsChange}
          onAvatarUploaded={onAvatarUploaded}
          onPasswordUpdateSuccess={onPasswordUpdateSuccess}
          onPortainerInstancesChange={onPortainerInstancesChange}
          onBatchConfigUpdate={onBatchConfigUpdate}
        />
      </div>
    </div>
  );
}

FirstLoginPage.propTypes = {
  username: PropTypes.string,
  onUsernameUpdate: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  avatar: PropTypes.string,
  recentAvatars: PropTypes.arrayOf(PropTypes.string),
  onAvatarChange: PropTypes.func.isRequired,
  onRecentAvatarsChange: PropTypes.func.isRequired,
  onAvatarUploaded: PropTypes.func.isRequired,
  onPasswordUpdateSuccess: PropTypes.func.isRequired,
  onPortainerInstancesChange: PropTypes.func.isRequired,
  onBatchConfigUpdate: PropTypes.func.isRequired,
};

export default FirstLoginPage;


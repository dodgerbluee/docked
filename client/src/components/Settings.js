/**
 * Settings Component
 * Allows users to update their username and password
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Settings.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function Settings({ username, onUsernameUpdate, onLogout, isFirstLogin = false, onPasswordUpdateSuccess, onPortainerInstancesChange, activeSection = 'password', onSectionChange = null, showUserInfoAboveTabs = false, onEditInstance = null }) {
  const [userInfo, setUserInfo] = useState(null);
  // Use prop if provided, otherwise use internal state
  const [internalActiveSection, setInternalActiveSection] = useState(activeSection);
  const currentActiveSection = activeSection || internalActiveSection;
  const setActiveSection = onSectionChange || setInternalActiveSection;
  
  // Portainer instances state
  const [portainerInstances, setPortainerInstances] = useState([]);
  const [editingInstance, setEditingInstance] = useState(null);
  const [instanceForm, setInstanceForm] = useState({ name: '', url: '', username: '', password: '' });
  const [instanceError, setInstanceError] = useState('');
  const [instanceSuccess, setInstanceSuccess] = useState('');
  const [instanceLoading, setInstanceLoading] = useState(false);
  
  // Username update state
  const [newUsername, setNewUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);

  // Password update state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Docker Hub credentials state
  const [dockerHubUsername, setDockerHubUsername] = useState('');
  const [dockerHubToken, setDockerHubToken] = useState('');
  const [dockerHubError, setDockerHubError] = useState('');
  const [dockerHubSuccess, setDockerHubSuccess] = useState('');
  const [dockerHubLoading, setDockerHubLoading] = useState(false);
  const [dockerHubCredentials, setDockerHubCredentials] = useState(null);

  useEffect(() => {
    fetchUserInfo();
    fetchPortainerInstances();
    fetchDockerHubCredentials();
    // Update internal state when prop changes
    if (activeSection) {
      setInternalActiveSection(activeSection);
    }
    if (isFirstLogin) {
      if (onSectionChange) {
        onSectionChange('password');
      } else {
        setInternalActiveSection('password');
      }
    }
  }, [isFirstLogin, activeSection]);
  
  const fetchPortainerInstances = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/portainer/instances`);
      if (response.data.success) {
        setPortainerInstances(response.data.instances || []);
      }
    } catch (err) {
      console.error('Error fetching Portainer instances:', err);
    }
  };

  const fetchDockerHubCredentials = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/docker-hub/credentials`);
      if (response.data.success) {
        setDockerHubCredentials(response.data.credentials);
        if (response.data.credentials) {
          setDockerHubUsername(response.data.credentials.username || '');
        }
      }
    } catch (err) {
      console.error('Error fetching Docker Hub credentials:', err);
    }
  };

  const fetchUserInfo = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/auth/me`);
      if (response.data.success) {
        setUserInfo(response.data.user);
      }
    } catch (err) {
      console.error('Error fetching user info:', err);
    }
  };

  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    setUsernameError('');
    setUsernameSuccess('');
    setUsernameLoading(true);

    // Validate username
    if (newUsername.trim().length < 3) {
      setUsernameError('Username must be at least 3 characters long');
      setUsernameLoading(false);
      return;
    }

    if (newUsername.trim() === username) {
      setUsernameError('New username must be different from current username');
      setUsernameLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/update-username`, {
        newUsername: newUsername.trim(),
        password: usernamePassword,
      });

      if (response.data.success) {
        setUsernameSuccess('Username updated successfully!');
        setNewUsername('');
        setUsernamePassword('');
        // Update username in parent component
        if (onUsernameUpdate) {
          onUsernameUpdate(response.data.newUsername);
        }
        // Refresh user info
        await fetchUserInfo();
        // Clear success message after 3 seconds
        setTimeout(() => setUsernameSuccess(''), 3000);
      } else {
        setUsernameError(response.data.error || 'Failed to update username');
      }
    } catch (err) {
      setUsernameError(
        err.response?.data?.error || 'Failed to update username. Please try again.'
      );
    } finally {
      setUsernameLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordLoading(true);

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      setPasswordLoading(false);
      return;
    }

    // Validate password length
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long');
      setPasswordLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/update-password`, {
        currentPassword,
        newPassword,
      });

      if (response.data.success) {
        setPasswordSuccess('Password updated successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        // Refresh user info
        await fetchUserInfo();
        // If first login, notify parent to close settings
        if (isFirstLogin && onPasswordUpdateSuccess) {
          setTimeout(() => {
            onPasswordUpdateSuccess();
          }, 1500);
        } else {
          // Clear success message after 3 seconds
          setTimeout(() => setPasswordSuccess(''), 3000);
        }
      } else {
        setPasswordError(response.data.error || 'Failed to update password');
      }
    } catch (err) {
      setPasswordError(
        err.response?.data?.error || 'Failed to update password. Please try again.'
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleInstanceSubmit = async (e) => {
    e.preventDefault();
    setInstanceError('');
    setInstanceSuccess('');
    setInstanceLoading(true);

    try {
      if (editingInstance) {
        // Update existing instance
        await axios.put(`${API_BASE_URL}/api/portainer/instances/${editingInstance.id}`, instanceForm);
        setInstanceSuccess('Portainer instance updated successfully!');
      } else {
        // Create new instance
        await axios.post(`${API_BASE_URL}/api/portainer/instances`, instanceForm);
        setInstanceSuccess('Portainer instance added successfully!');
      }
      
      setInstanceForm({ name: '', url: '', username: '', password: '' });
      setEditingInstance(null);
      await fetchPortainerInstances();
      // Notify parent to refresh containers
      if (onPortainerInstancesChange) {
        onPortainerInstancesChange();
      }
      setTimeout(() => setInstanceSuccess(''), 3000);
    } catch (err) {
      setInstanceError(err.response?.data?.error || 'Failed to save Portainer instance');
    } finally {
      setInstanceLoading(false);
    }
  };

  const handleEditInstance = (instance) => {
    setEditingInstance(instance);
    setInstanceForm({
      name: instance.name,
      url: instance.url,
      username: instance.username || '',
      password: '', // Don't pre-fill password for security
    });
    setActiveSection('portainer');
  };

  const handleDeleteInstance = async (id) => {
    if (!window.confirm('Are you sure you want to delete this Portainer instance?')) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/api/portainer/instances/${id}`);
      setInstanceSuccess('Portainer instance deleted successfully!');
      await fetchPortainerInstances();
      // Notify parent to refresh containers
      if (onPortainerInstancesChange) {
        onPortainerInstancesChange();
      }
      setTimeout(() => setInstanceSuccess(''), 3000);
    } catch (err) {
      setInstanceError(err.response?.data?.error || 'Failed to delete Portainer instance');
    }
  };

  const handleCancelEdit = () => {
    setEditingInstance(null);
    setInstanceForm({ name: '', url: '', username: '', password: '' });
    setInstanceError('');
  };

  const handleDockerHubSubmit = async (e) => {
    e.preventDefault();
    setDockerHubError('');
    setDockerHubSuccess('');
    setDockerHubLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/docker-hub/credentials`, {
        username: dockerHubUsername.trim(),
        token: dockerHubToken.trim(),
      });

      if (response.data.success) {
        setDockerHubSuccess('Docker Hub credentials updated successfully!');
        setDockerHubToken('');
        await fetchDockerHubCredentials();
        setTimeout(() => setDockerHubSuccess(''), 3000);
      } else {
        setDockerHubError(response.data.error || 'Failed to update Docker Hub credentials');
      }
    } catch (err) {
      setDockerHubError(
        err.response?.data?.error || 'Failed to update Docker Hub credentials. Please try again.'
      );
    } finally {
      setDockerHubLoading(false);
    }
  };

  const handleDeleteDockerHubCreds = async () => {
    if (!window.confirm('Are you sure you want to remove Docker Hub credentials? This will revert to anonymous rate limits.')) {
      return;
    }

    try {
      const response = await axios.delete(`${API_BASE_URL}/api/docker-hub/credentials`);
      if (response.data.success) {
        setDockerHubSuccess('Docker Hub credentials removed successfully!');
        setDockerHubUsername('');
        setDockerHubToken('');
        setDockerHubCredentials(null);
        await fetchDockerHubCredentials();
        setTimeout(() => setDockerHubSuccess(''), 3000);
      } else {
        setDockerHubError(response.data.error || 'Failed to remove Docker Hub credentials');
      }
    } catch (err) {
      setDockerHubError(
        err.response?.data?.error || 'Failed to remove Docker Hub credentials. Please try again.'
      );
    }
  };

  return (
    <>
      {isFirstLogin && (
        <div className="first-login-warning">
          <h2>⚠️ First Time Login</h2>
          <p>You must change your password before accessing the application.</p>
        </div>
      )}

      {showUserInfoAboveTabs && userInfo && (
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
              <strong>Account Created:</strong>{' '}
              {new Date(userInfo.created_at).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {!showUserInfoAboveTabs && (
        <div className="settings-sections">
          {currentActiveSection === 'username' && (
            <div className="update-section">
              <h3>Change Username</h3>
              <form onSubmit={handleUsernameSubmit} className="update-form">
                <div className="form-group">
                  <label htmlFor="newUsername">New Username</label>
                  <input
                    type="text"
                    id="newUsername"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    required
                    autoComplete="username"
                    disabled={usernameLoading}
                    minLength={3}
                  />
                  <small>Must be at least 3 characters long</small>
                </div>
                <div className="form-group">
                  <label htmlFor="usernamePassword">Current Password</label>
                  <input
                    type="password"
                    id="usernamePassword"
                    value={usernamePassword}
                    onChange={(e) => setUsernamePassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    disabled={usernameLoading}
                  />
                  <small>Enter your current password to confirm</small>
                </div>
                {usernameError && <div className="error-message">{usernameError}</div>}
                {usernameSuccess && <div className="success-message">{usernameSuccess}</div>}
                <button
                  type="submit"
                  className="update-button"
                  disabled={usernameLoading || !newUsername || !usernamePassword}
                >
                  {usernameLoading ? 'Updating...' : 'Update Username'}
                </button>
              </form>
            </div>
          )}

          {currentActiveSection === 'password' && (
            <div className="update-section">
              <h3>Change Password</h3>
              <form onSubmit={handlePasswordSubmit} className="update-form">
                {!isFirstLogin && (
                  <div className="form-group">
                    <label htmlFor="currentPassword">Current Password</label>
                    <input
                      type="password"
                      id="currentPassword"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      disabled={passwordLoading}
                    />
                  </div>
                )}
                {isFirstLogin && (
                  <div className="form-group">
                    <label htmlFor="currentPassword">Current Password</label>
                    <input
                      type="password"
                      id="currentPassword"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      disabled={passwordLoading}
                    />
                    <small>Enter your current password to change it</small>
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="newPassword">New Password</label>
                  <input
                    type="password"
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    disabled={passwordLoading}
                    minLength={6}
                  />
                  <small>Must be at least 6 characters long</small>
                </div>
                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm New Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    disabled={passwordLoading}
                    minLength={6}
                  />
                </div>
                {passwordError && <div className="error-message">{passwordError}</div>}
                {passwordSuccess && <div className="success-message">{passwordSuccess}</div>}
                <button
                  type="submit"
                  className="update-button"
                  disabled={
                    passwordLoading ||
                    !newPassword ||
                    !confirmPassword ||
                    (!isFirstLogin && !currentPassword)
                  }
                >
                  {passwordLoading ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </div>
          )}

          {currentActiveSection === 'portainer' && (
            <div className="update-section">
              <h3>Manage Portainer Instances</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
                Manage your Portainer instances. Add new instances from the home page.
              </p>

              <div style={{ marginTop: '20px' }}>
                <h4 style={{ color: 'var(--text-primary)', marginBottom: '15px' }}>Existing Instances</h4>
                {portainerInstances.length === 0 ? (
                  <div className="empty-state" style={{ padding: '20px', textAlign: 'center' }}>
                    <p>No Portainer instances configured. Add one from the home page to get started.</p>
                  </div>
                ) : (
                  <div className="instances-list">
                    {portainerInstances.map((instance) => (
                      <div key={instance.id} className="instance-item" style={{
                        background: 'var(--bg-secondary)',
                        padding: '15px',
                        borderRadius: '8px',
                        marginBottom: '10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div>
                          <strong style={{ color: 'var(--text-primary)' }}>{instance.name}</strong>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '5px' }}>
                            {instance.url}
                          </div>
                          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: '3px' }}>
                            Username: {instance.username}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button
                            onClick={() => {
                              if (onEditInstance) {
                                onEditInstance(instance);
                              } else {
                                handleEditInstance(instance);
                              }
                            }}
                            className="update-button"
                            style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteInstance(instance.id)}
                            className="update-button"
                            style={{ 
                              padding: '8px 16px', 
                              fontSize: '0.9rem',
                              background: 'rgba(239, 62, 66, 0.2)',
                              borderColor: 'var(--dodger-red)',
                              color: 'var(--dodger-red)'
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {currentActiveSection === 'dockerhub' && (
            <div className="update-section">
              <h3>Docker Hub Authentication</h3>
              <div style={{ 
                background: 'var(--bg-secondary)', 
                padding: '15px', 
                borderRadius: '8px', 
                marginBottom: '20px',
                border: '1px solid var(--border-color)'
              }}>
                <h4 style={{ marginTop: 0, color: 'var(--text-primary)' }}>What is this used for?</h4>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '10px' }}>
                  Docker Hub authentication allows the application to use your personal account's rate limits instead of anonymous IP-based limits when checking for container updates.
                </p>
                <h4 style={{ color: 'var(--text-primary)' }}>Benefits:</h4>
                <ul style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: 0, paddingLeft: '20px' }}>
                  <li><strong>Higher Rate Limits:</strong> Authenticated users get 200 API requests per 6 hours vs 100 for anonymous users</li>
                  <li><strong>Faster Updates:</strong> With higher limits, the application can check more containers without hitting rate limits</li>
                  <li><strong>Reduced Errors:</strong> Fewer 429 (rate limit) errors means more reliable update detection</li>
                  <li><strong>Better Performance:</strong> Shorter delays between API calls (500ms vs 1000ms) when authenticated</li>
                </ul>
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', marginTop: '10px', marginBottom: 0 }}>
                  <strong>Note:</strong> Your credentials are stored securely in the database and only used for Docker Hub API authentication. 
                  You can create a Personal Access Token at <a href="https://hub.docker.com/settings/security" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--dodger-blue)' }}>hub.docker.com</a>.
                </p>
              </div>

              {dockerHubCredentials && (
                <div style={{ 
                  background: 'var(--bg-secondary)', 
                  padding: '15px', 
                  borderRadius: '8px', 
                  marginBottom: '20px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>Current Configuration</strong>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '5px' }}>
                        Username: {dockerHubCredentials.username}
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: '3px' }}>
                        {dockerHubCredentials.hasToken ? '✓ Token configured' : '✗ No token'}
                        {dockerHubCredentials.updated_at && (
                          <span style={{ marginLeft: '10px' }}>
                            • Last updated: {new Date(dockerHubCredentials.updated_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleDeleteDockerHubCreds}
                      className="update-button"
                      style={{ 
                        padding: '8px 16px', 
                        fontSize: '0.9rem',
                        background: 'rgba(239, 62, 66, 0.2)',
                        borderColor: 'var(--dodger-red)',
                        color: 'var(--dodger-red)'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleDockerHubSubmit} className="update-form">
                <div className="form-group">
                  <label htmlFor="dockerHubUsername">Docker Hub Username</label>
                  <input
                    type="text"
                    id="dockerHubUsername"
                    value={dockerHubUsername}
                    onChange={(e) => setDockerHubUsername(e.target.value)}
                    required
                    placeholder="your-dockerhub-username"
                    disabled={dockerHubLoading}
                  />
                  <small>Your Docker Hub account username</small>
                </div>
                <div className="form-group">
                  <label htmlFor="dockerHubToken">Personal Access Token</label>
                  <input
                    type="password"
                    id="dockerHubToken"
                    value={dockerHubToken}
                    onChange={(e) => setDockerHubToken(e.target.value)}
                    required={!dockerHubCredentials}
                    placeholder={dockerHubCredentials ? 'Leave blank to keep current token' : 'dckr_pat_...'}
                    disabled={dockerHubLoading}
                  />
                  <small>
                    {dockerHubCredentials 
                      ? 'Leave blank to keep the current token, or enter a new token to update'
                      : 'Create a Personal Access Token at hub.docker.com/settings/security'
                    }
                  </small>
                </div>
                {dockerHubError && <div className="error-message">{dockerHubError}</div>}
                {dockerHubSuccess && <div className="success-message">{dockerHubSuccess}</div>}
                <button
                  type="submit"
                  className="update-button"
                  disabled={dockerHubLoading || !dockerHubUsername || (!dockerHubToken && !dockerHubCredentials)}
                >
                  {dockerHubLoading ? 'Saving...' : dockerHubCredentials ? 'Update Credentials' : 'Save Credentials'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default Settings;

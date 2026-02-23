import React, { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Select from "react-select";
import { Crown, Shield, User } from "lucide-react";
import { API_BASE_URL } from "../../utils/api";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Card from "../ui/Card";
import LoadingSpinner from "../ui/LoadingSpinner";
import { formatDate } from "../../utils/batchFormatters";
import { selectStyles } from "../AddTrackedAppModal/utils/selectStyles";
import ChangePasswordModal from "./ChangePasswordModal";
import styles from "./UserDetailsModal.module.css";

/**
 * UserDetailsModal Component
 * Displays detailed user information and allows admin actions
 */
const UserDetailsModal = ({ isOpen, onClose, user, onUserUpdated, currentUsername }) => {
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState(null);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [role, setRole] = useState("");
  const [updatingRole, setUpdatingRole] = useState(false);
  const [roleUpdateError, setRoleUpdateError] = useState(null);
  const [roleUpdateSuccess, setRoleUpdateSuccess] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);

  useEffect(() => {
    if (isOpen && user) {
      fetchUserStats();
      fetchUserAvatar();
      // Initialize role state
      if (user.instanceAdmin) {
        setRole("Instance Admin");
      } else if (user.role === "Administrator") {
        setRole("Admin");
      } else {
        setRole("Member");
      }
    } else {
      setStats(null);
      setError(null);
      setRoleUpdateError(null);
      setRoleUpdateSuccess(null);
      if (avatarUrl && avatarUrl.startsWith("blob:")) {
        URL.revokeObjectURL(avatarUrl);
      }
      setAvatarUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user]);

  const fetchUserAvatar = async () => {
    if (!user?.id) return;

    try {
      // Fetch avatar as blob to handle authentication
      const response = await axios.get(`${API_BASE_URL}/api/avatars/user/${user.id}`, {
        responseType: "blob",
      });
      const blobUrl = URL.createObjectURL(response.data);
      // Clean up old blob URL if it exists
      if (avatarUrl && avatarUrl.startsWith("blob:")) {
        URL.revokeObjectURL(avatarUrl);
      }
      setAvatarUrl(blobUrl);
    } catch (err) {
      // If avatar doesn't exist or error, use default
      if (err.response?.status !== 404 && err.response?.status !== 204) {
        console.error("Error fetching user avatar:", err);
      }
      // Clean up old blob URL if it exists
      if (avatarUrl && avatarUrl.startsWith("blob:")) {
        URL.revokeObjectURL(avatarUrl);
      }
      setAvatarUrl("/img/default-avatar.jpg");
    }
  };

  const fetchUserStats = async () => {
    if (!user?.id) return;

    setLoadingStats(true);
    setError(null);

    try {
      const response = await axios.get(`${API_BASE_URL}/api/auth/users/${user.id}/stats`);
      if (response.data.success) {
        setStats(response.data.stats);
      } else {
        setError(response.data.error || "Failed to fetch user statistics");
      }
    } catch (err) {
      console.error("Error fetching user stats:", err);
      setError(err.response?.data?.error || err.message || "Failed to fetch user statistics");
    } finally {
      setLoadingStats(false);
    }
  };

  const roleOptions = useMemo(
    () => [
      {
        value: "Instance Admin",
        label: "Instance Admin",
        icon: Crown,
        badgeClass: "instanceAdmin",
      },
      {
        value: "Admin",
        label: "Admin",
        icon: Shield,
        badgeClass: "admin",
      },
      {
        value: "Member",
        label: "Member",
        icon: User,
        badgeClass: "member",
      },
    ],
    []
  );

  // Custom format option for react-select to show badges
  const formatOptionLabel = ({ value, label, icon: Icon, badgeClass }) => {
    return (
      <div className={styles.selectOption}>
        {Icon && <Icon size={16} className={styles.selectOptionIcon} />}
        <span>{label}</span>
      </div>
    );
  };

  const selectedRoleOption = useMemo(() => {
    const currentRole = role || "Member";
    return roleOptions.find((option) => option.value === currentRole) || roleOptions[2];
  }, [role, roleOptions]);

  const handleRoleChange = (selectedOption) => {
    if (!selectedOption) return;
    const selectedRole = selectedOption.value;
    setRole(selectedRole);
  };

  const handleSaveRole = async () => {
    if (!user?.id) return;

    setUpdatingRole(true);
    setRoleUpdateError(null);
    setRoleUpdateSuccess(null);

    try {
      // Map role display to actual role value
      let actualRole;
      let actualInstanceAdmin = false;

      if (role === "Instance Admin") {
        actualRole = "Administrator";
        actualInstanceAdmin = true;
      } else if (role === "Admin") {
        actualRole = "Administrator";
        actualInstanceAdmin = false;
      } else {
        // Member
        actualRole = "Member";
        actualInstanceAdmin = false;
      }

      const response = await axios.put(`${API_BASE_URL}/api/auth/users/${user.id}/role`, {
        role: actualRole,
        instanceAdmin: actualInstanceAdmin,
      });

      if (response.data.success) {
        // Update local state to reflect the new role
        setRole(role);
        setRoleUpdateSuccess("Role updated successfully");
        setTimeout(() => setRoleUpdateSuccess(null), 3000);
        if (onUserUpdated) {
          onUserUpdated();
        }
      } else {
        setRoleUpdateError(response.data.error || "Failed to update role");
      }
    } catch (err) {
      console.error("Error updating user role:", err);
      setRoleUpdateError(err.response?.data?.error || err.message || "Failed to update user role");
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!user?.id) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await axios.delete(`${API_BASE_URL}/api/auth/users/${user.id}`);
      if (response.data.success) {
        onClose();
        if (onUserUpdated) {
          onUserUpdated();
        }
      } else {
        setError(response.data.error || "Failed to delete user");
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to delete user");
    } finally {
      setDeleting(false);
    }
  };

  const isCurrentUser = currentUsername === user?.username;

  const getRoleBadge = () => {
    const currentRole = role || "Member";
    if (currentRole === "Instance Admin") {
      return {
        label: "Instance Admin",
        icon: Crown,
        className: styles.roleBadgeInstanceAdmin,
      };
    } else if (currentRole === "Admin") {
      return {
        label: "Admin",
        icon: Shield,
        className: styles.roleBadgeAdmin,
      };
    } else {
      return {
        label: "Member",
        icon: User,
        className: styles.roleBadgeMember,
      };
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="User Details" size="md">
        <div className={styles.modalContent}>
          {error && <Alert variant="error">{error}</Alert>}
          {roleUpdateError && <Alert variant="error">{roleUpdateError}</Alert>}
          {roleUpdateSuccess && <Alert variant="info">{roleUpdateSuccess}</Alert>}

          {user && (
            <>
              <Card variant="default" padding="md" className={styles.userInfoCard}>
                <div className={styles.avatarContainer}>
                  <img
                    src={avatarUrl || "/img/default-avatar.jpg"}
                    alt={`${user.username}'s avatar`}
                    className={styles.avatar}
                    onError={(e) => {
                      if (e.target.src !== "/img/default-avatar.jpg") {
                        e.target.src = "/img/default-avatar.jpg";
                      }
                    }}
                  />
                </div>
                <div className={styles.usernameDisplay}>
                  {user.username}
                  {(() => {
                    const badge = getRoleBadge();
                    const Icon = badge.icon;
                    return (
                      <span className={`${styles.roleBadge} ${badge.className}`}>
                        <Icon size={14} className={styles.roleBadgeIcon} />
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
                <div className={styles.infoGrid}>
                  {user.email && (
                    <div className={styles.infoItem}>
                      <span className={styles.infoLabel}>Email</span>
                      <span className={styles.infoValue}>{user.email}</span>
                    </div>
                  )}
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Creation Date</span>
                    <span className={styles.infoValue}>{formatDate(user.createdAt)}</span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Last Logged In</span>
                    <span className={styles.infoValue}>
                      {user.lastLogin ? formatDate(user.lastLogin) : "Never"}
                    </span>
                  </div>
                </div>
                <div className={styles.passwordSection}>
                  <div className={styles.dangerActions}>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setShowChangePasswordModal(true)}
                      className={styles.changePasswordButton}
                    >
                      Change Password
                    </Button>
                    {!isCurrentUser && (
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={deleting}
                        className={styles.deleteUserButton}
                      >
                        {deleting ? "Deleting..." : "Delete User"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              <Card variant="default" padding="md" className={styles.statsCard}>
                <h4 className={styles.sectionTitle}>Statistics</h4>
                {loadingStats ? (
                  <LoadingSpinner size="sm" message="Loading statistics..." />
                ) : stats ? (
                  <div className={styles.statsGrid}>
                    <div className={styles.statItem}>
                      <span className={styles.statLabel}>Portainer Instances</span>
                      <span className={styles.statValue}>{stats.portainerInstancesCount}</span>
                    </div>
                    <div className={styles.statItem}>
                      <span className={styles.statLabel}>Tracked Apps</span>
                      <span className={styles.statValue}>{stats.trackedAppsCount}</span>
                    </div>
                  </div>
                ) : (
                  <p className={styles.noStats}>Unable to load statistics</p>
                )}
              </Card>

              <Card variant="default" padding="md" className={styles.roleCard}>
                <div className={styles.roleSection}>
                  <label htmlFor="userRole" className={styles.roleLabel}>
                    Role
                  </label>
                  <Select
                    id="userRole"
                    value={selectedRoleOption}
                    onChange={handleRoleChange}
                    options={roleOptions}
                    isDisabled={updatingRole}
                    styles={selectStyles}
                    classNamePrefix="react-select"
                    isSearchable={false}
                    formatOptionLabel={formatOptionLabel}
                  />
                </div>
              </Card>

              <div className={styles.modalFooter}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleSaveRole}
                  disabled={updatingRole}
                  className={styles.saveButton}
                >
                  {updatingRole ? "Saving..." : "Save"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {user && (
        <>
          <ChangePasswordModal
            isOpen={showChangePasswordModal}
            onClose={() => setShowChangePasswordModal(false)}
            userId={user.id}
            username={user.username}
            onPasswordUpdated={() => {
              setShowChangePasswordModal(false);
              if (onUserUpdated) {
                onUserUpdated();
              }
            }}
          />
          <Modal
            isOpen={showDeleteConfirm}
            onClose={() => {
              setShowDeleteConfirm(false);
              setDeleteConfirmInput("");
            }}
            title="Delete User"
            size="sm"
            zIndex={4000}
          >
            <div className={styles.deleteConfirmContent}>
              <p className={styles.deleteConfirmMessage}>
                This will permanently remove <strong>{user.username}</strong> and all their
                associated data (instances, tracked apps, webhooks, etc.). This action cannot be
                undone.
              </p>
              <label htmlFor="deleteConfirmInput" className={styles.deleteConfirmLabel}>
                Type <strong>{user.username}</strong> to confirm
              </label>
              <input
                id="deleteConfirmInput"
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder={user.username}
                autoComplete="off"
                className={styles.deleteConfirmInput}
              />
              <div className={styles.deleteConfirmActions}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmInput("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmInput("");
                    handleDeleteUser();
                  }}
                  disabled={deleteConfirmInput !== user.username}
                  className={styles.deleteConfirmButton}
                >
                  Delete User
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </>
  );
};

UserDetailsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  user: PropTypes.shape({
    id: PropTypes.number.isRequired,
    username: PropTypes.string.isRequired,
    email: PropTypes.string,
    role: PropTypes.string,
    instanceAdmin: PropTypes.bool,
    createdAt: PropTypes.string,
    lastLogin: PropTypes.string,
  }),
  onUserUpdated: PropTypes.func,
  currentUsername: PropTypes.string,
};

export default UserDetailsModal;

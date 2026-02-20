import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Alert from "../ui/Alert";
import Button from "../ui/Button";
import { CardSkeleton } from "../ui/LoadingSkeleton";
import { formatDate } from "../../utils/batchFormatters";
import ImportUsersModal from "../ImportUsersModal";
import UserDetailsModal from "./UserDetailsModal";
import { Upload, Download, Crown, Shield, User } from "lucide-react";
import { useExport } from "../../hooks/useExport";
import styles from "./UsersTab.module.css";

/**
 * UsersTab Component
 * Displays a list of all users with their information
 */
const UsersTab = React.memo(function UsersTab() {
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserDetailsModal, setShowUserDetailsModal] = useState(false);

  // Use reusable export hook
  const { exporting, exportError, exportSuccess, handleExport } = useExport();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(`${API_BASE_URL}/api/auth/users`);
      if (response.data.success) {
        setUsers(response.data.users || []);
      } else {
        setError(response.data.error || "Failed to fetch users");
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadge = (user) => {
    if (user.instanceAdmin) {
      return {
        label: "Instance Admin",
        icon: Crown,
        className: styles.roleBadgeInstanceAdmin,
      };
    } else if (user.role === "Administrator") {
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

  const handleExportUsers = () => {
    handleExport("/api/auth/export-users", "docked-users-export", "Users exported successfully!");
  };

  const handleImportSuccess = () => {
    setShowImportModal(false);
    fetchUsers(); // Refresh the users list
  };

  const handleUserClick = (user) => {
    setSelectedUser(user);
    setShowUserDetailsModal(true);
  };

  const handleUserDetailsClose = () => {
    setShowUserDetailsModal(false);
    setSelectedUser(null);
  };

  const handleUserUpdated = () => {
    fetchUsers(); // Refresh the users list
  };

  if (loading) {
    return (
      <div className={styles.usersTab}>
        <CardSkeleton count={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.usersTab}>
        <Alert variant="error">{error}</Alert>
      </div>
    );
  }

  return (
    <div className={styles.usersTab}>
      <div className={styles.header}>
        <h3 className={styles.title}>Users</h3>
        <p className={styles.subtitle}>Manage and view all system users</p>
      </div>

      {users && users.length === 0 ? (
        <Alert variant="info">No users found.</Alert>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.usersTable}>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th className={styles.dateHeader}>Creation Date</th>
                <th className={styles.dateHeader}>Last Logged In</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className={styles.clickableRow}
                  onClick={() => handleUserClick(user)}
                >
                  <td className={styles.username}>{user.username}</td>
                  <td className={styles.role}>
                    {(() => {
                      const badge = getRoleBadge(user);
                      const Icon = badge.icon;
                      return (
                        <span className={`${styles.roleBadge} ${badge.className}`}>
                          <Icon size={14} className={styles.roleBadgeIcon} />
                          {badge.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className={styles.date}>{formatDate(user.createdAt)}</td>
                  <td className={styles.date}>
                    {user.lastLogin ? formatDate(user.lastLogin) : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* User Management Actions */}
      <div className={styles.userActions}>
        {exportSuccess && <Alert variant="info">{exportSuccess}</Alert>}
        {exportError && <Alert variant="error">{exportError}</Alert>}

        <div className={styles.actionButtons}>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setShowImportModal(true)}
            icon={Upload}
            iconPosition="left"
            className={styles.actionButton}
          >
            Import Users
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleExportUsers}
            disabled={exporting}
            icon={Download}
            iconPosition="left"
            className={styles.actionButton}
          >
            {exporting ? "Exporting..." : "Export Users"}
          </Button>
        </div>
      </div>

      <ImportUsersModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onSuccess={handleImportSuccess}
      />

      {selectedUser && (
        <UserDetailsModal
          isOpen={showUserDetailsModal}
          onClose={handleUserDetailsClose}
          user={selectedUser}
          onUserUpdated={handleUserUpdated}
        />
      )}
    </div>
  );
});

UsersTab.propTypes = {
  // UsersTab is a self-contained component with no props
  // All data is fetched via hooks internally
};

export default UsersTab;

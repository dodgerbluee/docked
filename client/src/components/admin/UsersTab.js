import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Card from "../ui/Card";
import Alert from "../ui/Alert";
import Button from "../ui/Button";
import { CardSkeleton } from "../ui/LoadingSkeleton";
import { formatDate } from "../../utils/batchFormatters";
import ImportUsersModal from "../ImportUsersModal";
import { Upload, Download } from "lucide-react";
import styles from "./UsersTab.module.css";

/**
 * UsersTab Component
 * Displays a list of all users with their information
 */
function UsersTab() {
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");

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

  const getRoleDisplay = (user) => {
    if (user.instanceAdmin) {
      return "Instance Admin";
    }
    return user.role || "Administrator";
  };

  const handleExportUsers = async () => {
    setExporting(true);
    setExportError("");
    setExportSuccess("");

    try {
      const response = await axios.get(`${API_BASE_URL}/api/auth/export-users`);

      if (response.data.success) {
        const jsonString = JSON.stringify(response.data.data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `docked-users-export-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(link);
        link.click();

        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setExportSuccess("Users exported successfully!");
        setTimeout(() => setExportSuccess(""), 3000);
      } else {
        setExportError(response.data.error || "Failed to export users");
      }
    } catch (err) {
      console.error("Error exporting users:", err);
      setExportError(
        err.response?.data?.error || "Failed to export users. Please try again."
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImportSuccess = () => {
    setShowImportModal(false);
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
                <th>Email</th>
                <th>Creation Date</th>
                <th>Last Logged In</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className={styles.username}>{user.username}</td>
                  <td className={styles.email}>{user.email || "-"}</td>
                  <td className={styles.date}>{formatDate(user.createdAt)}</td>
                  <td className={styles.date}>
                    {user.lastLogin ? formatDate(user.lastLogin) : "Never"}
                  </td>
                  <td className={styles.role}>
                    <span
                      className={`${styles.roleBadge} ${
                        user.instanceAdmin ? styles.instanceAdmin : styles.admin
                      }`}
                    >
                      {getRoleDisplay(user)}
                    </span>
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
            variant="primary"
            onClick={() => setShowImportModal(true)}
            icon={Upload}
            className={styles.actionButton}
          >
            Import Users
          </Button>
          
          <Button
            type="button"
            variant="primary"
            onClick={handleExportUsers}
            disabled={exporting}
            icon={Download}
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
    </div>
  );
}

export default UsersTab;


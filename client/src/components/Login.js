/**
 * Login Component
 * Handles user authentication
 */

import React, { useState, useEffect } from "react";
import axios from "axios";
import "./Login.css";
import { API_BASE_URL } from "../constants/api";
import CreateUserModal from "./CreateUserModal";
import ImportUsersModal from "./ImportUsersModal";
import { Upload, UserPlus } from "lucide-react";

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showImportUsersModal, setShowImportUsersModal] = useState(false);
  const [createUserSuccess, setCreateUserSuccess] = useState("");

  // Clear any stale auth data when component mounts
  useEffect(() => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("username");
    // Clear axios defaults
    delete axios.defaults.headers.common["Authorization"];
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Create a completely clean axios instance for login
      // This ensures no default headers (like Authorization) are sent
      const loginAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Explicitly remove any Authorization header
      delete loginAxios.defaults.headers.common["Authorization"];
      delete loginAxios.defaults.headers.Authorization;

      const response = await loginAxios.post("/api/auth/login", {
        username,
        password,
      });

      if (response.data.success) {
        // Clear success message on successful login
        setCreateUserSuccess("");
        // Clear welcome modal flag on new login (so it shows again for new users)
        localStorage.removeItem("welcomeModalShown");
        // Store token in localStorage
        localStorage.setItem("authToken", response.data.token);
        localStorage.setItem("username", username);
        // Store role if provided
        if (response.data.role) {
          localStorage.setItem("userRole", response.data.role);
        }
        // Store instance admin status
        if (response.data.instanceAdmin !== undefined) {
          localStorage.setItem("instanceAdmin", response.data.instanceAdmin ? "true" : "false");
        }
        onLogin(
          response.data.token,
          username,
          response.data.role || "Administrator",
          response.data.instanceAdmin || false
        );
      } else {
        setError(response.data.error || "Login failed");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container" role="main" aria-label="Login page">
      <div className="login-card">
        <div className="login-header">
          <h1>
            <img
              src="/img/logo.png"
              alt="Docked"
              style={{
                height: "2em",
                verticalAlign: "middle",
                marginRight: "12px",
                display: "inline-block",
              }}
            />
            <img
              src="/img/text-header.png"
              alt="docked"
              style={{
                height: "1.25em",
                verticalAlign: "middle",
                display: "inline-block",
                maxWidth: "50%",
              }}
            />
          </h1>
          <p>Update Manager</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          {createUserSuccess && (
            <div className="success-message" role="alert" aria-live="assertive">
              {createUserSuccess}
            </div>
          )}
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              disabled={loading}
              aria-required="true"
              aria-invalid={error && error.includes("username") ? "true" : "false"}
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={loading}
              aria-required="true"
              aria-invalid={error && error.includes("password") ? "true" : "false"}
            />
          </div>
          {error && (
            <div className="error-message" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="login-button"
            disabled={loading || !username || !password}
            aria-busy={loading}
            aria-label={loading ? "Logging in, please wait" : "Login to your account"}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
        <div className="create-user-section">
          <button
            type="button"
            className="create-user-button"
            onClick={() => setShowCreateUserModal(true)}
            disabled={loading}
            aria-label="Create a new user account"
          >
            <UserPlus size={18} style={{ marginRight: "8px" }} />
            Create User
          </button>
          <button
            type="button"
            className="import-users-button"
            onClick={() => setShowImportUsersModal(true)}
            disabled={loading}
            aria-label="Import users from JSON file"
            title="Import Users"
          >
            <Upload size={16} />
          </button>
        </div>
      </div>
      <CreateUserModal
        isOpen={showCreateUserModal}
        onClose={() => {
          setShowCreateUserModal(false);
          setCreateUserSuccess("");
        }}
        onSuccess={(username) => {
          setCreateUserSuccess(`Successfully created ${username}!`);
          setShowCreateUserModal(false);
        }}
      />
      <ImportUsersModal
        isOpen={showImportUsersModal}
        onClose={() => {
          setShowImportUsersModal(false);
          setCreateUserSuccess("");
        }}
        onSuccess={(message) => {
          setCreateUserSuccess(message);
          setShowImportUsersModal(false);
        }}
      />
    </div>
  );
}

export default Login;

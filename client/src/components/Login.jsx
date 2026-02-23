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
import { Upload, UserPlus, LogIn } from "lucide-react";

const AuthentikIcon = ({ size = 18 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M21.979 7.121a3.15 3.15 0 0 0-1.957-2.556l-.013-.006l-.055-.02l-.048-.018l-.022-.008l-.147-.047c-.047-.014-.1-.027-.145-.039q-.035-.01-.072-.016a3 3 0 0 0-.426-.06H9.588q-.073.006-.147.015h-.017l-.073.011l-.046.007l-.047.008l-.092.018h-.019l-.056.013h-.006l-.056.014L9 4.45q-.075.02-.148.044h-.013l-.078.027l-.017.007l-.076.028h-.01a3.15 3.15 0 0 0-1.442 1.175a3.1 3.1 0 0 0-.516 1.39a3 3 0 0 0-.021.36v3.687l-.09-.125a2.84 2.84 0 0 0-2.04-1.338a2.55 2.55 0 0 0 0 5.1c1.46 0 2.664-2.166 2.664-2.549a2.6 2.6 0 0 0-.448-.961h5.137V8.241h1.028v1.264h.7V8.241h1.12v.745h.7v-.745h1.324v5.435H6.683v2.842a3.144 3.144 0 0 0 3.141 3.141h1.333v-3.077h6.367v3.076h1.334A3.144 3.144 0 0 0 22 16.517V7.481a3 3 0 0 0-.021-.36M3.5 11.043a1.28 1.28 0 0 1 1.84 0a4.5 4.5 0 0 1 .911 1.207c-1.64 3.422-4.509.506-2.751-1.207" />
  </svg>
);

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showImportUsersModal, setShowImportUsersModal] = useState(false);
  const [createUserSuccess, setCreateUserSuccess] = useState("");
  const [oauthProviders, setOauthProviders] = useState([]);
  const [allowLocalLogin, setAllowLocalLogin] = useState(true);

  // Clear any stale auth data when component mounts
  useEffect(() => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("username");
    // Clear axios defaults
    delete axios.defaults.headers.common["Authorization"];

    // Fetch available OAuth providers
    const fetchProviders = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/auth/oauth/providers`);
        if (response.data.success && response.data.providers) {
          setOauthProviders(response.data.providers);
          if (response.data.allowLocalLogin !== undefined) {
            setAllowLocalLogin(response.data.allowLocalLogin);
          }
        }
      } catch {
        // OAuth not available - that's fine, just show password login
      }
    };
    fetchProviders();
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

  const handleOAuthLogin = (providerName) => {
    // Navigate to the backend OAuth initiation endpoint
    // This will redirect the user to the provider's login page
    const loginUrl = `${API_BASE_URL}/api/auth/oauth/login?provider=${encodeURIComponent(providerName)}`;
    window.location.href = loginUrl;
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
        {allowLocalLogin && (
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
        )}
        {oauthProviders.length > 0 && (
          <>
            {allowLocalLogin && (
              <div className="oauth-divider">
                <span>or</span>
              </div>
            )}
            <div className="oauth-providers">
              {oauthProviders.map((provider) => (
                <button
                  key={provider.name}
                  type="button"
                  className="oauth-login-button"
                  onClick={() => handleOAuthLogin(provider.name)}
                  disabled={loading}
                  aria-label={`Sign in with ${provider.displayName}`}
                >
                  {provider.name.toLowerCase().includes("authentik") ? (
                    <AuthentikIcon size={27} />
                  ) : (
                    <LogIn size={18} />
                  )}
                  Sign in with {provider.displayName}
                </button>
              ))}
            </div>
          </>
        )}
        {!allowLocalLogin && error && (
          <div className="error-message" role="alert" aria-live="assertive" style={{ marginTop: "16px" }}>
            {error}
          </div>
        )}
        {allowLocalLogin && (
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
        )}
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

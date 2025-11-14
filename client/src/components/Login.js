/**
 * Login Component
 * Handles user authentication
 */

import React, { useState, useEffect } from "react";
import { authApi } from "../services/apiClient";
import { getErrorMessage, AuthenticationError, ValidationError } from "../domain/errors";
import "./Login.css";

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Clear any stale auth data when component mounts
  useEffect(() => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("username");
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Validate input
      if (!username || username.trim().length === 0) {
        setError("Username is required");
        setLoading(false);
        return;
      }
      
      if (!password || password.length === 0) {
        setError("Password is required");
        setLoading(false);
        return;
      }

      const response = await authApi.login(username.trim(), password);

      if (response.success && response.token) {
        // Store token in localStorage
        const { token, passwordChanged, role } = response;
        localStorage.setItem("authToken", token);
        localStorage.setItem("username", username.trim());
        localStorage.setItem(
          "passwordChanged",
          passwordChanged ? "true" : "false"
        );
        // Store role if provided
        if (role) {
          localStorage.setItem("userRole", role);
        }
        onLogin(
          token,
          username.trim(),
          passwordChanged,
          role || "Administrator"
        );
      } else {
        setError(response.error || "Login failed");
      }
    } catch (err) {
      // Use typed error handling
      const errorMessage = getErrorMessage(err, "Failed to connect to server. Please try again.");
      setError(errorMessage);
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
              src="/img/image.png"
              alt="Docked"
              style={{
                height: "2em",
                verticalAlign: "middle",
                marginRight: "8px",
                display: "inline-block",
              }}
            />
            <span
              style={{ display: "inline-block", transform: "translateY(3px)" }}
            >
              Docked
            </span>
          </h1>
          <p>Portainer Container Manager</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
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
      </div>
    </div>
  );
}

export default Login;

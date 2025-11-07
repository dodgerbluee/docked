/**
 * Login Component
 * Handles user authentication
 */

import React, { useState, useEffect } from "react";
import axios from "axios";
import "./Login.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:3001";

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        // Store token in localStorage
        localStorage.setItem("authToken", response.data.token);
        localStorage.setItem("username", username);
        localStorage.setItem(
          "passwordChanged",
          response.data.passwordChanged ? "true" : "false"
        );
        onLogin(response.data.token, username, response.data.passwordChanged);
      } else {
        setError(response.data.error || "Login failed");
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          "Failed to connect to server. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>🐳 Docked</h1>
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
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button
            type="submit"
            className="login-button"
            disabled={loading || !username || !password}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;

/**
 * OAuthCallback Component
 *
 * Handles the OAuth provider redirect. Parses authentication data from
 * URL query parameters and completes the login flow.
 *
 * URL params (on success):
 *   token, refreshToken, username, role, instanceAdmin
 *
 * URL params (on error):
 *   error - Error message from provider or backend
 *
 * URL params (on link required):
 *   linkRequired=true, linkToken, username
 *   Shows a password prompt to confirm linking OAuth to existing account.
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import Cookies from "js-cookie";
import LoadingSpinner from "./ui/LoadingSpinner";
import { API_BASE_URL } from "../constants/api";

function OAuthCallback({ onLogin }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [linkState, setLinkState] = useState(null);
  const [password, setPassword] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState("");
  const processedRef = useRef(false);

  const completeLogin = useCallback(
    ({ token, refreshToken, username, role, instanceAdmin }) => {
      // Store tokens in localStorage (same as Login.jsx)
      localStorage.setItem("authToken", token);
      localStorage.setItem("username", username);
      if (refreshToken) {
        localStorage.setItem("refreshToken", refreshToken);
      }
      if (role) {
        localStorage.setItem("userRole", role);
      }
      localStorage.setItem("instanceAdmin", instanceAdmin ? "true" : "false");
      // Clear welcome modal flag on new login
      localStorage.removeItem("welcomeModalShown");

      // Clear cookies after reading
      Cookies.remove("authToken");
      Cookies.remove("refreshToken");
      Cookies.remove("username");
      Cookies.remove("userRole");
      Cookies.remove("instanceAdmin");

      // Complete login via the App's auth handler
      onLogin(token, username, role || "Administrator", instanceAdmin);

      // Navigate to home
      navigate("/", { replace: true });
    },
    [onLogin, navigate]
  );

  useEffect(() => {
    // Prevent double-processing in React strict mode
    if (processedRef.current) return;
    processedRef.current = true;

    const errorParam = searchParams.get("error");
    if (errorParam) {
      setError(errorParam);
      // Redirect to login after showing error briefly
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 4000);
      return;
    }

    // Check if account linking is required
    if (searchParams.get("linkRequired") === "true") {
      setLinkState({
        linkToken: searchParams.get("linkToken"),
        username: searchParams.get("username"),
      });
      return;
    }

    const token = Cookies.get("authToken");
    const username = Cookies.get("username");
    const role = Cookies.get("userRole");
    const instanceAdmin = Cookies.get("instanceAdmin") === "true";
    const refreshToken = Cookies.get("refreshToken");

    if (!token || !username) {
      setError("Invalid authentication response. Please try again.");
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 4000);
      return;
    }

    completeLogin({ token, refreshToken, username, role, instanceAdmin });
  }, [searchParams, completeLogin, navigate]);

  async function handleLinkSubmit(e) {
    e.preventDefault();
    setLinkError("");
    setLinkLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/auth/oauth/link`, {
        linkToken: linkState.linkToken,
        password,
      });

      if (response.data.success) {
        completeLogin({
          token: response.data.token,
          refreshToken: response.data.refreshToken,
          username: response.data.username,
          role: response.data.role,
          instanceAdmin: response.data.instanceAdmin,
        });
      } else {
        setLinkError(response.data.error || "Linking failed");
      }
    } catch (err) {
      setLinkError(err.response?.data?.error || "Failed to link account. Please try again.");
    } finally {
      setLinkLoading(false);
    }
  }

  // Account linking UI
  if (linkState) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          width: "100vw",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "var(--bg-secondary, #f5f5f5)",
            border: "1px solid var(--border-color, #ddd)",
            borderRadius: "12px",
            padding: "32px",
            maxWidth: "420px",
            width: "100%",
          }}
        >
          <h2
            style={{ margin: "0 0 8px 0", color: "var(--text-primary, #222)", fontSize: "1.3rem" }}
          >
            Link your account
          </h2>
          <p
            style={{
              color: "var(--text-secondary, #666)",
              margin: "0 0 20px 0",
              fontSize: "0.95rem",
              lineHeight: 1.5,
            }}
          >
            An account with the username <strong>{linkState.username}</strong> already exists. Enter
            your password to link your SSO identity to this account. Once linked, you can sign in
            with either method.
          </p>
          <form onSubmit={handleLinkSubmit}>
            <div style={{ marginBottom: "16px" }}>
              <label
                htmlFor="linkPassword"
                style={{
                  display: "block",
                  fontWeight: 600,
                  color: "var(--text-primary, #222)",
                  marginBottom: "6px",
                  fontSize: "0.95rem",
                }}
              >
                Password for {linkState.username}
              </label>
              <input
                id="linkPassword"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (linkError) setLinkError("");
                }}
                required
                autoFocus
                disabled={linkLoading}
                placeholder="Enter your password"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: "1rem",
                  fontFamily: "inherit",
                  color: "var(--text-primary, #222)",
                  background: "var(--bg-primary, #fff)",
                  border: "2px solid var(--border-color, #ddd)",
                  borderRadius: "8px",
                  boxSizing: "border-box",
                }}
              />
            </div>
            {linkError && (
              <div
                style={{
                  background: "rgba(239, 62, 66, 0.1)",
                  border: "1px solid var(--dodger-red, #ef3e42)",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  color: "var(--dodger-red, #ef3e42)",
                  fontSize: "0.9rem",
                  marginBottom: "16px",
                }}
              >
                {linkError}
              </div>
            )}
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => navigate("/", { replace: true })}
                disabled={linkLoading}
                style={{
                  padding: "10px 20px",
                  border: "1px solid var(--border-color, #ddd)",
                  borderRadius: "8px",
                  background: "transparent",
                  color: "var(--text-secondary, #666)",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={linkLoading || !password}
                style={{
                  padding: "10px 20px",
                  border: "none",
                  borderRadius: "8px",
                  background: "var(--dodger-blue, #1e90ff)",
                  color: "#fff",
                  cursor: linkLoading || !password ? "not-allowed" : "pointer",
                  opacity: linkLoading || !password ? 0.6 : 1,
                  fontSize: "0.95rem",
                  fontWeight: 600,
                  fontFamily: "inherit",
                }}
              >
                {linkLoading ? "Linking..." : "Link Account & Sign In"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          width: "100vw",
          gap: "16px",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "rgba(239, 62, 66, 0.1)",
            border: "1px solid var(--dodger-red, #ef3e42)",
            borderRadius: "8px",
            padding: "20px 32px",
            color: "var(--dodger-red, #ef3e42)",
            fontSize: "1rem",
            textAlign: "center",
            maxWidth: "480px",
          }}
        >
          <strong>Sign-in failed</strong>
          <br />
          <span style={{ marginTop: "8px", display: "block" }}>{error}</span>
        </div>
        <span style={{ color: "var(--text-secondary, #888)", fontSize: "0.85rem" }}>
          Redirecting to login...
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        width: "100vw",
      }}
    >
      <LoadingSpinner size="md" message="Completing sign-in..." />
    </div>
  );
}

export default OAuthCallback;

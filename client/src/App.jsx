import React, { useEffect, useCallback } from "react";
import { Routes, Route } from "react-router-dom";
import "./App.css";
import "./styles/responsive.css";
import { initializePerformanceMonitoring, MobilePerformance } from "./utils/performance";

// PWA Service Worker Registration
const registerServiceWorker = () => {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("SW registered: ", registration);
        })
        .catch((registrationError) => {
          console.log("SW registration failed: ", registrationError);
        });
    });
  }
};
import Login from "./components/Login";
import OAuthCallback from "./components/OAuthCallback";
import LoadingSpinner from "./components/ui/LoadingSpinner";
import { useAuth } from "./hooks/useAuth";
import { revokeCurrentSession } from "./graphql/client";
import SessionApp from "./SessionApp";

/**
 * Session shell: owns authentication state and the session lifecycle, and
 * renders the session-scoped tree (SessionApp) under a key that changes on
 * every login/logout. Everything user-scoped lives inside SessionApp so it is
 * unmounted — not merely reset — when the identity changes.
 */
function App() {
  // Authentication state - using custom hook
  const {
    isAuthenticated,
    authToken,
    username,
    userRole,
    instanceAdmin,
    isValidating,
    sessionKey,
    handleLogin,
    handleUsernameUpdate,
    handlePasswordUpdateSuccess,
    handleLogout,
  } = useAuth();

  // Initialize performance monitoring and PWA
  useEffect(() => {
    // Performance monitoring
    initializePerformanceMonitoring();

    // Mobile optimizations
    if (MobilePerformance.isLowEndDevice()) {
      console.log("Low-end device detected, enabling performance optimizations");
      // Could disable animations, reduce polling frequency, etc.
    }

    // Service worker
    registerServiceWorker();

    // Cleanup on unmount
    return () => {
      if (window.performanceMonitor) {
        window.performanceMonitor.cleanup();
      }
    };
  }, []);

  const handleLogoutWithCleanup = useCallback(() => {
    // Revoke the presented token server-side (best-effort) before the local
    // clear wipes it, so a leaked token can't be replayed until its exp.
    revokeCurrentSession();
    // Error/pull state lives inside SessionApp and dies with the unmount.
    handleLogout();
  }, [handleLogout]);

  // Show login page if not authenticated
  // Show loading spinner while validating token
  if (isValidating) {
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
        <LoadingSpinner size="md" message="Validating session..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    // OAuth callback must be accessible while unauthenticated
    // (user is in the middle of the SSO login flow)
    return (
      <Routes>
        <Route path="/auth/oauth/complete" element={<OAuthCallback onLogin={handleLogin} />} />
        <Route path="*" element={<Login onLogin={handleLogin} />} />
      </Routes>
    );
  }

  // key={sessionKey}: a new identity gets a brand-new SessionApp instance.
  // Every session-scoped hook (avatar, batch config, upgrade state, pull
  // state, notifications, tabs, selections) is destroyed on logout and
  // re-initialized for the next user instead of surviving the transition.
  return (
    <SessionApp
      key={sessionKey}
      authToken={authToken}
      username={username}
      userRole={userRole}
      instanceAdmin={instanceAdmin}
      handleUsernameUpdate={handleUsernameUpdate}
      handlePasswordUpdateSuccess={handlePasswordUpdateSuccess}
      handleLogoutWithCleanup={handleLogoutWithCleanup}
    />
  );
}

// Export the context for use in other components
// BatchConfigContext is exported from contexts/BatchConfigContext.js

export default App;

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree
 */

import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
    this._isMounted = false;
    this._error = null;
    this._errorInfo = null;
  }

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    // Store error info directly in state to avoid setState in componentDidCatch
    return {
      hasError: true,
      error: error,
      errorInfo: null, // Will be set in componentDidCatch if needed
    };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console (in production, send to error reporting service)
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // Store errorInfo separately using a ref to avoid setState issues
    // componentDidCatch should only be used for side effects, not state updates
    this._errorInfo = errorInfo;
    this._error = error;

    // Force a re-render by updating state only if component is mounted
    // Use requestAnimationFrame to defer to next frame
    if (this._isMounted) {
      requestAnimationFrame(() => {
        if (this._isMounted) {
          try {
            this.setState({
              error: this._error,
              errorInfo: this._errorInfo,
            });
          } catch (setStateError) {
            // Silently fail - error is already logged
            console.error("Error updating ErrorBoundary state:", setStateError);
          }
        }
      });
    }

    // In production, you would log this to an error reporting service
    // Example: Sentry.captureException(error, { contexts: { react: errorInfo } });
  }

  handleReset = () => {
    if (this._isMounted) {
      try {
        this.setState({ hasError: false, error: null, errorInfo: null });
      } catch (setStateError) {
        // If setState fails, just reload the page
        console.error("Error resetting ErrorBoundary state:", setStateError);
        window.location.reload();
        return;
      }
    }
    // Optionally reload the page
    if (this.props.resetOnError) {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback(
          this.state.error || new Error("Unknown error"),
          this.handleReset
        );
      }

      // Default fallback UI
      return (
        <div
          style={{
            padding: "2rem",
            maxWidth: "600px",
            margin: "0 auto",
            textAlign: "center",
          }}
        >
          <h1 style={{ color: "#d32f2f", marginBottom: "1rem" }}>Something went wrong</h1>
          <p style={{ marginBottom: "1.5rem", color: "#666" }}>
            We{'\''}re sorry, but something unexpected happened. Please try refreshing the page.
          </p>
          <div style={{ marginBottom: "1.5rem" }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#1976d2",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "1rem",
                marginRight: "1rem",
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#f5f5f5",
                color: "#333",
                border: "1px solid #ddd",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "1rem",
              }}
            >
              Go Home
            </button>
          </div>
          {process.env.NODE_ENV === "development" && (this.state.error || this.state.errorInfo) && (
            <details
              style={{
                marginTop: "2rem",
                textAlign: "left",
                backgroundColor: "#f5f5f5",
                padding: "1rem",
                borderRadius: "4px",
                fontSize: "0.875rem",
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
                Error Details (Development Only)
              </summary>
              <pre
                style={{
                  marginTop: "1rem",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {this.state.error ? this.state.error.toString() : "Error occurred"}
                {this.state.errorInfo?.componentStack
                  ? "\n\n" + this.state.errorInfo.componentStack
                  : ""}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

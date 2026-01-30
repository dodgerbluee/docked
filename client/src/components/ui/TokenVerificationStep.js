import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Input from "./Input";
import Alert from "./Alert";
import { CheckCircle, XCircle, RefreshCw } from "lucide-react";
import styles from "./TokenVerificationStep.module.css";

/**
 * TokenVerificationStep Component
 * Reusable component for token verification with customizable title, icon, and messaging
 */
function TokenVerificationStep({
  title = "Verification",
  icon: Icon,
  user,
  token,
  tokenLabel = "Verification Token",
  instruction,
  onVerify,
  onRegenerate,
  onTokenChange,
  verifying = false,
  regenerating = false,
  verified,
  error: errorProp,
  showToken = true,
  tokenPlaceholder = "Enter verification token (e.g., XXXX-XXXX-XXXX)",
}) {
  const [inputToken, setInputToken] = useState("");
  const [error, setError] = useState("");
  const [currentToken, setCurrentToken] = useState(token || "");

  // Use error prop if provided, otherwise use local error state
  // Prioritize errorProp since it comes from parent and is the source of truth
  const displayError = errorProp !== undefined && errorProp !== null ? errorProp : error;

  // Reset input when verified state changes to undefined (cleared)
  // BUT don't clear if there's an error prop - we want to keep the input so user can see what they entered
  useEffect(() => {
    if (verified === undefined && !errorProp) {
      setInputToken("");
      setError("");
    }
  }, [verified, errorProp]);

  // Don't clear local error when error prop changes - let parent manage it
  // Only clear local error if error prop is explicitly cleared (empty string or null)
  useEffect(() => {
    if (errorProp === null || errorProp === "") {
      setError("");
    }
  }, [errorProp]);

  // Update currentToken when token prop changes
  useEffect(() => {
    if (token) {
      setCurrentToken(token);
    }
  }, [token]);

  // Notify parent of token changes
  useEffect(() => {
    if (onTokenChange) {
      onTokenChange(inputToken);
    }
  }, [inputToken, onTokenChange]);

  const handleRegenerate = async () => {
    if (onRegenerate) {
      setError("");
      try {
        await onRegenerate();
        // Token is logged to server logs, not returned or displayed
        // Clear input to prompt user to enter new token from logs
        setInputToken("");
      } catch {
        // Error handling is done in parent component
      }
    }
  };

  return (
    <div className={styles.stepContainer}>
      {title && (
        <div className={styles.header}>
          {Icon && <Icon size={24} className={styles.icon} />}
          <h3 className={styles.title}>{title}</h3>
        </div>
      )}

      {user && (
        <div className={styles.userInfo}>
          <p className={styles.userName}>
            User: <strong>{typeof user === "string" ? user : user.username || user}</strong>
          </p>
          {instruction && <p className={styles.instruction}>{instruction}</p>}
        </div>
      )}

      {/* Regenerate button - always show if onRegenerate is provided, even if showToken is false */}
      {onRegenerate && (
        <div className={styles.regenerateSection}>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating || verifying || verified === true}
            className={styles.regenerateButton}
            title="Generate a new verification token (will be logged to server logs)"
          >
            <RefreshCw size={14} className={regenerating ? styles.regenerating : ""} />
            {regenerating ? "Regenerating..." : "Regenerate Token"}
          </button>
          <small className={styles.regenerateHint}>
            A new token will be generated and logged to the container logs.
          </small>
        </div>
      )}

      {showToken && (
        <Alert variant="info" className={styles.tokenAlert}>
          <div className={styles.tokenInfo}>
            <div className={styles.tokenHeader}>
              <strong>{tokenLabel}:</strong>
            </div>
            {currentToken || token ? (
              <>
                <code className={styles.tokenCode}>{currentToken || token}</code>
                <small>This token is also available in the server logs.</small>
              </>
            ) : (
              <small>
                Click {'"'}Generate{'"'} to create a verification token.
              </small>
            )}
          </div>
        </Alert>
      )}

      {verified === true && (
        <Alert variant="success" className={styles.statusAlert}>
          <CheckCircle size={16} />
          Token verified successfully
        </Alert>
      )}

      {verified === false && (
        <Alert variant="error" className={styles.statusAlert}>
          <XCircle size={16} />
          {errorProp ||
            error ||
            "Invalid token. Please check the server logs for the correct token."}
        </Alert>
      )}

      <div className={styles.inputGroup}>
        <Input
          type="text"
          placeholder={tokenPlaceholder}
          value={inputToken}
          onChange={(e) => {
            setInputToken(e.target.value);
            // Only clear local error, not prop error (parent manages that)
            if (!errorProp) {
              setError("");
            }
          }}
          error={displayError && verified === false ? displayError : undefined}
          disabled={verifying || verified === true}
          className={styles.tokenInput}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
      </div>
    </div>
  );
}

TokenVerificationStep.propTypes = {
  title: PropTypes.string,
  icon: PropTypes.elementType,
  user: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.shape({
      username: PropTypes.string,
    }),
  ]),
  token: PropTypes.string,
  tokenLabel: PropTypes.string,
  instruction: PropTypes.string,
  onVerify: PropTypes.func,
  onRegenerate: PropTypes.func, // Should return a Promise that resolves to the new token string
  onTokenChange: PropTypes.func, // Called when token input changes
  verifying: PropTypes.bool,
  regenerating: PropTypes.bool,
  verified: PropTypes.bool, // true = verified, false = failed, undefined = not attempted
  error: PropTypes.string, // Error message to display when verification fails
  showToken: PropTypes.bool,
  tokenPlaceholder: PropTypes.string,
};

export default TokenVerificationStep;

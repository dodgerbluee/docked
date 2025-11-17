/**
 * Create User Modal
 * Modal for creating a new user account
 */

import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import { API_BASE_URL } from "../utils/api";
import styles from "./CreateUserModal.module.css";

function CreateUserModal({ isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    email: "",
    registrationCode: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requiresCode, setRequiresCode] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);

  // Check if registration code is required when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        username: "",
        password: "",
        confirmPassword: "",
        email: "",
        registrationCode: "",
      });
      setError("");
      setCheckingCode(true);

      // Check if registration code is required
      const checkAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: {
          "Content-Type": "application/json",
        },
      });
      delete checkAxios.defaults.headers.common["Authorization"];
      delete checkAxios.defaults.headers.Authorization;

      checkAxios
        .get("/api/auth/registration-code-required")
        .then((response) => {
          if (response.data.success) {
            setRequiresCode(response.data.requiresCode || false);
          }
        })
        .catch((err) => {
          console.error("Error checking registration code requirement:", err);
          // Default to false if check fails
          setRequiresCode(false);
        })
        .finally(() => {
          setCheckingCode(false);
        });
    }
  }, [isOpen]);

  const handleChange = (field) => (e) => {
    let value = e.target.value;

    // Format registration code: uppercase and add dashes
    if (field === "registrationCode") {
      // Remove existing dashes and convert to uppercase
      value = value.replace(/-/g, "").toUpperCase();
      // Add dashes every 4 characters
      if (value.length > 4) {
        value = value.slice(0, 4) + "-" + value.slice(4);
      }
      if (value.length > 9) {
        value = value.slice(0, 9) + "-" + value.slice(9, 13);
      }
      // Limit to 14 characters (XXXX-XXXX-XXXX)
      value = value.slice(0, 14);
    }

    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    // Clear error when user starts typing
    if (error) {
      setError("");
    }
  };

  const validateForm = () => {
    if (!formData.username || formData.username.length < 3) {
      setError("Username must be at least 3 characters long");
      return false;
    }

    if (!formData.password || formData.password.length < 8) {
      setError("Password must be at least 8 characters long");
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return false;
    }

    if (formData.email && formData.email.trim() !== "") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        setError("Invalid email format");
        return false;
      }
    }

    if (requiresCode && !formData.registrationCode) {
      setError("Registration code is required");
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Create a completely clean axios instance for registration
      const registerAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Explicitly remove any Authorization header
      delete registerAxios.defaults.headers.common["Authorization"];
      delete registerAxios.defaults.headers.Authorization;

      const requestBody = {
        username: formData.username,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        email: formData.email || null,
      };

      // Include registration code if required (remove dashes before sending)
      if (requiresCode && formData.registrationCode) {
        requestBody.registrationCode = formData.registrationCode.replace(/-/g, "");
      }

      const response = await registerAxios.post("/api/auth/register", requestBody);

      if (response.data.success) {
        if (onSuccess) {
          onSuccess(response.data.message || "User created successfully");
        }
        onClose();
      } else {
        setError(response.data.error || "Failed to create user");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create user. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create User Account" size="md">
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && (
          <Alert variant="error" className={styles.alert}>
            {error}
          </Alert>
        )}

        <Input
          id="username"
          label="Username"
          type="text"
          value={formData.username}
          onChange={handleChange("username")}
          required
          autoComplete="username"
          disabled={loading}
          minLength={3}
          helperText="Must be at least 3 characters long"
          autoFocus
        />

        <Input
          id="email"
          label="Email"
          type="email"
          value={formData.email}
          onChange={handleChange("email")}
          autoComplete="email"
          disabled={loading}
          helperText="Optional"
        />

        {checkingCode ? (
          <div className={styles.checkingCode}>
            <p>Checking if registration code is required...</p>
          </div>
        ) : requiresCode ? (
          <div>
            <Alert variant="info" className={styles.alert}>
              <strong>Registration Code Required</strong>
              <br />
              This is the first user account. Please check your server logs for the registration
              code. It will be displayed in a formatted box when the server starts.
            </Alert>
            <Input
              id="registrationCode"
              label="Registration Code"
              type="text"
              value={formData.registrationCode}
              onChange={handleChange("registrationCode")}
              required={requiresCode}
              disabled={loading || checkingCode}
              placeholder="XXXX-XXXX-XXXX"
              helperText="Enter the registration code shown in the server logs (format: XXXX-XXXX-XXXX)"
              autoComplete="off"
              maxLength={14}
            />
          </div>
        ) : null}

        <Input
          id="password"
          label="Password"
          type="password"
          value={formData.password}
          onChange={handleChange("password")}
          required
          autoComplete="new-password"
          disabled={loading}
          minLength={8}
          helperText="Must be at least 8 characters long"
        />

        <Input
          id="confirmPassword"
          label="Confirm Password"
          type="password"
          value={formData.confirmPassword}
          onChange={handleChange("confirmPassword")}
          required
          autoComplete="new-password"
          disabled={loading}
          helperText="Must match password"
        />

        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
            className={styles.cancelButton}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={
              loading ||
              checkingCode ||
              !formData.username ||
              !formData.password ||
              !formData.confirmPassword ||
              (requiresCode && !formData.registrationCode)
            }
            className={styles.submitButton}
          >
            {loading ? "Creating..." : "Create User"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

CreateUserModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};

export default CreateUserModal;

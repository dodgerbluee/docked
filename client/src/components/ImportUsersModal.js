/**
 * Import Users Modal
 * Modal for importing users from a JSON file with multi-step verification and credential collection
 * Processes users one at a time, collecting password and credentials before creating each user
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import InstanceAdminVerificationStep from "./ImportUsersModal/InstanceAdminVerificationStep";
import PasswordStep from "./ImportUsersModal/PasswordStep";
import PortainerCredentialsStep from "./settings/ImportCredentialsModal/PortainerCredentialsStep";
import DockerHubCredentialsStep from "./settings/ImportCredentialsModal/DockerHubCredentialsStep";
import DiscordCredentialsStep from "./settings/ImportCredentialsModal/DiscordCredentialsStep";
import { Upload, File } from "lucide-react";
import { API_BASE_URL } from "../utils/api";
import { getErrorMessage } from "../utils/errorHandling";
import { validateRequired, validateDiscordWebhookUrl } from "../utils/validation";
import styles from "./ImportUsersModal.module.css";
import credentialStyles from "./settings/ImportCredentialsModal.module.css";

// Step types for each user's import flow
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
  PORTAINER: "portainer",
  DOCKERHUB: "dockerhub",
  DISCORD: "discord",
};

function ImportUsersModal({ isOpen, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [usersData, setUsersData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  
  // User iteration state
  const [currentUserIndex, setCurrentUserIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [importStarted, setImportStarted] = useState(false);
  
  // Per-user data storage
  const [userPasswords, setUserPasswords] = useState({}); // { username: password }
  const [userCredentials, setUserCredentials] = useState({}); // { username: { portainerInstances, dockerHub, discordWebhooks } }
  const [userSkippedSteps, setUserSkippedSteps] = useState({}); // { username: Set<stepType> }
  const [userStepErrors, setUserStepErrors] = useState({}); // { username: { stepType: error } }
  
  // Instance admin verification state
  const [verificationStatus, setVerificationStatus] = useState({}); // { username: true/false/undefined }
  const [verifying, setVerifying] = useState({}); // { username: boolean }
  const [regenerating, setRegenerating] = useState({}); // { username: boolean }
  const [generating, setGenerating] = useState({}); // { username: boolean } - for initial token generation
  // Note: Tokens are stored temporarily to pass to backend when creating user
  // They are logged to server logs, not displayed in UI
  const [verificationTokens, setVerificationTokens] = useState({}); // { username: token } - temporary storage
  const [verificationInputTokens, setVerificationInputTokens] = useState({}); // { username: inputToken } - user-entered tokens
  
  // Results tracking
  const [importedUsers, setImportedUsers] = useState([]); // Array of successfully imported usernames
  const [importErrors, setImportErrors] = useState([]); // Array of error messages
  
  const fileInputRef = useRef(null);

  // Calculate steps needed for current user
  const currentUserSteps = useMemo(() => {
    if (!usersData || currentUserIndex >= usersData.users.length) return [];
    
    const user = usersData.users[currentUserIndex];
    const isInstanceAdmin = user.instanceAdmin !== undefined 
      ? user.instanceAdmin 
      : (user.instance_admin === true || user.instance_admin === 1);
    
    const steps = [];
    
    // Step 1: Instance admin verification (if applicable)
    if (isInstanceAdmin) {
      steps.push(STEP_TYPES.INSTANCE_ADMIN_VERIFICATION);
    }
    
    // Step 2: Password (always required)
    steps.push(STEP_TYPES.PASSWORD);
    
    // Step 3: Portainer credentials (always show, can be skipped)
    // If user has portainer instances in JSON, they'll be pre-populated
    steps.push(STEP_TYPES.PORTAINER);
    
    // Step 4: Docker Hub credentials (always show, can be skipped)
    // If user has docker hub creds in JSON, they'll be pre-populated
    steps.push(STEP_TYPES.DOCKERHUB);
    
    // Step 5: Discord webhooks (always show, can be skipped)
    // If user has discord webhooks in JSON, they'll be pre-populated
    steps.push(STEP_TYPES.DISCORD);
    
    return steps;
  }, [usersData, currentUserIndex]);

  const currentUser = usersData?.users[currentUserIndex];
  const currentStepType = currentUserSteps[currentStepIndex];
  const totalUsers = usersData?.users.length || 0;
  const totalStepsForCurrentUser = currentUserSteps.length;

  useEffect(() => {
    if (isOpen) {
      // Reset all state when modal opens
      setFile(null);
      setUsersData(null);
      setError("");
      setCurrentUserIndex(0);
      setCurrentStepIndex(0);
      setImportStarted(false);
      setUserPasswords({});
      setUserCredentials({});
      setUserSkippedSteps({});
      setUserStepErrors({});
      setVerificationStatus({});
      setVerifying({});
      setRegenerating({});
      setGenerating({});
      setVerificationTokens({});
      setVerificationInputTokens({});
      setImportedUsers([]);
      setImportErrors([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [isOpen]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.type !== "application/json" && !selectedFile.name.endsWith(".json")) {
        setError("Please select a JSON file");
        return;
      }
      setFile(selectedFile);
      setError("");
      
      // Read and parse file immediately
      const reader = new FileReader();
      reader.onload = async (e) => {
        const jsonData = handleFileRead(e.target.result);
        if (jsonData) {
          // Check for duplicate users before proceeding
          const duplicateCheck = await checkForDuplicateUsers(jsonData.users);
          if (duplicateCheck.hasDuplicates) {
            setError(`User "${duplicateCheck.duplicateUsername}" already exists.`);
            return;
          }
          setUsersData(jsonData);
        }
      };
      reader.onerror = () => {
        setError("Failed to read file");
      };
      reader.readAsText(selectedFile);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  // Check if any users in the file already exist
  const checkForDuplicateUsers = async (users) => {
    if (!users || users.length === 0) {
      return { hasDuplicates: false };
    }

    try {
      const checkAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete checkAxios.defaults.headers.common["Authorization"];

      // Check each username
      for (const user of users) {
        if (!user.username) continue;
        
        try {
          const response = await checkAxios.get(`/api/auth/check-user-exists`, {
            params: { username: user.username },
          });
          
          if (response.data.success && response.data.exists) {
            return {
              hasDuplicates: true,
              duplicateUsername: user.username,
            };
          }
        } catch (err) {
          // Log error but continue checking other users
          console.warn(`Error checking user ${user.username}:`, err);
        }
      }

      return { hasDuplicates: false };
    } catch (err) {
      console.error("Error checking for duplicate users:", err);
      // Don't block import if check fails - let backend handle it
      return { hasDuplicates: false };
    }
  };

  const handleFileRead = (fileContent) => {
    try {
      const jsonData = JSON.parse(fileContent);
      
      // Support both formats:
      // 1. { users: [...] } - array of users (may have nested user object)
      // 2. Export format with user object (convert to array)
      let usersArray = null;
      
      if (jsonData.users && Array.isArray(jsonData.users)) {
        // Normalize the users array - handle both flat and nested user structures
        usersArray = jsonData.users.map((userItem) => {
          // If the item has a nested 'user' property (export format), extract and merge it
          if (userItem.user && typeof userItem.user === 'object') {
            return {
              ...userItem.user, // Spread user properties (username, email, role, etc.)
              ...userItem, // Spread top-level properties (portainerInstances, etc.)
              // Override with nested user properties to ensure they take precedence
              username: userItem.user.username,
              email: userItem.user.email,
              role: userItem.user.role,
              instanceAdmin: userItem.user.instance_admin !== undefined 
                ? userItem.user.instance_admin 
                : (userItem.user.instanceAdmin !== undefined ? userItem.user.instanceAdmin : false),
              instance_admin: userItem.user.instance_admin,
            };
          }
          // Otherwise, use the item as-is (flat structure)
          return userItem;
        });
      } else if (jsonData.user && typeof jsonData.user === 'object') {
        // Convert single user export format to array
        // Merge top-level properties (portainerInstances, dockerHubCredentials, discordWebhooks, trackedImages) into user object
        const userWithConfig = {
          ...jsonData.user,
          portainerInstances: jsonData.portainerInstances || jsonData.user.portainerInstances,
          dockerHubCredentials: jsonData.dockerHubCredentials || jsonData.user.dockerHubCredentials,
          discordWebhooks: jsonData.discordWebhooks || jsonData.user.discordWebhooks,
          trackedImages: jsonData.trackedImages || jsonData.user.trackedImages,
        };
        usersArray = [userWithConfig];
      } else if (Array.isArray(jsonData)) {
        usersArray = jsonData;
      } else {
        setError("Invalid JSON format. Expected { users: [...] } or export format with user object");
        return null;
      }

      // Validate each user has required fields
      for (const user of usersArray) {
        if (!user.username) {
          setError("Each user must have a 'username' field");
          return null;
        }
      }

      // Identify instance admin users for summary display
      const instanceAdminUsers = usersArray.filter((user) => {
        const instanceAdmin = user.instanceAdmin !== undefined 
          ? user.instanceAdmin 
          : (user.instance_admin === true || user.instance_admin === 1);
        return instanceAdmin;
      });

      return {
        users: usersArray,
        instanceAdminUsers: instanceAdminUsers.map(u => ({ username: u.username })),
      };
    } catch (parseError) {
      setError(`Invalid JSON: ${parseError.message}`);
      return null;
    }
  };

  // Start import process - move to first user, first step
  const handleStartImport = () => {
    if (!usersData || usersData.users.length === 0) {
      setError("Please select a valid JSON file with users");
      return;
    }
    
    setImportStarted(true);
    setCurrentUserIndex(0);
    setCurrentStepIndex(0);
    setError("");
    
    // Initialize credentials structure for first user
    const firstUser = usersData.users[0];
    initializeUserCredentials(firstUser);
  };

  // Initialize credentials structure for a user
  const initializeUserCredentials = (user) => {
    const credentials = {};
    
    // Always initialize Portainer credentials structure
    // If user has portainer instances in JSON, pre-populate them
    if (user.portainerInstances && Array.isArray(user.portainerInstances) && user.portainerInstances.length > 0) {
      credentials.portainerInstances = user.portainerInstances.map((instance) => ({
        url: instance.url,
        name: instance.name,
        auth_type: instance.auth_type || "apikey",
        username: "",
        password: "",
        apiKey: "",
      }));
    } else {
      // Initialize empty array so the step can be shown
      credentials.portainerInstances = [];
    }
    
    // Always initialize Docker Hub credentials structure
    // If user has docker hub creds in JSON, pre-populate the username
    credentials.dockerHub = {
      username: user.dockerHubCredentials?.username || "",
      token: "",
    };
    
    // Always initialize Discord webhooks structure
    // If user has discord webhooks in JSON, pre-populate them
    if (user.discordWebhooks && Array.isArray(user.discordWebhooks) && user.discordWebhooks.length > 0) {
      credentials.discordWebhooks = user.discordWebhooks.map((webhook) => ({
        id: webhook.id,
        serverName: webhook.server_name,
        webhookUrl: "",
      }));
    } else {
      // Initialize empty array so the step can be shown
      credentials.discordWebhooks = [];
    }
    
    setUserCredentials((prev) => ({
      ...prev,
      [user.username]: credentials,
    }));
  };

  // Generate token when instance admin verification step loads
  const handleGenerateToken = async (username) => {
    setGenerating((prev) => ({ ...prev, [username]: true }));
    
    try {
      const tokenAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete tokenAxios.defaults.headers.common["Authorization"];

      const response = await tokenAxios.post("/api/auth/generate-instance-admin-token", {
        username,
      });
      
      // Store temporarily - will be passed to backend when creating user
      // Token is already logged to server logs
      if (response.data.success && response.data.token) {
        setVerificationTokens((prev) => ({ ...prev, [username]: response.data.token }));
      }
      
      setError(""); // Clear any previous errors
    } catch (err) {
      console.error("Error generating token:", err);
      setError(err.response?.data?.error || "Failed to generate token. Check server logs.");
    } finally {
      setGenerating((prev) => ({ ...prev, [username]: false }));
    }
  };

  // Handle instance admin token regeneration
  // Tokens are regenerated on backend and logged to server logs (not displayed in UI)
  // Store temporarily to pass to backend when creating user (so same token is used)
  const handleRegenerateToken = async (username) => {
    setRegenerating((prev) => ({ ...prev, [username]: true }));
    
    try {
      const tokenAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete tokenAxios.defaults.headers.common["Authorization"];

      // Check if user has been imported (exists in importedUsers array)
      const userExists = importedUsers.includes(username);
      
      // Use generate endpoint for new users, regenerate for existing users
      const endpoint = userExists 
        ? "/api/auth/regenerate-instance-admin-token"
        : "/api/auth/generate-instance-admin-token";

      const response = await tokenAxios.post(endpoint, {
        username,
      });
      
      // Store temporarily - will be passed to backend when creating user
      // Token is already logged to server logs
      if (response.data.success && response.data.token) {
        setVerificationTokens((prev) => ({ ...prev, [username]: response.data.token }));
      }
      
      setError(""); // Clear any previous errors
    } catch (err) {
      console.error("Error generating/regenerating token:", err);
      setError(err.response?.data?.error || "Failed to generate/regenerate token. Check server logs.");
    } finally {
      setRegenerating((prev) => ({ ...prev, [username]: false }));
    }
  };

  // Handle instance admin token verification
  const handleVerifyToken = async (username, token) => {
    setVerifying((prev) => ({ ...prev, [username]: true }));
    
    // Clear any previous errors
    setUserStepErrors((prev) => {
      const updated = { ...prev };
      if (updated[username]) {
        delete updated[username][STEP_TYPES.INSTANCE_ADMIN_VERIFICATION];
      }
      return updated;
    });
    
    try {
      const verifyAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete verifyAxios.defaults.headers.common["Authorization"];

      const response = await verifyAxios.post("/api/auth/verify-instance-admin-token", {
        username,
        token,
      });

      if (response.data.success) {
        setVerificationStatus((prev) => ({ ...prev, [username]: true }));
        // Clear any errors on success
        setUserStepErrors((prev) => {
          const updated = { ...prev };
          if (updated[username]) {
            delete updated[username][STEP_TYPES.INSTANCE_ADMIN_VERIFICATION];
          }
          return updated;
        });
        return true;
      } else {
        const errorMsg = response.data.error || "Invalid token. Please check the server logs for the correct token.";
        setVerificationStatus((prev) => ({ ...prev, [username]: false }));
        setUserStepErrors((prev) => ({
          ...prev,
          [username]: {
            ...prev[username],
            [STEP_TYPES.INSTANCE_ADMIN_VERIFICATION]: errorMsg,
          },
        }));
        return false;
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || "Invalid token. Please check the server logs for the correct token.";
      setVerificationStatus((prev) => ({ ...prev, [username]: false }));
      setUserStepErrors((prev) => ({
        ...prev,
        [username]: {
          ...prev[username],
          [STEP_TYPES.INSTANCE_ADMIN_VERIFICATION]: errorMsg,
        },
      }));
      return false;
    } finally {
      setVerifying((prev) => ({ ...prev, [username]: false }));
    }
  };

  // Validate current step
  const validateCurrentStep = () => {
    if (!currentUser) return false;
    
    const username = currentUser.username;
    const errors = {};
    
    if (currentStepType === STEP_TYPES.PASSWORD) {
      const password = userPasswords[username];
      if (!password || password.length < 8) {
        errors.password = "Password must be at least 8 characters long";
      }
      // Note: Password confirmation is handled in PasswordStep component UI
      // Backend validation will catch mismatched passwords if needed
    } else if (currentStepType === STEP_TYPES.PORTAINER) {
      // Only validate if there are instances to validate
      const creds = userCredentials[username]?.portainerInstances || [];
      const instances = currentUser?.portainerInstances || [];
      if (instances.length > 0) {
        creds.forEach((cred, index) => {
          if (cred.auth_type === "apikey") {
            if (!cred.apiKey) {
              errors[`portainer_${index}_apiKey`] = "API key is required";
            }
          } else if (cred.auth_type === "password") {
            if (!cred.username) {
              errors[`portainer_${index}_username`] = "Username is required";
            }
            if (!cred.password) {
              errors[`portainer_${index}_password`] = "Password is required";
            }
          }
        });
      }
      // If no instances, step can be skipped (no validation errors)
    } else if (currentStepType === STEP_TYPES.DOCKERHUB) {
      // Docker Hub is optional - only validate if credentials are provided
      const dockerHub = userCredentials[username]?.dockerHub;
      if (dockerHub && (dockerHub.username || dockerHub.token)) {
        // If any field is filled, both are required
        if (!dockerHub.username) {
          errors.dockerhub_username = "Username is required";
        }
        if (!dockerHub.token) {
          errors.dockerhub_token = "Token is required";
        }
      }
      // If both empty, step can be skipped (no validation errors)
    } else if (currentStepType === STEP_TYPES.DISCORD) {
      // Only validate if there are webhooks to validate
      const webhooks = userCredentials[username]?.discordWebhooks || [];
      const userWebhooks = currentUser?.discordWebhooks || [];
      if (userWebhooks.length > 0) {
        webhooks.forEach((cred, index) => {
          const urlError = validateDiscordWebhookUrl(cred.webhookUrl);
          if (urlError) {
            errors[`discord_${index}_webhookUrl`] = urlError;
          }
        });
      }
      // If no webhooks, step can be skipped (no validation errors)
    }
    
    if (Object.keys(errors).length > 0) {
      setUserStepErrors((prev) => ({
        ...prev,
        [username]: { ...prev[username], ...errors },
      }));
      return false;
    }
    
    return true;
  };

  // Validate credentials with backend (for portainer, dockerhub, discord)
  const validateCredentialsStep = async () => {
    if (!currentUser) return { success: true };
    
    const username = currentUser.username;
    const creds = userCredentials[username] || {};
    const skippedSteps = userSkippedSteps[username] || new Set();
    
    // Create a separate axios instance for validation requests without auth headers
    // This prevents the 401 interceptor from logging out on validation failures
    const validationAxios = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        "Content-Type": "application/json",
      },
    });
    delete validationAxios.defaults.headers.common["Authorization"];
    
    try {
      if (currentStepType === STEP_TYPES.PORTAINER && creds.portainerInstances && creds.portainerInstances.length > 0) {
        const instances = currentUser.portainerInstances || [];
        if (instances.length > 0) {
          const validationPromises = creds.portainerInstances.map(async (cred, index) => {
            const instance = instances[index];
            if (!instance) {
              console.error(`[ImportUsersModal] Validation failed: No instance at index ${index}`);
              return { success: false, index, error: "Instance not found" };
            }
            
            const validateData = {
              url: instance.url,
              authType: cred.auth_type,
            };
            
            if (cred.auth_type === "apikey") {
              validateData.apiKey = cred.apiKey;
            } else {
              validateData.username = cred.username;
              validateData.password = cred.password;
            }
            
            console.log(`[ImportUsersModal] Validating Portainer instance:`, {
              index,
              instanceName: instance.name,
              instanceUrl: instance.url,
              credUrl: cred.url,
              authType: cred.auth_type,
              hasApiKey: !!cred.apiKey,
              hasUsername: !!cred.username,
              validateDataUrl: validateData.url,
            });
            
            try {
              const response = await validationAxios.post(`/api/portainer/instances/validate`, validateData);
              if (!response.data.success) {
                console.error(`[ImportUsersModal] Validation failed for instance:`, {
                  index,
                  instanceName: instance.name,
                  instanceUrl: instance.url,
                  credUrl: cred.url,
                  response: response.data,
                });
              }
              return { success: response.data.success, index, error: response.data.error || null };
            } catch (err) {
              console.error(`[ImportUsersModal] Validation error for instance:`, {
                index,
                instanceName: instance.name,
                instanceUrl: instance.url,
                credUrl: cred.url,
                error: err.message,
                response: err.response?.data,
              });
              return { success: false, index, error: err.response?.data?.error || err.message };
            }
          });
          
          const results = await Promise.all(validationPromises);
          const failed = results.find((r) => !r.success);
          if (failed) {
            const failedInstance = instances[failed.index];
            console.error(`[ImportUsersModal] Portainer validation failed:`, {
              index: failed.index,
              instanceName: failedInstance?.name,
              instanceUrl: failedInstance?.url,
              error: failed.error,
            });
            return {
              success: false,
              error: `Portainer instance "${failedInstance?.name || 'Unknown'}" (${failedInstance?.url || 'no URL'}): ${failed.error || 'Authentication failed'}`,
            };
          }
        }
        // If no instances, skip validation (step can be skipped)
      } else if (currentStepType === STEP_TYPES.DOCKERHUB) {
        // Check if step was skipped - don't validate if skipped
        if (skippedSteps.has(STEP_TYPES.DOCKERHUB)) {
          return { success: true };
        }
        
        // Only validate if credentials are provided
        if (creds.dockerHub && creds.dockerHub.username && creds.dockerHub.token) {
          const response = await validationAxios.post(`/api/docker-hub/credentials/validate`, {
            username: creds.dockerHub.username,
            token: creds.dockerHub.token,
          });
          if (!response.data.success) {
            return {
              success: false,
              error: response.data.error || "Docker Hub authentication failed",
            };
          }
        }
        // If credentials are empty, skip validation (step can be skipped)
      } else if (currentStepType === STEP_TYPES.DISCORD && creds.discordWebhooks && creds.discordWebhooks.length > 0) {
        const webhooks = currentUser.discordWebhooks || [];
        if (webhooks.length > 0) {
          for (let i = 0; i < creds.discordWebhooks.length; i++) {
            const cred = creds.discordWebhooks[i];
            const webhook = webhooks[i];
            
            // Only validate if webhook URL is provided
            if (cred.webhookUrl) {
              try {
                const response = await validationAxios.post(`/api/discord/test`, {
                  webhookUrl: cred.webhookUrl,
                });
                if (!response.data.success) {
                  return {
                    success: false,
                    error: `Discord webhook "${webhook.server_name || `Webhook ${i + 1}`}": ${response.data.error || "Webhook test failed"}`,
                  };
                }
              } catch (error) {
                return {
                  success: false,
                  error: `Discord webhook "${webhook.server_name || `Webhook ${i + 1}`}": ${error.response?.data?.error || "Webhook test failed"}`,
                };
              }
            }
          }
        }
        // If no webhooks, skip validation (step can be skipped)
      }
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || "Validation failed",
      };
    }
  };

  // Create user with configuration
  const createUserWithConfig = async () => {
    if (!currentUser) return false;
    
    setImporting(true);
    setError("");
    
    try {
      const createAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete createAxios.defaults.headers.common["Authorization"];
      
      const username = currentUser.username;
      const password = userPasswords[username];
      
      // Check if user was marked as instance admin in JSON
      const wasMarkedAsInstanceAdmin = currentUser.instanceAdmin !== undefined 
        ? currentUser.instanceAdmin 
        : (currentUser.instance_admin === true || currentUser.instance_admin === 1);
      
      // Check if instance admin verification step was skipped
      const skippedSteps = userSkippedSteps[username] || new Set();
      const verificationSkipped = skippedSteps.has(STEP_TYPES.INSTANCE_ADMIN_VERIFICATION);
      
      // Check if verification was successful
      const verificationSuccessful = verificationStatus[username] === true;
      
      // User should only be marked as instance admin if:
      // 1. They were marked as instance admin in JSON, AND
      // 2. Verification step was NOT skipped, AND
      // 3. Verification was successful
      const isInstanceAdmin = wasMarkedAsInstanceAdmin && !verificationSkipped && verificationSuccessful;
      
      // Build user data
      const userData = {
        username,
        password,
        email: currentUser.email || null,
        role: currentUser.role || "Administrator",
        instanceAdmin: isInstanceAdmin,
      };
      
      // Build config data (only include if user has it)
      const configData = {};
      if (currentUser.portainerInstances && Array.isArray(currentUser.portainerInstances) && currentUser.portainerInstances.length > 0) {
        configData.portainerInstances = currentUser.portainerInstances;
      }
      if (currentUser.dockerHubCredentials !== null && currentUser.dockerHubCredentials !== undefined) {
        configData.dockerHubCredentials = currentUser.dockerHubCredentials;
      }
      if (currentUser.discordWebhooks && Array.isArray(currentUser.discordWebhooks) && currentUser.discordWebhooks.length > 0) {
        configData.discordWebhooks = currentUser.discordWebhooks;
      }
      if (currentUser.trackedImages && Array.isArray(currentUser.trackedImages) && currentUser.trackedImages.length > 0) {
        configData.trackedImages = currentUser.trackedImages;
      }
      
      // Build credentials (only include non-skipped steps)
      const credentials = {};
      
      if (!skippedSteps.has(STEP_TYPES.PORTAINER) && userCredentials[username]?.portainerInstances) {
        credentials.portainerInstances = userCredentials[username].portainerInstances;
      }
      if (!skippedSteps.has(STEP_TYPES.DOCKERHUB) && userCredentials[username]?.dockerHub) {
        credentials.dockerHub = userCredentials[username].dockerHub;
      }
      if (!skippedSteps.has(STEP_TYPES.DISCORD) && userCredentials[username]?.discordWebhooks) {
        credentials.discordWebhooks = userCredentials[username].discordWebhooks;
      }
      
      // Use pre-generated token if available (from handleStartImport)
      // This ensures the same token is used that was already logged to server logs
      const preGeneratedToken = verificationTokens[username];
      
      // Call new endpoint to create user with config
      // Pass pre-generated token so backend uses it instead of generating a new one
      const response = await createAxios.post("/api/auth/create-user-with-config", {
        userData,
        configData: Object.keys(configData).length > 0 ? configData : null,
        credentials: Object.keys(credentials).length > 0 ? credentials : null,
        skippedSteps: Array.from(skippedSteps),
        verificationToken: preGeneratedToken || null, // Pass token if we generated it upfront
      });
      
      if (response.data.success) {
        // Token was already logged when generated upfront
        // Clear it from temporary storage after user is created
        setVerificationTokens((prev) => {
          const updated = { ...prev };
          delete updated[username];
          return updated;
        });
        setImportedUsers((prev) => [...prev, username]);
        return true;
      } else {
        setImportErrors((prev) => [...prev, `User "${username}": ${response.data.error || "Failed to create user"}`]);
        return false;
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || getErrorMessage(err) || "Failed to create user";
      setImportErrors((prev) => [...prev, `User "${currentUser.username}": ${errorMsg}`]);
      setError(errorMsg);
      return false;
    } finally {
      setImporting(false);
    }
  };

  // Handle next step
  const handleNext = async () => {
    if (!currentUser) return;
    
    const username = currentUser.username;
    
    // For instance admin verification step, verify token if entered
    if (currentStepType === STEP_TYPES.INSTANCE_ADMIN_VERIFICATION) {
      const inputToken = verificationInputTokens[username];
      if (inputToken && inputToken.trim()) {
        // Token entered - verify it
        setLoading(true);
        try {
          const verified = await handleVerifyToken(username, inputToken.trim());
          setLoading(false);
          if (!verified) {
            // Error is already set in userStepErrors by handleVerifyToken
            // Don't proceed if verification failed
            return;
          }
          // Verification successful - continue with normal flow below
        } catch (err) {
          setLoading(false);
          // Error is already set in userStepErrors by handleVerifyToken
          return;
        }
      }
      // No token entered - skip verification (user can skip)
      // Continue with normal flow below
    }
    
    // Validate current step
    if (!validateCurrentStep()) {
      return;
    }
    
    // For credential steps, validate with backend
    if ([STEP_TYPES.PORTAINER, STEP_TYPES.DOCKERHUB, STEP_TYPES.DISCORD].includes(currentStepType)) {
      setLoading(true);
      try {
        const validation = await validateCredentialsStep();
        if (!validation.success) {
          setError(validation.error || "Validation failed");
          setLoading(false);
          return;
        }
        // Clear error on successful validation
        setError("");
      } catch (err) {
        setError(err.response?.data?.error || "Validation failed");
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
    }
    
    // Clear any step errors
    setUserStepErrors((prev) => {
      const updated = { ...prev };
      if (updated[username]) {
        delete updated[username][currentStepType];
        // For Docker Hub step, also clear field-specific errors
        if (currentStepType === STEP_TYPES.DOCKERHUB) {
          delete updated[username].dockerhub_username;
          delete updated[username].dockerhub_token;
        }
      }
      return updated;
    });
    
    // For instance admin verification, clear loading if it was set
    if (currentStepType === STEP_TYPES.INSTANCE_ADMIN_VERIFICATION) {
      setLoading(false);
    }
    
    // Move to next step
    if (currentStepIndex < totalStepsForCurrentUser - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      // All steps complete for this user - create user
      const success = await createUserWithConfig();
      
      if (success) {
        // Move to next user
        if (currentUserIndex < totalUsers - 1) {
          const nextUserIndex = currentUserIndex + 1;
          setCurrentUserIndex(nextUserIndex);
          setCurrentStepIndex(0);
          initializeUserCredentials(usersData.users[nextUserIndex]);
        } else {
          // All users processed
          // Include the current user that was just created (importedUsers.length + 1)
          const totalImported = importedUsers.length + 1;
          const message = `Successfully imported ${totalImported} user(s)`;
          if (importErrors.length > 0) {
            onSuccess(`${message}. ${importErrors.length} error(s) occurred.`);
          } else {
            onSuccess(message);
          }
        }
      }
    }
  };

  // Handle skip current step
  const handleSkip = () => {
    if (!currentUser) return;
    
    const username = currentUser.username;
    const skipped = new Set(userSkippedSteps[username] || []);
    skipped.add(currentStepType);
    setUserSkippedSteps((prev) => ({ ...prev, [username]: skipped }));
    
    // Clear any step errors
    setUserStepErrors((prev) => {
      const updated = { ...prev };
      if (updated[username]) {
        delete updated[username][currentStepType];
        // For Portainer step, also clear all field-specific errors
        if (currentStepType === STEP_TYPES.PORTAINER) {
          Object.keys(updated[username]).forEach((key) => {
            if (key.startsWith("portainer_")) {
              delete updated[username][key];
            }
          });
        }
        // For Docker Hub step, also clear field-specific errors
        if (currentStepType === STEP_TYPES.DOCKERHUB) {
          delete updated[username].dockerhub_username;
          delete updated[username].dockerhub_token;
        }
      }
      return updated;
    });
    
    // Clear the general error message when skipping
    setError("");
    
    // Advance to next step without validation
    if (currentStepIndex < totalStepsForCurrentUser - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      // All steps complete for this user - create user
      createUserWithConfig().then((success) => {
        if (success) {
          // Move to next user
          if (currentUserIndex < totalUsers - 1) {
            const nextUserIndex = currentUserIndex + 1;
            setCurrentUserIndex(nextUserIndex);
            setCurrentStepIndex(0);
            initializeUserCredentials(usersData.users[nextUserIndex]);
          } else {
            // All users processed
            const totalImported = importedUsers.length + 1;
            const message = `Successfully imported ${totalImported} user(s)`;
            if (importErrors.length > 0) {
              onSuccess(`${message}. ${importErrors.length} error(s) occurred.`);
            } else {
              onSuccess(message);
            }
          }
        }
      });
    }
  };

  // Handle back
  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
      setError("");
    } else if (currentUserIndex > 0) {
      // Go back to previous user's last step
      const prevUserIndex = currentUserIndex - 1;
      const prevUser = usersData.users[prevUserIndex];
      const prevUserSteps = calculateUserSteps(prevUser);
      setCurrentUserIndex(prevUserIndex);
      setCurrentStepIndex(prevUserSteps.length - 1);
      setError("");
    }
  };

  // Helper to calculate steps for a user
  const calculateUserSteps = (user) => {
    const isInstanceAdmin = user.instanceAdmin !== undefined 
      ? user.instanceAdmin 
      : (user.instance_admin === true || user.instance_admin === 1);
    
    const steps = [];
    if (isInstanceAdmin) {
      steps.push(STEP_TYPES.INSTANCE_ADMIN_VERIFICATION);
    }
    steps.push(STEP_TYPES.PASSWORD);
    if (user.portainerInstances && Array.isArray(user.portainerInstances) && user.portainerInstances.length > 0) {
      steps.push(STEP_TYPES.PORTAINER);
    }
    if (user.dockerHubCredentials !== null && user.dockerHubCredentials !== undefined) {
      steps.push(STEP_TYPES.DOCKERHUB);
    }
    if (user.discordWebhooks && Array.isArray(user.discordWebhooks) && user.discordWebhooks.length > 0) {
      steps.push(STEP_TYPES.DISCORD);
    }
    return steps;
  };

  // Update password for current user
  const handlePasswordChange = (password) => {
    if (!currentUser) return;
    setUserPasswords((prev) => ({ ...prev, [currentUser.username]: password }));
    // Clear password error
    setUserStepErrors((prev) => {
      const updated = { ...prev };
      if (updated[currentUser.username]) {
        delete updated[currentUser.username].password;
      }
      return updated;
    });
  };

  // Update credential for current user
  const handleCredentialUpdate = (updateFn) => {
    if (!currentUser) return;
    const username = currentUser.username;
    setUserCredentials((prev) => {
      const userCreds = prev[username] || {};
      const updated = updateFn(userCreds);
      return { ...prev, [username]: updated };
    });
    // Clear credential errors
    setUserStepErrors((prev) => {
      const updated = { ...prev };
      if (updated[username]) {
        Object.keys(updated[username]).forEach((key) => {
          if (key.startsWith(currentStepType)) {
            delete updated[username][key];
          }
        });
      }
      return updated;
    });
  };

  const handleClose = () => {
    setFile(null);
    setUsersData(null);
    setError("");
    setCurrentUserIndex(0);
    setCurrentStepIndex(0);
    setImportStarted(false);
    setUserPasswords({});
    setUserCredentials({});
    setUserSkippedSteps({});
    setUserStepErrors({});
    setVerificationStatus({});
    setVerifying({});
    setRegenerating({});
    setGenerating({});
    setVerificationTokens({});
    setVerificationInputTokens({});
    setImportedUsers([]);
    setImportErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onClose();
  };

  // Render current step content
  const renderCurrentStep = () => {
    if (!currentUser) return null;
    
    const username = currentUser.username;
    const creds = userCredentials[username] || {};
    const errors = userStepErrors[username] || {};
    const skipped = userSkippedSteps[username] || new Set();
    
    if (currentStepType === STEP_TYPES.INSTANCE_ADMIN_VERIFICATION) {
      const verified = verificationStatus[username];
      const isVerifying = verifying[username];
      const isRegenerating = regenerating[username];
      const isGenerating = generating[username];
      const token = verificationTokens[username];
      const verificationError = errors[STEP_TYPES.INSTANCE_ADMIN_VERIFICATION];
      const currentInputToken = verificationInputTokens[username] || "";
      
      return (
        <InstanceAdminVerificationStep
          user={{ username }}
          token={token}
          onRegenerate={() => handleRegenerateToken(username)}
          onGenerate={() => handleGenerateToken(username)}
          onTokenChange={(inputToken) => {
            const previousInput = currentInputToken;
            const newInput = inputToken || "";
            
            // Only update the input token
            setVerificationInputTokens((prev) => ({ ...prev, [username]: inputToken }));
            
            // Only clear error if user is actually typing a different value (not just re-render)
            // This prevents clearing the error on component re-renders
            if (verificationError && newInput !== previousInput && newInput.length > 0) {
              // User is actively typing a new value - clear the error to allow retry
              setUserStepErrors((prev) => {
                const updated = { ...prev };
                if (updated[username]) {
                  delete updated[username][STEP_TYPES.INSTANCE_ADMIN_VERIFICATION];
                }
                return updated;
              });
              // Reset verification status to allow retry
              setVerificationStatus((prev) => ({ ...prev, [username]: undefined }));
            }
          }}
          verifying={isVerifying}
          regenerating={isRegenerating}
          generating={isGenerating}
          verified={verified}
          error={verificationError}
        />
      );
    }
    
    if (currentStepType === STEP_TYPES.PASSWORD) {
      return (
        <PasswordStep
          username={username}
          password={userPasswords[username] || ""}
          onPasswordChange={handlePasswordChange}
          errors={errors}
        />
      );
    }
    
    if (currentStepType === STEP_TYPES.PORTAINER) {
      const instances = currentUser?.portainerInstances || [];
      if (instances.length === 0) {
        return (
          <div className={styles.stepContent}>
            <Alert variant="info">
              No Portainer instances found in the import file. You can skip this step or add instances manually after import.
            </Alert>
          </div>
        );
      }
      
      return (
        <PortainerCredentialsStep
          instances={instances}
          credentials={creds}
          errors={errors}
          onUpdateCredential={(index, field, value) => {
            handleCredentialUpdate((prev) => {
              const portainer = prev.portainerInstances || [];
              const updated = [...portainer];
              if (!updated[index]) {
                // Initialize with URL and name from the instance to preserve them
                const instance = instances[index];
                updated[index] = {
                  url: instance?.url || "",
                  name: instance?.name || "",
                  auth_type: "apikey",
                  username: "",
                  password: "",
                  apiKey: "",
                };
              }
              // Preserve URL and name when updating other fields
              // Ensure URL and name are always present from the instance
              const instance = instances[index];
              updated[index] = {
                ...updated[index],
                url: instance?.url || updated[index].url || "",
                name: instance?.name || updated[index].name || "",
                [field]: value,
              };
              return { ...prev, portainerInstances: updated };
            });
          }}
          onRemoveInstance={(index) => {
            // Remove instance from currentUser.portainerInstances
            const updatedInstances = instances.filter((_, i) => i !== index);
            
            // Update usersData to reflect the removal
            setUsersData((prev) => {
              if (!prev) return prev;
              const updatedUsers = [...prev.users];
              updatedUsers[currentUserIndex] = {
                ...updatedUsers[currentUserIndex],
                portainerInstances: updatedInstances,
              };
              return {
                ...prev,
                users: updatedUsers,
              };
            });
            
            // Remove corresponding credentials
            handleCredentialUpdate((prev) => {
              const portainer = prev.portainerInstances || [];
              const updated = portainer.filter((_, i) => i !== index);
              return { ...prev, portainerInstances: updated };
            });
            
            // Clear Portainer step errors when instance is deleted
            // If no instances remain, clear the step error
            if (updatedInstances.length === 0) {
              setUserStepErrors((prev) => {
                const updated = { ...prev };
                if (updated[username]) {
                  delete updated[username][STEP_TYPES.PORTAINER];
                }
                return updated;
              });
              // Also clear the general error message
              setError("");
            } else {
              // Clear any field-specific errors for the removed instance
              // Note: Field errors are keyed like `portainer_${index}_apiKey`
              // After removal, indices shift, so we clear all portainer field errors
              setUserStepErrors((prev) => {
                const updated = { ...prev };
                if (updated[username]) {
                  // Clear all portainer-related field errors
                  Object.keys(updated[username]).forEach((key) => {
                    if (key.startsWith("portainer_")) {
                      delete updated[username][key];
                    }
                  });
                  // Also clear the step-level error if it exists
                  delete updated[username][STEP_TYPES.PORTAINER];
                }
                return updated;
              });
              // Clear the general error message
              setError("");
            }
            
            // Re-index credentials to match remaining instances
            // This ensures credentials stay aligned with instances after deletion
            if (updatedInstances.length > 0) {
              handleCredentialUpdate((prev) => {
                const portainer = prev.portainerInstances || [];
                // Re-map credentials to match new instance indices
                const reindexed = updatedInstances.map((instance, newIndex) => {
                  // Find the credential that matches this instance's URL
                  const matchingCred = portainer.find((cred) => cred.url === instance.url);
                  if (matchingCred) {
                    return {
                      ...matchingCred,
                      url: instance.url,
                      name: instance.name,
                    };
                  }
                  // If no match found, create new credential entry
                  return {
                    url: instance.url,
                    name: instance.name,
                    auth_type: instance.auth_type || "apikey",
                    username: "",
                    password: "",
                    apiKey: "",
                  };
                });
                return { ...prev, portainerInstances: reindexed };
              });
            }
            
            // If no instances left, skip the step
            if (updatedInstances.length === 0) {
              const username = currentUser.username;
              setUserSkippedSteps((prev) => {
                const skipped = new Set(prev[username] || []);
                skipped.add(STEP_TYPES.PORTAINER);
                return { ...prev, [username]: skipped };
              });
            }
          }}
        />
      );
    }
    
    if (currentStepType === STEP_TYPES.DOCKERHUB) {
      return (
        <DockerHubCredentialsStep
          credentials={creds}
          errors={errors}
          onUpdateCredential={(field, value) => {
            handleCredentialUpdate((prev) => ({
              ...prev,
              dockerHub: { ...prev.dockerHub, [field]: value },
            }));
            // Clear errors when user starts typing
            const username = currentUser.username;
            setUserStepErrors((prev) => {
              const updated = { ...prev };
              if (updated[username]) {
                delete updated[username].dockerhub_username;
                delete updated[username].dockerhub_token;
              }
              return updated;
            });
            // Clear general error message
            setError("");
          }}
        />
      );
    }
    
    if (currentStepType === STEP_TYPES.DISCORD) {
      const webhooks = currentUser?.discordWebhooks || [];
      if (webhooks.length === 0) {
        return (
          <div className={styles.stepContent}>
            <Alert variant="info">
              No Discord webhooks found in the import file. You can skip this step or add webhooks manually after import.
            </Alert>
          </div>
        );
      }
      
      return (
        <DiscordCredentialsStep
          webhooks={webhooks}
          credentials={creds}
          errors={errors}
          onUpdateCredential={(index, field, value) => {
            handleCredentialUpdate((prev) => {
              const discord = prev.discordWebhooks || [];
              const updated = [...discord];
              if (!updated[index]) {
                updated[index] = { webhookUrl: "" };
              }
              updated[index][field] = value;
              return { ...prev, discordWebhooks: updated };
            });
          }}
        />
      );
    }
    
    return null;
  };

  // If on file selection step (before import has started)
  if (!importStarted && currentUserIndex === 0 && currentStepIndex === 0 && !importing) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="Import Users" size="lg">
        <div className={styles.form}>
          <div className={styles.uploadArea}>
            <input
              ref={fileInputRef}
              type="file"
              id="usersFile"
              accept=".json,application/json"
              onChange={handleFileChange}
              disabled={loading}
              className={styles.fileInput}
            />
            <Button
              variant="outline"
              onClick={handleFileButtonClick}
              disabled={loading}
              className={styles.uploadButton}
              icon={Upload}
              iconPosition="left"
            >
              Choose JSON File
            </Button>
            {file && (
              <div className={styles.fileInfo}>
                <File size={16} />
                <span className={styles.fileName}>{file.name}</span>
              </div>
            )}
          </div>

          {usersData && (
            <div className={styles.infoMessage}>
              <p>
                <strong>{usersData.users.length}</strong> user(s) found
              </p>
              {usersData.instanceAdminUsers.length > 0 && (
                <p>
                  <strong>{usersData.instanceAdminUsers.length}</strong> instance admin(s) requiring verification
                </p>
              )}
            </div>
          )}

          {error && (
            <Alert variant="error" className={styles.alert}>
              {error}
            </Alert>
          )}

          <div className={styles.actions}>
            <Button variant="secondary" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleStartImport}
              disabled={!file || !usersData || loading}
            >
              Start Import
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Import flow - show current user's current step
  const getStepTitle = () => {
    if (!currentUser) return "Import Users";
    
    const stepNames = {
      [STEP_TYPES.INSTANCE_ADMIN_VERIFICATION]: "Instance Admin Verification",
      [STEP_TYPES.PASSWORD]: "Set Password",
      [STEP_TYPES.PORTAINER]: "Portainer Credentials",
      [STEP_TYPES.DOCKERHUB]: "Docker Hub Credentials",
      [STEP_TYPES.DISCORD]: "Discord Webhooks",
    };
    
    return `Import User ${currentUserIndex + 1} of ${totalUsers}: ${stepNames[currentStepType] || "Unknown"}`;
  };

  const getStepIndicator = () => {
    if (!currentUser) return "";
    return `Step ${currentStepIndex + 1} of ${totalStepsForCurrentUser}: ${currentUser.username}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={getStepTitle()}
      size="lg"
    >
      <div className={styles.form}>
        <div className={styles.stepIndicator}>
          {getStepIndicator()}
        </div>

        {renderCurrentStep()}

        {error && (
          <Alert variant="error" className={styles.alert}>
            {error}
          </Alert>
        )}

        {importErrors.length > 0 && (
          <Alert variant="warning" className={styles.alert}>
            <div>
              <strong>Import Errors:</strong>
              <ul>
                {importErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          </Alert>
        )}

        <div className={styles.actions}>
          {(currentStepIndex > 0 || currentUserIndex > 0) && (
            <Button variant="secondary" onClick={handleBack} disabled={importing || loading}>
              Back
            </Button>
          )}
          <div className={styles.actionSpacer} />
          
          {/* Skip button - show for optional steps (portainer, dockerhub, discord) and instance admin verification */}
          {[STEP_TYPES.PORTAINER, STEP_TYPES.DOCKERHUB, STEP_TYPES.DISCORD, STEP_TYPES.INSTANCE_ADMIN_VERIFICATION].includes(currentStepType) && (
            <Button
              variant="ghost"
              onClick={handleSkip}
              disabled={importing || loading}
              className={styles.skipButton}
            >
              Skip
            </Button>
          )}
          
          <Button variant="secondary" onClick={handleClose} disabled={importing || loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleNext}
            disabled={importing || loading}
            loading={importing || loading}
          >
            {importing
              ? "Creating User..."
              : currentStepIndex < totalStepsForCurrentUser - 1
                ? "Next"
                : currentUserIndex < totalUsers - 1
                  ? "Next User"
                  : "Finish"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ImportUsersModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
};

export default ImportUsersModal;

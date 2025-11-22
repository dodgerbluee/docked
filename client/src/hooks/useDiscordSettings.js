import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * useDiscordSettings Hook
 * Manages Discord webhooks
 * @param {boolean} [isAuthenticated] - Whether user is authenticated (optional, will check axios defaults if not provided)
 * @param {string} [authToken] - Authentication token (optional, will check axios defaults if not provided)
 */
export function useDiscordSettings(isAuthenticated, authToken) {
  const [discordWebhooks, setDiscordWebhooks] = useState([]);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [editingDiscordWebhook, setEditingDiscordWebhook] = useState(null);
  const [discordSuccess, setDiscordSuccess] = useState("");

  // If not provided, check if we have auth via axios defaults or localStorage
  const hasAuth =
    isAuthenticated !== undefined
      ? isAuthenticated
      : !!(
          axios.defaults.headers.common["Authorization"] ||
          localStorage.getItem("authToken")
        );
  const effectiveToken =
    authToken !== undefined ? authToken : localStorage.getItem("authToken");

  const fetchDiscordWebhooks = useCallback(async () => {
    if (!hasAuth || !effectiveToken) return;
    try {
      const response = await axios.get(`${API_BASE_URL}/api/discord/webhooks`);
      if (response.data.success) {
        setDiscordWebhooks(response.data.webhooks || []);
      }
    } catch (err) {
      console.error("Error fetching Discord webhooks:", err);
    }
  }, [hasAuth, effectiveToken]);

  useEffect(() => {
    if (hasAuth && effectiveToken) {
      fetchDiscordWebhooks();
    }
  }, [hasAuth, effectiveToken, fetchDiscordWebhooks]);

  const handleDiscordModalSuccess = useCallback(async () => {
    setDiscordSuccess("Discord webhook saved successfully!");
    await fetchDiscordWebhooks();
    setTimeout(() => setDiscordSuccess(""), 3000);
  }, [fetchDiscordWebhooks]);

  const handleDeleteDiscordWebhook = useCallback(
    async (id) => {
      try {
        const response = await axios.delete(`${API_BASE_URL}/api/discord/webhooks/${id}`);

        if (response.data.success) {
          setDiscordSuccess("Discord webhook removed successfully!");
          await fetchDiscordWebhooks();
          setTimeout(() => setDiscordSuccess(""), 3000);
        }
      } catch (err) {
        console.error("Failed to remove Discord webhook:", err);
        alert(err.response?.data?.error || "Failed to remove Discord webhook");
      }
    },
    [fetchDiscordWebhooks]
  );

  return {
    discordWebhooks,
    showDiscordModal,
    setShowDiscordModal,
    editingDiscordWebhook,
    setEditingDiscordWebhook,
    discordSuccess,
    handleDiscordModalSuccess,
    handleDeleteDiscordWebhook,
    fetchDiscordWebhooks,
  };
}

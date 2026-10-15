import { useState, useEffect, useCallback, useRef } from "react";
import { graphqlClient } from "../graphql/client";
import {
  DISCORD_WEBHOOKS_QUERY,
  DELETE_DISCORD_WEBHOOK_MUTATION,
} from "../graphql/queries";

/**
 * useDiscordSettings Hook
 * Manages Discord webhooks via GraphQL
 * @param {boolean} [isAuthenticated] - Whether user is authenticated (optional, will check localStorage if not provided)
 * @param {string} [authToken] - Authentication token (optional, will check localStorage if not provided)
 */
export function useDiscordSettings(isAuthenticated, authToken) {
  const [discordWebhooks, setDiscordWebhooks] = useState([]);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [editingDiscordWebhook, setEditingDiscordWebhook] = useState(null);
  const [discordSuccess, setDiscordSuccess] = useState("");

  // If not provided, check if we have auth via localStorage
  const hasAuth =
    isAuthenticated !== undefined
      ? isAuthenticated
      : !!localStorage.getItem("authToken");
  const effectiveToken = authToken !== undefined ? authToken : localStorage.getItem("authToken");

  const fetchDiscordWebhooks = useCallback(async () => {
    if (!hasAuth || !effectiveToken) return;
    try {
      const result = await graphqlClient.query(DISCORD_WEBHOOKS_QUERY).toPromise();
      if (result.data?.discordWebhooks) {
        setDiscordWebhooks(result.data.discordWebhooks);
      }
    } catch (err) {
      console.error("Error fetching Discord webhooks:", err);
    }
  }, [hasAuth, effectiveToken]);

  // Guard prevents StrictMode double-fetch
  const fetchDoneRef = useRef(false);
  useEffect(() => {
    if (hasAuth && effectiveToken && !fetchDoneRef.current) {
      fetchDoneRef.current = true;
      fetchDiscordWebhooks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAuth, effectiveToken]);

  const handleDiscordModalSuccess = useCallback(async () => {
    setDiscordSuccess("Discord webhook saved successfully!");
    await fetchDiscordWebhooks();
    setTimeout(() => setDiscordSuccess(""), 3000);
  }, [fetchDiscordWebhooks]);

  const handleDeleteDiscordWebhook = useCallback(
    async (id) => {
      try {
        const result = await graphqlClient
          .mutation(DELETE_DISCORD_WEBHOOK_MUTATION, { id })
          .toPromise();
        if (result.error) throw new Error(result.error.message);

        setDiscordSuccess("Discord webhook removed successfully!");
        await fetchDiscordWebhooks();
        setTimeout(() => setDiscordSuccess(""), 3000);
      } catch (err) {
        console.error("Failed to remove Discord webhook:", err);
        alert(err.message || "Failed to remove Discord webhook");
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

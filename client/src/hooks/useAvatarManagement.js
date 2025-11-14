import { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * Custom hook for avatar management
 * Handles avatar fetching, uploading, and recent avatars
 */
export const useAvatarManagement = (isAuthenticated, authToken) => {
  const [avatar, setAvatar] = useState("/img/default-avatar.jpg");
  const [recentAvatars, setRecentAvatars] = useState([]);
  const avatarRef = useRef(avatar);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  const fetchAvatar = useCallback(async () => {
    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return;
    }

    try {
      isFetchingRef.current = true;
      
      // Use a stable cache key instead of Date.now() to prevent unnecessary re-fetches
      // Only cache bust if we don't have a blob URL already
      const currentAvatar = avatarRef.current;
      const cacheBustUrl = currentAvatar && currentAvatar.startsWith("blob:")
        ? `/api/avatars`
        : `/api/avatars?t=${Date.now()}`;
      
      const response = await axios.get(`${API_BASE_URL}${cacheBustUrl}`, {
        responseType: "blob",
      });
      const avatarUrl = URL.createObjectURL(response.data);
      
      // Clean up old blob URL if it exists
      if (currentAvatar && currentAvatar.startsWith("blob:")) {
        URL.revokeObjectURL(currentAvatar);
      }
      
      setAvatar(avatarUrl);
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error("Error fetching avatar:", err);
      }
      // Set default avatar on error if not already set
      if (avatarRef.current !== "/img/default-avatar.jpg") {
        setAvatar("/img/default-avatar.jpg");
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, []); // Remove avatar from dependencies to prevent infinite loops

  const fetchRecentAvatars = useCallback(async () => {
    if (!isAuthenticated || !authToken) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/api/avatars/recent`);
      if (response.data.success && response.data.avatars) {
        const avatars = response.data.avatars.map((avatar) => ({
          ...avatar,
          url: avatar.url.startsWith("http")
            ? avatar.url
            : `${API_BASE_URL}${avatar.url}`,
        }));
        setRecentAvatars(avatars);
      }
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error("Error fetching recent avatars:", err);
      }
    }
  }, [isAuthenticated, authToken]);

  const handleAvatarChange = useCallback(
    async (newAvatar) => {
      const currentAvatar = avatarRef.current;

      if (currentAvatar && currentAvatar.startsWith("blob:")) {
        URL.revokeObjectURL(currentAvatar);
      }

      if (newAvatar === "/img/default-avatar.jpg") {
        setAvatar(newAvatar);
        return;
      }

      if (typeof newAvatar === "string") {
        if (newAvatar.startsWith("blob:")) {
          setAvatar(newAvatar);
        } else if (newAvatar.startsWith("http") || newAvatar.startsWith("/img/")) {
          setAvatar(newAvatar);
        } else {
          setAvatar(`${API_BASE_URL}${newAvatar}`);
        }
      } else if (newAvatar instanceof File) {
        const blobUrl = URL.createObjectURL(newAvatar);
        setAvatar(blobUrl);
      }
    },
    []
  );

  return {
    avatar,
    recentAvatars,
    avatarRef,
    setAvatar,
    setRecentAvatars,
    fetchAvatar,
    fetchRecentAvatars,
    handleAvatarChange,
  };
};


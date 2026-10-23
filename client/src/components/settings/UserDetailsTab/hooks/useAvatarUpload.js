/**
 * Hook for managing avatar upload and deletion
 */

import { useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../../utils/api";
import { graphqlClient } from "../../../../graphql/client";
import { uploadGraphQL } from "../../../../graphql/upload";
import { getSessionGeneration, isSessionStale } from "../../../../utils/cacheRegistry";
import { UPLOAD_AVATAR_MUTATION, DELETE_AVATAR_MUTATION } from "../../../../graphql/queries";

/**
 * Hook to manage avatar upload and deletion
 * @param {Object} options
 * @param {string} options.avatar - Current avatar URL
 * @param {Function} options.onAvatarChange - Avatar change handler
 * @param {Function} options.onRecentAvatarsChange - Recent avatars change handler
 * @param {Function} options.onAvatarUploaded - Avatar uploaded callback
 * @returns {Object} Avatar upload state and handlers
 */
export const useAvatarUpload = ({
  avatar,
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
}) => {
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarSuccess, setAvatarSuccess] = useState("");

  const handleAvatarUpload = async (croppedImageUrl) => {
    if (!croppedImageUrl) {
      setAvatarError("Failed to crop image");
      return;
    }

    setAvatarUploading(true);
    setAvatarError("");

    // One generation spans the whole crop → blob → upload chain:
    // uploadGraphQL reads the CURRENT token from localStorage at call time,
    // so a crop started by a dead session must not upload into the next
    // account, and a dead session's completion must not call back into App.
    const generation = getSessionGeneration();

    try {
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();
      const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });

      if (isSessionStale(generation)) return; // session ended mid-crop: not our account

      const data = await uploadGraphQL(UPLOAD_AVATAR_MUTATION, { file: null }, { file });
      if (isSessionStale(generation)) return; // session ended mid-upload: drop the completion
      const result = data.uploadAvatar;

      if (result?.success) {
        const avatarUrl = result.message || "/api/avatars";
        if (onAvatarChange) {
          await onAvatarChange(avatarUrl);
        }
        if (isSessionStale(generation)) return;

        // Refresh the recent list from the (still REST) recent-avatars endpoint
        let serverRecentAvatars = [];
        try {
          const recentResp = await axios.get(`${API_BASE_URL}/api/avatars/recent`);
          serverRecentAvatars = recentResp.data.avatars || [];
        } catch (err) {
          console.error("Error refreshing recent avatars:", err);
        }
        if (isSessionStale(generation)) return;
        if (onRecentAvatarsChange) {
          onRecentAvatarsChange(serverRecentAvatars);
        }

        setAvatarSuccess("Avatar uploaded successfully!");
        setAvatarUploading(false);

        URL.revokeObjectURL(croppedImageUrl);

        if (onAvatarUploaded) {
          setTimeout(() => {
            if (isSessionStale(generation)) return;
            onAvatarUploaded();
          }, 200);
        }
      } else {
        throw new Error("Failed to upload avatar");
      }
    } catch (err) {
      console.error("Avatar upload error:", err);
      setAvatarError(`Failed to upload avatar: ${err.message}`);
      setAvatarUploading(false);
    }
  };

  const handleDeleteAvatar = async () => {
    try {
      setAvatarError("");
      const generation = getSessionGeneration();
      const result = await graphqlClient.mutation(DELETE_AVATAR_MUTATION).toPromise();
      if (isSessionStale(generation)) return; // dead session: don't touch the new one's state

      if (!result.error && result.data?.deleteAvatar?.success) {
        if (avatar && avatar.startsWith("blob:")) {
          URL.revokeObjectURL(avatar);
        }

        if (onAvatarChange) {
          await onAvatarChange("/img/default-avatar.jpg");
        }
        if (isSessionStale(generation)) return;

        if (onRecentAvatarsChange) {
          onRecentAvatarsChange([]);
        }

        setAvatarSuccess("Avatar deleted successfully. Reverted to default avatar.");

        if (onAvatarUploaded) {
          setTimeout(() => {
            if (isSessionStale(generation)) return;
            onAvatarUploaded();
          }, 200);
        }
      } else {
        throw new Error(result.error?.message || "Failed to delete avatar");
      }
    } catch (err) {
      console.error("Error deleting avatar:", err);
      setAvatarError(err.message || "Failed to delete avatar. Please try again.");
    }
  };

  return {
    avatarUploading,
    avatarError,
    avatarSuccess,
    setAvatarError,
    setAvatarSuccess,
    handleAvatarUpload,
    handleDeleteAvatar,
  };
};

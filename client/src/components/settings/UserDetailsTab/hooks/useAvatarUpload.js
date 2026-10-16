/**
 * Hook for managing avatar upload and deletion
 */

import { useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../../utils/api";
import { graphqlClient } from "../../../../graphql/client";
import { uploadGraphQL } from "../../../../graphql/upload";
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

    try {
      const response = await fetch(croppedImageUrl);
      const blob = await response.blob();
      const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });

      const data = await uploadGraphQL(UPLOAD_AVATAR_MUTATION, { file: null }, { file });
      const result = data.uploadAvatar;

      if (result?.success) {
        const avatarUrl = result.message || "/api/avatars";
        if (onAvatarChange) {
          await onAvatarChange(avatarUrl);
        }

        // Refresh the recent list from the (still REST) recent-avatars endpoint
        let serverRecentAvatars = [];
        try {
          const recentResp = await axios.get(`${API_BASE_URL}/api/avatars/recent`);
          serverRecentAvatars = recentResp.data.avatars || [];
        } catch (err) {
          console.error("Error refreshing recent avatars:", err);
        }
        if (onRecentAvatarsChange) {
          onRecentAvatarsChange(serverRecentAvatars);
        }

        setAvatarSuccess("Avatar uploaded successfully!");
        setAvatarUploading(false);

        URL.revokeObjectURL(croppedImageUrl);

        if (onAvatarUploaded) {
          setTimeout(() => {
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
      const result = await graphqlClient.mutation(DELETE_AVATAR_MUTATION).toPromise();

      if (!result.error && result.data?.deleteAvatar?.success) {
        if (avatar && avatar.startsWith("blob:")) {
          URL.revokeObjectURL(avatar);
        }

        if (onAvatarChange) {
          await onAvatarChange("/img/default-avatar.jpg");
        }

        if (onRecentAvatarsChange) {
          onRecentAvatarsChange([]);
        }

        setAvatarSuccess("Avatar deleted successfully. Reverted to default avatar.");

        if (onAvatarUploaded) {
          setTimeout(() => {
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

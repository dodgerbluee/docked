/**
 * Hook for managing avatar upload and deletion
 */

import { useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../../utils/api";

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

      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(blob);
      });

      const uploadResponse = await axios.post(`${API_BASE_URL}/api/avatars`, {
        avatar: base64,
      });

      if (uploadResponse.data.success) {
        const avatarUrl = uploadResponse.data.avatarUrl;
        if (onAvatarChange) {
          await onAvatarChange(avatarUrl);
        }

        const serverRecentAvatars = uploadResponse.data.recentAvatars || [];
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
        throw new Error(uploadResponse.data.error || "Failed to upload avatar");
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
      const response = await axios.delete(`${API_BASE_URL}/api/avatars`);

      if (response.data.success) {
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
        throw new Error(response.data.error || "Failed to delete avatar");
      }
    } catch (err) {
      console.error("Error deleting avatar:", err);
      setAvatarError(err.response?.data?.error || "Failed to delete avatar. Please try again.");
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

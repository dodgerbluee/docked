import { useUserSettings } from "./useUserSettings";
import { usePortainerSettings } from "./usePortainerSettings";
import { useDockerHubSettings } from "./useDockerHubSettings";
import { useDiscordSettings } from "./useDiscordSettings";
import { useGeneralSettings } from "./useGeneralSettings";

/**
 * useSettings Hook
 * Composes all settings-related hooks into a single interface
 */
export function useSettings({
  username,
  onUsernameUpdate,
  onPasswordUpdateSuccess,
  onPortainerInstancesChange,
  onAvatarChange,
  onBatchConfigUpdate,
  isFirstLogin = false,
  colorScheme = "system",
  onColorSchemeChange,
  refreshInstances,
  activeSection,
}) {
  const userSettings = useUserSettings({
    username,
    onUsernameUpdate,
    onPasswordUpdateSuccess,
    isFirstLogin,
  });

  const portainerSettings = usePortainerSettings({
    onPortainerInstancesChange,
    refreshInstances,
    activeSection,
  });

  const dockerHubSettings = useDockerHubSettings();

  const discordSettings = useDiscordSettings();

  const generalSettings = useGeneralSettings({
    colorScheme,
    onColorSchemeChange,
    onBatchConfigUpdate,
  });

  return {
    // User settings
    ...userSettings,

    // Portainer settings
    ...portainerSettings,

    // Docker Hub settings
    ...dockerHubSettings,

    // Discord settings
    ...discordSettings,

    // General settings
    ...generalSettings,
  };
}

import { useUserSettings } from "./useUserSettings";
import { useSourceSettings } from "./useSourceSettings";
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
  onSourceInstancesChange,
  onAvatarChange,
  onBatchConfigUpdate,
  colorScheme = "system",
  onColorSchemeChange,
  refreshInstances,
  activeSection,
}) {
  const userSettings = useUserSettings({
    username,
    onUsernameUpdate,
    onPasswordUpdateSuccess,
  });

  const sourceSettings = useSourceSettings({
    onSourceInstancesChange,
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

    // Source settings
    ...sourceSettings,

    // Docker Hub settings
    ...dockerHubSettings,

    // Discord settings
    ...discordSettings,

    // General settings
    ...generalSettings,
  };
}

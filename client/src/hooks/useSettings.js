import { useUserSettings } from "./useUserSettings";
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
  onAvatarChange,
  onBatchConfigUpdate,
  colorScheme = "system",
  onColorSchemeChange,
}) {
  const userSettings = useUserSettings({
    username,
    onUsernameUpdate,
    onPasswordUpdateSuccess,
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

    // Docker Hub settings
    ...dockerHubSettings,

    // Discord settings
    ...discordSettings,

    // General settings
    ...generalSettings,
  };
}

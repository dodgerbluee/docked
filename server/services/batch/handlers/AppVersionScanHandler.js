/**
 * App Version Scan Job Handler
 * Scans apps running on dockhand runners and checks for version updates
 */

const JobHandler = require("../JobHandler");
const githubService = require("../../githubService");
const { fetchRunnerApps, enrichAppsWithVersions } = require("../../runnerService");
const { getEnabledRunnersWithKeysByUser } = require("../../../db/runners");

let _discordService = null;
function getDiscordService() {
  if (!_discordService) {
    try {
      _discordService = require("../../discordService");
    } catch {
      /* no-op */
    }
  }
  return _discordService;
}

class AppVersionScanHandler extends JobHandler {
  getJobType() {
    return "app-version-scan";
  }

  getDisplayName() {
    return "App Version Scan";
  }

  getDefaultConfig() {
    return {
      enabled: false,
      intervalMinutes: 60,
    };
  }

  async execute(context) {
    const { logger, userId } = context;

    if (!userId) {
      throw new Error("userId is required for app version scan batch job");
    }

    const runners = await getEnabledRunnersWithKeysByUser(userId);

    if (runners.length === 0) {
      logger.info("No enabled runners found for user, skipping app version scan", { userId });
      return { itemsChecked: 0, itemsUpdated: 0 };
    }

    logger.info("Starting app version scan", { userId, runnerCount: runners.length });

    let itemsChecked = 0;
    let itemsUpdated = 0;
    let runnersSkipped = 0;

    const results = await Promise.allSettled(
      runners.map(async (runner) => {
        let apps;
        try {
          const data = await fetchRunnerApps(runner.url, runner.api_key);
          apps = data.apps || [];
        } catch (err) {
          logger.warn("Runner unreachable during app version scan, skipping", {
            runnerId: runner.id,
            runnerName: runner.name,
            error: err.message,
          });
          return { checked: 0, updated: 0, skipped: 1 };
        }

        const enriched = await enrichAppsWithVersions(apps, githubService);

        const updated = enriched.filter(
          (app) =>
            (app.latestVersion && app.currentVersion && app.latestVersion !== app.currentVersion) ||
            app.systemUpdatesAvailable === true
        );

        // Queue Discord notifications for newly-detected app updates
        const discord = getDiscordService();
        if (discord?.queueNotification) {
          for (const app of updated) {
            await discord
              .queueNotification({
                id: `runner-${runner.id}-app-${app.name}`,
                name: app.name,
                imageName: app.name,
                githubRepo: app.githubRepo || null,
                sourceType: app.sourceType || "app",
                currentVersion: app.currentVersion || "unknown",
                latestVersion: app.latestVersion || "unknown",
                latestDigest: null,
                latestVersionPublishDate: app.latestVersionPublishDate || null,
                releaseUrl: app.releaseUrl || null,
                notificationType: "tracked-app",
                userId,
              })
              .catch(() => {}); // notifications are best-effort
          }
        }

        return { checked: enriched.length, updated: updated.length, skipped: 0 };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        itemsChecked += result.value.checked;
        itemsUpdated += result.value.updated;
        runnersSkipped += result.value.skipped;
      }
    }

    logger.info("App version scan completed", {
      userId,
      itemsChecked,
      itemsUpdated,
      runnersSkipped,
    });

    return { itemsChecked, itemsUpdated, runnersSkipped };
  }
}

module.exports = AppVersionScanHandler;

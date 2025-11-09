/**
 * Batch Scheduler Service
 * Runs batch jobs (Docker Hub pull and Tracked Apps check) on a schedule
 * This runs independently of the client, so jobs execute even when the browser is closed
 */

const { getBatchConfig } = require('../db/database');
const { createBatchRun, updateBatchRun } = require('../db/database');
const containerService = require('./containerService');
const trackedImageService = require('./trackedImageService');
const { getAllTrackedImages } = require('../db/database');

let batchInterval = null;
let isRunningDockerPull = false;
let isRunningTrackedAppsCheck = false;

/**
 * Run Docker Hub pull batch job
 */
async function runDockerHubPull() {
  // Prevent concurrent runs
  if (isRunningDockerPull) {
    console.log('⏸️  Docker Hub pull already running, skipping...');
    return;
  }

  let runId = null;
  const logs = [];

  const log = (message) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    logs.push(logEntry);
    console.log(`[Batch Docker Pull] ${logEntry}`);
  };

  try {
    isRunningDockerPull = true;
    
    // Create batch run record
    log("Starting batch pull process...");
    runId = await createBatchRun('running', 'docker-hub-pull');
    log(`Batch run ${runId} created`);

    log("🔄 Pulling fresh data from Docker Hub...");
    log("Initiating Docker Hub API call...");

    // Run the pull operation
    const result = await containerService.getAllContainersWithUpdates(true);
    
    log("Docker Hub pull completed successfully");

    // Count containers checked and updated
    const containersChecked = result.containers?.length || 0;
    const containersUpdated = result.containers?.filter((c) => c.hasUpdate).length || 0;
    log(`Processed ${containersChecked} containers, ${containersUpdated} with updates available`);

    // Update batch run as completed
    await updateBatchRun(runId, 'completed', containersChecked, containersUpdated, null, logs.join("\n"));
    log(`Batch run ${runId} marked as completed`);
  } catch (err) {
    let errorMessage = "Failed to pull container data";

    // Handle rate limit errors specially
    if (err.isRateLimitExceeded || err.message?.includes('rate limit')) {
      errorMessage = err.message || "Docker Hub rate limit exceeded. Please wait a few minutes before trying again, or configure Docker Hub credentials in Settings for higher rate limits.";
      log(`❌ Rate limit exceeded: ${errorMessage}`);
    } else {
      errorMessage = err.message || "Failed to pull container data";
      log(`❌ Error: ${errorMessage}`);
      console.error("Error in batch Docker Hub pull:", err);
    }

    // Update batch run as failed
    if (runId) {
      try {
        await updateBatchRun(runId, 'failed', 0, 0, errorMessage, logs.join("\n"));
        log(`Batch run ${runId} marked as failed`);
      } catch (updateErr) {
        console.error("Error updating batch run:", updateErr);
      }
    }
  } finally {
    isRunningDockerPull = false;
    log("Batch pull process finished (success or failure)");
  }
}

/**
 * Run Tracked Apps check batch job
 */
async function runTrackedAppsCheck() {
  // Prevent concurrent runs
  if (isRunningTrackedAppsCheck) {
    console.log('⏸️  Tracked apps check already running, skipping...');
    return;
  }

  let runId = null;
  const logs = [];

  const log = (message) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    logs.push(logEntry);
    console.log(`[Batch Tracked Apps] ${logEntry}`);
  };

  try {
    isRunningTrackedAppsCheck = true;
    
    // Create batch run record
    log("Starting tracked apps batch check process...");
    runId = await createBatchRun('running', 'tracked-apps-check');
    log(`Batch run ${runId} created`);

    log("🔄 Checking for tracked app updates...");
    log("Initiating tracked apps update check...");

    // Get all tracked images and check for updates
    const images = await getAllTrackedImages();
    const results = await trackedImageService.checkAllTrackedImages(images);
    
    log("Tracked apps check completed successfully");

    // Count apps checked and apps with updates
    const appsChecked = images.length;
    const appsWithUpdates = results.filter((r) => r.hasUpdate).length;
    log(`Processed ${appsChecked} tracked apps, ${appsWithUpdates} with updates available`);

    // Update batch run as completed
    await updateBatchRun(runId, 'completed', appsChecked, appsWithUpdates, null, logs.join("\n"));
    log(`Batch run ${runId} marked as completed`);
  } catch (err) {
    let errorMessage = err.message || "Failed to check tracked apps";
    
    log(`❌ Error: ${errorMessage}`);
    console.error("Error in batch tracked apps check:", err);

    // Update batch run as failed
    if (runId) {
      try {
        await updateBatchRun(runId, 'failed', 0, 0, errorMessage, logs.join("\n"));
        log(`Batch run ${runId} marked as failed`);
      } catch (updateErr) {
        console.error("Error updating batch run:", updateErr);
      }
    }
  } finally {
    isRunningTrackedAppsCheck = false;
    log("Tracked apps batch check process finished (success or failure)");
  }
}

// Track last run times to respect interval
let lastDockerPullRun = 0;
let lastTrackedAppsCheckRun = 0;

/**
 * Check batch config and run jobs if enabled
 */
async function checkAndRunBatchJobs() {
  try {
    const allConfigs = await getBatchConfig();
    
    if (!allConfigs) {
      return;
    }

    const now = Date.now();

    // Check Docker Hub pull config
    const dockerConfig = allConfigs['docker-hub-pull'] || { enabled: false, intervalMinutes: 60 };
    if (dockerConfig.enabled && dockerConfig.intervalMinutes >= 1) {
      const intervalMs = dockerConfig.intervalMinutes * 60 * 1000;
      const timeSinceDockerPull = now - lastDockerPullRun;
      if (timeSinceDockerPull >= intervalMs) {
        lastDockerPullRun = now;
        runDockerHubPull().catch(err => {
          console.error('Error in Docker Hub pull batch job:', err);
        });
      }
    }

    // Check Tracked Apps check config
    const trackedAppsConfig = allConfigs['tracked-apps-check'] || { enabled: false, intervalMinutes: 60 };
    if (trackedAppsConfig.enabled && trackedAppsConfig.intervalMinutes >= 1) {
      const intervalMs = trackedAppsConfig.intervalMinutes * 60 * 1000;
      const timeSinceTrackedAppsCheck = now - lastTrackedAppsCheckRun;
      if (timeSinceTrackedAppsCheck >= intervalMs) {
        lastTrackedAppsCheckRun = now;
        runTrackedAppsCheck().catch(err => {
          console.error('Error in tracked apps check batch job:', err);
        });
      }
    }
  } catch (err) {
    console.error('Error checking batch config:', err);
  }
}

/**
 * Start the batch scheduler
 * Checks batch config periodically and runs jobs when enabled
 */
function startBatchScheduler() {
  // Clear any existing interval
  if (batchInterval) {
    clearInterval(batchInterval);
    batchInterval = null;
  }

  // Check config every minute to see if batch is enabled/changed
  batchInterval = setInterval(async () => {
    await checkAndRunBatchJobs();
  }, 60 * 1000); // Check every minute

  // Also check immediately on startup
  checkAndRunBatchJobs();

  console.log('✅ Batch scheduler started (checking every minute for enabled batch jobs)');
}

/**
 * Stop the batch scheduler
 */
function stopBatchScheduler() {
  if (batchInterval) {
    clearInterval(batchInterval);
    batchInterval = null;
    console.log('⏹️  Batch scheduler stopped');
  }
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
  return {
    isRunning: batchInterval !== null,
    isRunningDockerPull,
    isRunningTrackedAppsCheck,
  };
}

module.exports = {
  startBatchScheduler,
  stopBatchScheduler,
  getSchedulerStatus,
  runDockerHubPull,
  runTrackedAppsCheck,
};


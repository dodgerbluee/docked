/**
 * Container Service
 * Handles container operations and update checking
 */

const portainerService = require('./portainerService');
const dockerRegistryService = require('./dockerRegistryService');
const config = require('../config');
const { getAllPortainerInstances, getContainerCache, setContainerCache, clearContainerCache } = require('../db/database');

// Lazy load discordService to avoid loading issues during module initialization
let discordService = null;
function getDiscordService() {
  if (!discordService) {
    try {
      discordService = require('./discordService');
    } catch (error) {
      console.error('Error loading discordService:', error);
      return null;
    }
  }
  return discordService;
}

/**
 * Check if an image has updates available
 * @param {string} imageName - Image name (repo:tag)
 * @param {Object} containerDetails - Container details from Portainer
 * @param {string} portainerUrl - Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @returns {Promise<Object>} - Update information
 */
async function checkImageUpdates(
  imageName,
  containerDetails = null,
  portainerUrl = null,
  endpointId = null
) {
  // Extract image name and tag
  const imageParts = imageName.includes(':')
    ? imageName.split(':')
    : [imageName, 'latest'];
  const repo = imageParts[0];
  const currentTag = imageParts[1];

  // Get current image digest if available
  let currentDigest = null;
  if (containerDetails) {
    currentDigest = await dockerRegistryService.getCurrentImageDigest(
      containerDetails,
      imageName,
      portainerUrl,
      endpointId
    );
  }

  // Get the image digest from registry for the current tag
  let latestImageInfo;
  try {
    latestImageInfo = await dockerRegistryService.getLatestImageDigest(repo, currentTag);
  } catch (error) {
    // If rate limit exceeded, propagate the error
    if (error.isRateLimitExceeded) {
      throw error;
    }
    // For other errors, continue with null (will assume no update)
    latestImageInfo = null;
  }

  let hasUpdate = false;
  let latestDigest = null;
  let latestTag = currentTag; // Use the current tag, not "latest"

  if (latestImageInfo) {
    latestDigest = latestImageInfo.digest;
    latestTag = latestImageInfo.tag;

    // Compare digests to determine if update is available
    if (currentDigest && latestDigest) {
      // If digests are different, there's an update available
      hasUpdate = currentDigest !== latestDigest;
    } else {
      // Fallback: if we can't compare digests, compare tags
      // If current tag is different from latest tag, there's an update
      if (currentTag !== latestTag) {
        hasUpdate = true;
      }
    }
  } else {
    // Fallback: if we can't get digests, assume no update available
    hasUpdate = false;
  }

  // Format digest for display (shortened version)
  const formatDigest = (digest) => {
    if (!digest) return null;
    // Return first 12 characters after "sha256:" for display
    return digest.replace('sha256:', '').substring(0, 12);
  };

  // Get publish date for latest tag (non-blocking - don't fail if this errors)
  let latestPublishDate = null;
  if (latestTag && hasUpdate) {
    try {
      latestPublishDate = await dockerRegistryService.getTagPublishDate(repo, latestTag);
    } catch (error) {
      // Don't fail the entire update check if publish date fetch fails
      // Silently continue - publish date is nice to have but not critical
      latestPublishDate = null;
    }
  }

  // Get publish date for current tag (non-blocking - don't fail if this errors)
  let currentPublishDate = null;
  if (currentTag) {
    try {
      currentPublishDate = await dockerRegistryService.getTagPublishDate(repo, currentTag);
    } catch (error) {
      // Don't fail the entire update check if publish date fetch fails
      // Silently continue - publish date is nice to have but not critical
      currentPublishDate = null;
    }
  }

  return {
    currentTag: currentTag,
    currentVersion: currentTag,
    currentDigest: formatDigest(currentDigest),
    currentDigestFull: currentDigest,
    hasUpdate: hasUpdate,
    latestTag: latestTag,
    newVersion: latestTag,
    latestDigest: formatDigest(latestDigest),
    latestDigestFull: latestDigest,
    latestPublishDate: latestPublishDate,
    currentVersionPublishDate: currentPublishDate,
    imageRepo: repo,
  };
}

/**
 * Upgrade a single container
 * @param {string} portainerUrl - Portainer URL
 * @param {string|number} endpointId - Endpoint ID
 * @param {string} containerId - Container ID
 * @param {string} imageName - Image name (repo:tag)
 * @returns {Promise<Object>} - Upgrade result
 */
async function upgradeSingleContainer(
  portainerUrl,
  endpointId,
  containerId,
  imageName
) {
  // Get container details to preserve configuration
  const containerDetails = await portainerService.getContainerDetails(
    portainerUrl,
    endpointId,
    containerId
  );

  // Preserve the original container name (important for stacks)
  const originalContainerName = containerDetails.Name;
  
  // Check if this container is part of a stack
  const labels = containerDetails.Config.Labels || {};
  const stackName = labels['com.docker.compose.project'] || 
                    labels['com.docker.stack.namespace'] || 
                    null;

  // Extract current and new image info
  const imageParts = imageName.includes(':')
    ? imageName.split(':')
    : [imageName, 'latest'];
  const imageRepo = imageParts[0];
  const currentTag = imageParts[1];

  // Get the image digest from registry for the current tag
  const latestImageInfo = await dockerRegistryService.getLatestImageDigest(imageRepo, currentTag);
  // Use the current tag for upgrades (to get the latest version of that tag)
  const newTag = currentTag;
  const newImageName = `${imageRepo}:${newTag}`;

  console.log(`🔄 Upgrading container ${originalContainerName} from ${imageName} to ${newImageName}`);

  // Stop the container
  console.log(`⏹️  Stopping container ${originalContainerName}...`);
  await portainerService.stopContainer(portainerUrl, endpointId, containerId);

  // Wait for container to fully stop (important for databases and services)
  console.log(`⏳ Waiting for container to stop...`);
  let stopped = false;
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const details = await portainerService.getContainerDetails(portainerUrl, endpointId, containerId);
      // Docker API returns State as an object with Status property
      const containerStatus = details.State?.Status || (details.State?.Running === false ? 'exited' : 'unknown');
      if (containerStatus === 'exited' || containerStatus === 'stopped') {
        stopped = true;
        break;
      }
    } catch (err) {
      // Container might be removed already
      if (err.response?.status === 404) {
        stopped = true;
        break;
      }
    }
  }
  if (!stopped) {
    console.warn(`⚠️  Container did not stop within timeout, proceeding anyway...`);
  }

  // Pull the latest image
  console.log(`📥 Pulling latest image ${newImageName}...`);
  await portainerService.pullImage(portainerUrl, endpointId, newImageName);

  // Remove old container
  console.log(`🗑️  Removing old container...`);
  await portainerService.removeContainer(portainerUrl, endpointId, containerId);

  // Clean HostConfig - remove container-specific references
  const cleanHostConfig = { ...containerDetails.HostConfig };
  delete cleanHostConfig.ContainerIDFile;

  // Create new container with same configuration
  console.log(`🔨 Creating new container...`);
  const containerConfig = {
    Image: newImageName,
    Cmd: containerDetails.Config.Cmd,
    Env: containerDetails.Config.Env,
    ExposedPorts: containerDetails.Config.ExposedPorts,
    HostConfig: cleanHostConfig,
    Labels: containerDetails.Config.Labels,
    WorkingDir: containerDetails.Config.WorkingDir,
    Entrypoint: containerDetails.Config.Entrypoint,
    NetworkingConfig: containerDetails.NetworkSettings?.Networks ? {
      EndpointsConfig: containerDetails.NetworkSettings.Networks
    } : undefined,
  };

  // Pass container name as separate parameter (Docker API uses it as query param)
  const newContainer = await portainerService.createContainer(
    portainerUrl,
    endpointId,
    containerConfig,
    originalContainerName
  );

  // Start the new container
  console.log(`▶️  Starting new container...`);
  await portainerService.startContainer(portainerUrl, endpointId, newContainer.Id);

  // Wait for container to be healthy/ready (CRITICAL for databases)
  console.log(`⏳ Waiting for container ${originalContainerName} to be ready...`);
  let isReady = false;
  const maxWaitTime = 120000; // 2 minutes max for databases with health checks
  const checkInterval = 2000; // Check every 2 seconds
  const startTime = Date.now();
  let consecutiveRunningChecks = 0;
  const requiredStableChecks = 3; // Container must be running for 3 consecutive checks (6 seconds)

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    
    try {
      const details = await portainerService.getContainerDetails(portainerUrl, endpointId, newContainer.Id);
      
      // Check if container is running
      // Docker API returns State as an object with Status property
      const containerStatus = details.State?.Status || (details.State?.Running ? 'running' : 'unknown');
      if (containerStatus !== 'running') {
        consecutiveRunningChecks = 0; // Reset counter
        if (containerStatus === 'exited') {
          // Container exited - get logs for debugging
          try {
            const logs = await portainerService.getContainerLogs(portainerUrl, endpointId, newContainer.Id, 50);
            const exitCode = details.State?.ExitCode || 0;
            throw new Error(`Container exited with code ${exitCode}. Last 50 lines of logs:\n${logs}`);
          } catch (logErr) {
            const exitCode = details.State?.ExitCode || 0;
            throw new Error(`Container exited with code ${exitCode}. Could not retrieve logs.`);
          }
        }
        continue; // Still starting up
      }

      // Container is running - increment counter
      consecutiveRunningChecks++;

      // Check health status if health check is configured
      if (details.State?.Health) {
        const healthStatus = details.State.Health.Status;
        if (healthStatus === 'healthy') {
          isReady = true;
          console.log(`✅ Container health check passed`);
          break;
        } else if (healthStatus === 'unhealthy') {
          try {
            const logs = await portainerService.getContainerLogs(portainerUrl, endpointId, newContainer.Id, 50);
            throw new Error(`Container health check failed. Last 50 lines of logs:\n${logs}`);
          } catch (logErr) {
            throw new Error('Container health check failed. Could not retrieve logs.');
          }
        }
        // Status is 'starting' or 'none', continue waiting
        // However, if container has been running for a while and health check is still starting,
        // consider it ready (some containers never report healthy but work fine)
        const waitTime = Date.now() - startTime;
        if (waitTime >= 30000 && consecutiveRunningChecks >= 5) {
          // Container has been running for 30+ seconds with 5+ stable checks
          // and health check is still starting - likely a container that doesn't properly report health
          console.log(`⚠️  Health check still starting after 30s, but container is running stably - considering ready`);
          isReady = true;
          break;
        }
        // For health checks, we'll wait up to maxWaitTime
      } else {
        // No health check configured - use stability check instead
        // For databases and services, wait a minimum time for initialization
        const waitTime = Date.now() - startTime;
        const minInitTime = 15000; // Wait at least 15 seconds for initialization (databases need this)
        
        if (waitTime >= minInitTime && consecutiveRunningChecks >= requiredStableChecks) {
          // Container has been running stably for required checks
          isReady = true;
          console.log(`✅ Container is running and stable (${consecutiveRunningChecks * checkInterval / 1000}s stable)`);
          break;
        }
        
        // If we've waited a reasonable time and container is running, consider it ready
        // This handles containers that start quickly (non-databases)
        if (waitTime >= 5000 && consecutiveRunningChecks >= 2) {
          // Check if this looks like a database container (common database image names)
          const isLikelyDatabase = /postgres|mysql|mariadb|redis|mongodb|couchdb|influxdb|elasticsearch/i.test(imageName);
          if (!isLikelyDatabase) {
            // Not a database, and it's been running stably - consider it ready
            isReady = true;
            console.log(`✅ Container is running and stable (non-database service)`);
            break;
          }
          // For databases, continue waiting for minInitTime
        }
      }
    } catch (err) {
      if (err.message.includes('exited') || err.message.includes('health check')) {
        throw err;
      }
      // Continue waiting on other errors
      consecutiveRunningChecks = 0; // Reset on error
    }
  }

  if (!isReady) {
    // Final check - if container is running, consider it ready even if we hit timeout
    try {
      const details = await portainerService.getContainerDetails(portainerUrl, endpointId, newContainer.Id);
      // Docker API returns State as an object with Status property
      const containerStatus = details.State?.Status || (details.State?.Running ? 'running' : 'unknown');
      const isRunning = containerStatus === 'running' || details.State?.Running === true;
      if (isRunning) {
        console.log(`⚠️  Timeout reached but container is running - considering it ready`);
        isReady = true;
      } else {
        // Format state info for error message
        const stateInfo = containerStatus || (details.State ? JSON.stringify(details.State) : 'unknown');
        throw new Error(`Container did not become ready within timeout period (2 minutes). Current state: ${stateInfo}`);
      }
    } catch (err) {
      if (err.message.includes('Current state')) {
        throw err;
      }
      // If we can't check, throw the timeout error
      throw new Error('Container did not become ready within timeout period (2 minutes). Container may have failed to start.');
    }
  }

  console.log(`✅ Container ${originalContainerName} is ready`);

  // If this is part of a stack, restart dependent containers
  if (stackName) {
    console.log(`🔄 Checking for dependent containers in stack: ${stackName}`);
    try {
      const allContainers = await portainerService.getContainers(portainerUrl, endpointId);
      
      // Find containers in the same stack
      const stackContainers = [];
      for (const container of allContainers) {
        if (container.Id === newContainer.Id) continue; // Skip the one we just upgraded
        
        try {
          const details = await portainerService.getContainerDetails(portainerUrl, endpointId, container.Id);
          const containerStackName = details.Config.Labels?.['com.docker.compose.project'] || 
                                     details.Config.Labels?.['com.docker.stack.namespace'] || 
                                     null;
          
          if (containerStackName === stackName && details.State === 'running') {
            stackContainers.push({
              id: container.Id,
              name: container.Names[0]?.replace('/', '') || container.Id.substring(0, 12),
            });
          }
        } catch (err) {
          // Skip containers we can't inspect
          continue;
        }
      }

      // Restart dependent containers to reconnect to the upgraded service
      if (stackContainers.length > 0) {
        console.log(`🔄 Restarting ${stackContainers.length} dependent container(s) to reconnect...`);
        for (const container of stackContainers) {
          try {
            console.log(`   Restarting ${container.name}...`);
            await portainerService.stopContainer(portainerUrl, endpointId, container.id);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Brief wait
            await portainerService.startContainer(portainerUrl, endpointId, container.id);
            console.log(`   ✅ ${container.name} restarted successfully`);
          } catch (err) {
            console.error(`   ⚠️  Failed to restart ${container.name}:`, err.message);
            // Continue with other containers
          }
        }
        console.log(`✅ All dependent containers restarted`);
      } else {
        console.log(`ℹ️  No other running containers found in stack ${stackName}`);
      }
    } catch (err) {
      console.error('⚠️  Error restarting dependent containers:', err.message);
      // Don't fail the upgrade if dependent restart fails
    }
  }

  // Invalidate cache for this image so next check gets fresh data
  dockerRegistryService.clearDigestCache(imageRepo, currentTag);

  console.log(`✅ Upgrade completed successfully for ${originalContainerName}`);

  return {
    success: true,
    containerId: containerId,
    containerName: originalContainerName.replace('/', ''),
    newContainerId: newContainer.Id,
    oldImage: imageName,
    newImage: newImageName,
  };
}

/**
 * Get all containers with update status from all Portainer instances
 * @returns {Promise<Object>} - Containers grouped by stack
 */
/**
 * Get all containers with update status
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh data
 * @returns {Promise<Object>} - Containers with update information
 */
async function getAllContainersWithUpdates(forceRefresh = false) {
  // Get previous cache to compare for newly detected updates
  let previousCache = null;
  if (forceRefresh) {
    previousCache = await getContainerCache('containers');
  }

  // Check cache first unless force refresh is requested
  if (!forceRefresh) {
    const cached = await getContainerCache('containers');
    if (cached) {
      // Reduced logging - only log in debug mode
      if (process.env.DEBUG) {
        console.log('✅ Using cached container data from database');
      }
      return cached;
    }
    // No cached data found - return empty result instead of fetching from Docker Hub
    // User must explicitly click "Pull" or batch process must run to fetch fresh data
    if (process.env.DEBUG) {
      console.log('📦 No cached data found, returning empty result. User must click "Pull" to fetch data.');
    }
    // IMPORTANT: Do NOT call Docker Hub here - only return empty result
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  } else {
    // Only when forceRefresh=true (explicit pull request or batch process)
    console.log('🔄 Force refresh requested, fetching fresh data from Docker Hub...');
    // Don't clear cache immediately - keep old data visible until new data is ready
    // Cache will be replaced when new data is saved
  }
  const allContainers = [];

  // Get Portainer instances from database
  const portainerInstances = await getAllPortainerInstances();
  
  if (portainerInstances.length === 0) {
    // Only log warning, not every time
    if (process.env.DEBUG) {
      console.log('⚠️  No Portainer instances configured. Please add instances from the home page.');
    }
    // Return empty result and cache it so we don't keep trying to fetch
    const emptyResult = {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
    // Cache empty result to prevent repeated attempts
    try {
      await setContainerCache('containers', emptyResult);
    } catch (error) {
      console.error('Error caching empty result:', error.message);
    }
    return emptyResult;
  }
  
  const instancesToUse = portainerInstances;

  // Fetch containers from all Portainer instances
  for (const instance of instancesToUse) {
    const portainerUrl = instance.url || instance;
    const instanceName = instance.name || (typeof instance === 'string' ? new URL(instance).hostname : new URL(portainerUrl).hostname);
    const username = instance.username;
    const password = instance.password;
    
    try {
      await portainerService.authenticatePortainer(portainerUrl, username, password);
      const endpoints = await portainerService.getEndpoints(portainerUrl);

      if (endpoints.length === 0) {
        console.log(`No endpoints found for ${portainerUrl}`);
        continue;
      }

      // Use first endpoint for each Portainer instance
      const endpointId = endpoints[0].Id;
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      const containersWithUpdates = await Promise.all(
        containers.map(async (container) => {
          try {
            const details = await portainerService.getContainerDetails(
              portainerUrl,
              endpointId,
              container.Id
            );
            const imageName = details.Config.Image;
            
            // Reduced logging - only log in debug mode or for errors
            const updateInfo = await checkImageUpdates(
              imageName,
              details,
              portainerUrl,
              endpointId
            );

            // Extract stack name from labels
            const labels = details.Config.Labels || {};
            const stackName =
              labels['com.docker.compose.project'] ||
              labels['com.docker.stack.namespace'] ||
              null;

            return {
              id: container.Id,
              name:
                container.Names[0]?.replace('/', '') || container.Id.substring(0, 12),
              image: imageName,
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: updateInfo.hasUpdate,
              currentTag: updateInfo.currentTag,
              currentVersion: updateInfo.currentVersion,
              currentDigest: updateInfo.currentDigest,
              latestTag: updateInfo.latestTag,
              newVersion: updateInfo.newVersion,
              latestDigest: updateInfo.latestDigest,
              currentDigestFull: updateInfo.currentDigestFull,
              latestDigestFull: updateInfo.latestDigestFull,
              latestPublishDate: updateInfo.latestPublishDate,
              currentVersionPublishDate: updateInfo.currentVersionPublishDate,
              imageRepo: updateInfo.imageRepo,
              stackName: stackName,
            };
          } catch (error) {
            // If rate limit exceeded, propagate the error to stop the entire process
            if (error.isRateLimitExceeded) {
              throw error;
            }
            // If a single container fails, log it but don't break the entire process
            if (process.env.DEBUG) {
              console.error(`   ❌ Error checking updates for container ${container.Names[0]?.replace('/', '') || container.Id.substring(0, 12)}:`, error.message);
            }
            // Return a basic container object without update info
            return {
              id: container.Id,
              name: container.Names[0]?.replace('/', '') || container.Id.substring(0, 12),
              image: container.Image || 'unknown',
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: false,
              currentTag: null,
              currentVersion: null,
              currentDigest: null,
              latestTag: null,
              newVersion: null,
              latestDigest: null,
              currentDigestFull: null,
              latestDigestFull: null,
              latestPublishDate: null,
              imageRepo: null,
              stackName: null,
            };
          }
        })
      );

      allContainers.push(...containersWithUpdates);
    } catch (error) {
      // If rate limit exceeded, propagate the error immediately
      if (error.isRateLimitExceeded) {
        throw error;
      }
      console.error(
        `Error fetching containers from ${portainerUrl}:`,
        error.message
      );
      // Continue with other Portainer instances even if one fails
    }
  }

  // Group containers by stack
  const groupedByStack = allContainers.reduce((acc, container) => {
    const stackName = container.stackName || 'Standalone';
    if (!acc[stackName]) {
      acc[stackName] = [];
    }
    acc[stackName].push(container);
    return acc;
  }, {});

  // Convert to array format with stack names
  const groupedContainers = Object.keys(groupedByStack).map((stackName) => ({
    stackName: stackName,
    containers: groupedByStack[stackName],
  }));

  // Sort stacks: named stacks first, then "Standalone"
  groupedContainers.sort((a, b) => {
    if (a.stackName === 'Standalone') return 1;
    if (b.stackName === 'Standalone') return -1;
    return a.stackName.localeCompare(b.stackName);
  });

  // Get unused images count
  let unusedImagesCount = 0;
  for (const instance of instancesToUse) {
    const portainerUrl = instance.url || instance;
    const username = instance.username;
    const password = instance.password;
    const apiKey = instance.api_key;
    const authType = instance.auth_type || 'apikey';
    
    try {
      await portainerService.authenticatePortainer(portainerUrl, username, password, apiKey, authType);
      const endpoints = await portainerService.getEndpoints(portainerUrl);
      if (endpoints.length === 0) continue;

      const endpointId = endpoints[0].Id;
      const images = await portainerService.getImages(portainerUrl, endpointId);
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      // Get all used image IDs (normalize to handle both full and shortened IDs)
      const usedIds = new Set();
      const normalizeImageId = (id) => {
        const cleanId = id.replace(/^sha256:/, '');
        return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
      };

      for (const container of containers) {
        const details = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          container.Id
        );
        if (details.Image) {
          usedIds.add(details.Image);
          usedIds.add(normalizeImageId(details.Image));
        }
      }

      // Count unused images
      for (const image of images) {
        const imageIdNormalized = normalizeImageId(image.Id);
        const isUsed =
          usedIds.has(image.Id) || usedIds.has(imageIdNormalized);
        if (!isUsed) {
          unusedImagesCount++;
        }
      }
    } catch (error) {
      console.error(
        `Error counting unused images from ${portainerUrl}:`,
        error.message
      );
    }
  }

  // Build portainerInstances array for frontend
  const portainerInstancesArray = instancesToUse.map(instance => {
    const portainerUrl = instance.url || instance;
    const instanceName = instance.name || (typeof instance === 'string' ? new URL(instance).hostname : new URL(portainerUrl).hostname);
    
    // Get containers for this instance
    const instanceContainers = allContainers.filter(c => c.portainerUrl === portainerUrl);
    const withUpdates = instanceContainers.filter(c => c.hasUpdate);
    const upToDate = instanceContainers.filter(c => !c.hasUpdate);
    
    return {
      id: instance.id,
      name: instanceName,
      url: portainerUrl,
      containers: instanceContainers,
      withUpdates: withUpdates,
      upToDate: upToDate,
      totalContainers: instanceContainers.length,
    };
  });

  const result = {
    grouped: true,
    stacks: groupedContainers,
    containers: allContainers,
    portainerInstances: portainerInstancesArray,
    unusedImagesCount: unusedImagesCount,
  };

  // Save to cache for future requests
  // This replaces the old cache with fresh data
  try {
    await setContainerCache('containers', result);
    console.log('💾 Container data cached in database (replaced old cache)');
  } catch (error) {
    console.error('Error saving container cache:', error.message);
    // Continue even if cache save fails
  }

  // Send Discord notifications for newly detected container updates
  if (previousCache && previousCache.containers) {
    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        // Create a map of previous containers by unique identifier
        // Use combination of id, portainerUrl, and endpointId for uniqueness
        const previousContainersMap = new Map();
        previousCache.containers.forEach(container => {
          const key = `${container.id}-${container.portainerUrl}-${container.endpointId}`;
          previousContainersMap.set(key, container);
        });

        // Check each new container for newly detected updates
        for (const container of allContainers) {
          if (container.hasUpdate) {
            const key = `${container.id}-${container.portainerUrl}-${container.endpointId}`;
            const previousContainer = previousContainersMap.get(key);
            
            // Only notify if this is a newly detected update (didn't have update before)
            if (!previousContainer || !previousContainer.hasUpdate) {
              // Format container data for notification
              const imageName = container.image || 'Unknown';
              const currentVersion = container.currentVersion || container.currentTag || 'Unknown';
              const latestVersion = container.newVersion || container.latestTag || container.latestVersion || 'Unknown';
              
              await discord.queueNotification({
                id: container.id,
                name: container.name,
                imageName: imageName,
                githubRepo: null,
                sourceType: 'docker',
                currentVersion: currentVersion,
                latestVersion: latestVersion,
                latestVersionPublishDate: container.latestPublishDate || null,
                releaseUrl: null, // Containers don't have release URLs
                notificationType: 'portainer-container',
              });
            }
          }
        }
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      console.error('Error sending Discord notifications for container updates:', error);
    }
  }

  return result;
}

/**
 * Get containers from Portainer without Docker Hub update checks
 * This allows viewing current containers and unused images without Docker Hub data
 * @returns {Promise<Object>} - Containers with basic information (no update status)
 */
async function getContainersFromPortainer() {
  console.log('⏳ Fetching containers from Portainer (no Docker Hub checks)...');
  const allContainers = [];

  // Get Portainer instances from database
  const portainerInstances = await getAllPortainerInstances();
  
  if (portainerInstances.length === 0) {
    console.log('⚠️  No Portainer instances configured.');
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  }

  // Fetch containers from all Portainer instances
  for (const instance of portainerInstances) {
    const portainerUrl = instance.url;
    const instanceName = instance.name || new URL(portainerUrl).hostname;
      const username = instance.username;
      const password = instance.password;
      const apiKey = instance.api_key;
      const authType = instance.auth_type || 'password';
      
      try {
        await portainerService.authenticatePortainer(portainerUrl, username, password, apiKey, authType);
        const endpoints = await portainerService.getEndpoints(portainerUrl);

        if (endpoints.length === 0) {
          console.log(`No endpoints found for ${portainerUrl}`);
          continue;
        }

        const endpointId = endpoints[0].Id;
        const containers = await portainerService.getContainers(portainerUrl, endpointId);

        const containersBasic = await Promise.all(
        containers.map(async (container) => {
          try {
            const details = await portainerService.getContainerDetails(
              portainerUrl,
              endpointId,
              container.Id
            );
            const imageName = details.Config.Image;
            
            // Extract image digest from Image field (format: sha256:...)
            const imageId = details.Image || '';
            const currentDigest = imageId.startsWith('sha256:') 
              ? imageId.split(':')[1].substring(0, 12) 
              : imageId.substring(0, 12);

            // Extract tag from image name
            const imageParts = imageName.includes(':')
              ? imageName.split(':')
              : [imageName, 'latest'];
            const repo = imageParts[0];
            const currentTag = imageParts[1];

            // Get publish date for current tag (non-blocking - don't fail if this errors)
            let currentPublishDate = null;
            if (currentTag) {
              try {
                currentPublishDate = await dockerRegistryService.getTagPublishDate(repo, currentTag);
              } catch (error) {
                // Don't fail if publish date fetch fails
                currentPublishDate = null;
              }
            }

            // Extract stack name from labels
            const labels = details.Config.Labels || {};
            const stackName =
              labels['com.docker.compose.project'] ||
              labels['com.docker.stack.namespace'] ||
              null;

            return {
              id: container.Id,
              name: container.Names[0]?.replace('/', '') || container.Id.substring(0, 12),
              image: imageName,
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: false, // No Docker Hub check
              currentDigest: currentDigest,
              currentTag: currentTag,
              currentVersion: currentTag,
              latestDigest: null,
              latestTag: null,
              latestVersion: null,
              currentVersionPublishDate: currentPublishDate,
              stackName: stackName,
              imageId: details.Image,
            };
          } catch (error) {
            console.error(`Error processing container ${container.Id}:`, error.message);
            return null;
          }
        })
      );

      // Filter out null results
      const validContainers = containersBasic.filter(c => c !== null);
      allContainers.push(...validContainers);
    } catch (error) {
      console.error(`Error fetching containers from ${portainerUrl}:`, error.message);
    }
  }

  // Group containers by stack
  const stacksMap = new Map();
  const unstackedContainers = [];

  for (const container of allContainers) {
    if (container.stackName) {
      if (!stacksMap.has(container.stackName)) {
        stacksMap.set(container.stackName, []);
      }
      stacksMap.get(container.stackName).push(container);
    } else {
      unstackedContainers.push(container);
    }
  }

  const stacks = Array.from(stacksMap.entries()).map(([name, containers]) => ({
    name,
    containers,
  }));

  if (unstackedContainers.length > 0) {
    stacks.push({
      name: 'Unstacked',
      containers: unstackedContainers,
    });
  }

  // Get unused images count
  const unusedImages = await getUnusedImages();
  const unusedImagesCount = unusedImages.length;

  // Group containers by Portainer instance
  const portainerInstancesArray = portainerInstances.map((instance) => {
    const instanceContainers = allContainers.filter(
      (c) => c.portainerUrl === instance.url
    );
    return {
      name: instance.name || new URL(instance.url).hostname,
      url: instance.url,
      id: instance.id,
      containers: instanceContainers,
      withUpdates: [], // No Docker Hub data
      upToDate: instanceContainers, // All are "up to date" since we don't check
    };
  });

  const result = {
    grouped: true,
    stacks: stacks,
    containers: allContainers,
    portainerInstances: portainerInstancesArray,
    unusedImagesCount: unusedImagesCount,
  };

  return result;
}

/**
 * Get unused images from all Portainer instances
 * @returns {Promise<Array>} - Array of unused images
 */
async function getUnusedImages() {
  const unusedImages = [];

  // Get Portainer instances from database
  const portainerInstances = await getAllPortainerInstances();
  
  if (portainerInstances.length === 0) {
    return [];
  }

  for (const instance of portainerInstances) {
    const portainerUrl = instance.url;
    const username = instance.username;
    const password = instance.password;
    const apiKey = instance.api_key;
    const authType = instance.auth_type || 'apikey';
    
    try {
      await portainerService.authenticatePortainer(portainerUrl, username, password, apiKey, authType);
      const endpoints = await portainerService.getEndpoints(portainerUrl);
      if (endpoints.length === 0) continue;

      const endpointId = endpoints[0].Id;
      const images = await portainerService.getImages(portainerUrl, endpointId);
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      // Get all used image IDs
      const usedIds = new Set();
      const normalizeImageId = (id) => {
        const cleanId = id.replace(/^sha256:/, '');
        return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
      };

      for (const container of containers) {
        const details = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          container.Id
        );
        if (details.Image) {
          usedIds.add(details.Image);
          usedIds.add(normalizeImageId(details.Image));
        }
      }

      // Find unused images
      for (const image of images) {
        const imageIdNormalized = normalizeImageId(image.Id);
        const isUsed =
          usedIds.has(image.Id) || usedIds.has(imageIdNormalized);

        if (!isUsed) {
          let repoTags = image.RepoTags;

          // If RepoTags is null or empty, try to get from RepoDigests
          if (
            !repoTags ||
            repoTags.length === 0 ||
            (repoTags.length === 1 && repoTags[0] === '<none>:<none>')
          ) {
            if (image.RepoDigests && image.RepoDigests.length > 0) {
              repoTags = image.RepoDigests.map((digest) => {
                const repoPart = digest.split('@sha256:')[0];
                return repoPart ? `${repoPart}:<none>` : '<none>:<none>';
              });
            } else {
              // Try to inspect the image to get more details
              try {
                const imageDetails = await portainerService.getImageDetails(
                  portainerUrl,
                  endpointId,
                  image.Id
                );
                if (imageDetails.RepoTags && imageDetails.RepoTags.length > 0) {
                  repoTags = imageDetails.RepoTags;
                } else if (
                  imageDetails.RepoDigests &&
                  imageDetails.RepoDigests.length > 0
                ) {
                  repoTags = imageDetails.RepoDigests.map((digest) => {
                    const repoPart = digest.split('@sha256:')[0];
                    return repoPart ? `${repoPart}:<none>` : '<none>:<none>';
                  });
                }
              } catch (err) {
                console.log(
                  `Could not inspect image ${image.Id}: ${err.message}`
                );
              }
            }
          }

          // Fallback to default if still no tags
          if (!repoTags || repoTags.length === 0) {
            repoTags = ['<none>:<none>'];
          }

          const instanceName = instance.name || new URL(portainerUrl).hostname;
          unusedImages.push({
            id: image.Id,
            repoTags: repoTags,
            size: image.Size,
            created: image.Created,
            portainerUrl: portainerUrl,
            endpointId: endpointId,
            portainerName: instanceName,
          });
        }
      }
    } catch (error) {
      console.error(
        `Error fetching unused images from ${portainerUrl}:`,
        error.message
      );
    }
  }

  return unusedImages;
}

module.exports = {
  checkImageUpdates,
  upgradeSingleContainer,
  getAllContainersWithUpdates,
  getContainersFromPortainer,
  getUnusedImages,
};


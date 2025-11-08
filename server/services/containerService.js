/**
 * Container Service
 * Handles container operations and update checking
 */

const portainerService = require('./portainerService');
const dockerRegistryService = require('./dockerRegistryService');
const config = require('../config');
const { getAllPortainerInstances, getContainerCache, setContainerCache, clearContainerCache } = require('../db/database');

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
  let currentTagFromDigest = null;
  if (containerDetails) {
    currentDigest = await dockerRegistryService.getCurrentImageDigest(
      containerDetails,
      imageName,
      portainerUrl,
      endpointId
    );
    
    // Try to find the actual version tag from the digest
    // This ensures we link to the correct version page even if the container is using "latest"
    // Uses aggressive caching to minimize Docker Hub API calls
    if (currentDigest) {
      console.log(`   🔍 Looking up version tag for current digest...`);
      currentTagFromDigest = await dockerRegistryService.getTagFromDigest(repo, currentDigest);
      if (currentTagFromDigest) {
        console.log(`   ✅ Found version tag for current digest: ${currentTagFromDigest}`);
      } else {
        console.log(`   ⚠️  Could not find version tag, will use original tag: ${currentTag}`);
      }
    }
  }

  // Get the image digest from registry for the current tag
  console.log(`   📡 Fetching latest digest for ${repo}:${currentTag}`);
  const latestImageInfo = await dockerRegistryService.getLatestImageDigest(repo, currentTag);
  console.log(`   📡 Latest image info:`, latestImageInfo ? {
    digest: latestImageInfo.digest?.substring(0, 20) + '...',
    tag: latestImageInfo.tag,
  } : 'null');

  let hasUpdate = false;
  let latestDigest = null;
  let latestTag = currentTag; // Use the current tag, not "latest"

  if (latestImageInfo) {
    latestDigest = latestImageInfo.digest;
    latestTag = latestImageInfo.tag;

    console.log(`   🔄 Comparing digests:`, {
      currentDigest: currentDigest ? currentDigest.substring(0, 20) + '...' : 'null',
      latestDigest: latestDigest ? latestDigest.substring(0, 20) + '...' : 'null',
      currentTag,
      latestTag,
    });

    // Compare digests to determine if update is available
    if (currentDigest && latestDigest) {
      // If digests are different, there's an update available
      hasUpdate = currentDigest !== latestDigest;
      console.log(`   ✅ Digest comparison: ${hasUpdate ? 'UPDATE AVAILABLE' : 'UP TO DATE'}`);
    } else {
      // Fallback: if we can't compare digests, compare tags
      // If current tag is different from latest tag, there's an update
      if (currentTag !== latestTag) {
        hasUpdate = true;
        console.log(`   ⚠️  Using tag comparison fallback: ${hasUpdate ? 'UPDATE AVAILABLE' : 'UP TO DATE'}`);
      } else {
        console.log(`   ⚠️  No digests available, tags match: UP TO DATE`);
      }
    }
  } else {
    // Fallback: if we can't get digests, assume no update available
    hasUpdate = false;
    console.log(`   ❌ Could not fetch latest image info: assuming UP TO DATE`);
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
      console.log(`   📅 Fetching publish date for ${repo}:${latestTag}`);
      latestPublishDate = await dockerRegistryService.getTagPublishDate(repo, latestTag);
      if (latestPublishDate) {
        console.log(`   ✅ Got publish date: ${latestPublishDate}`);
      }
    } catch (error) {
      // Don't fail the entire update check if publish date fetch fails
      console.log(`   ⚠️  Could not fetch publish date (non-critical): ${error.message}`);
      latestPublishDate = null;
    }
  }

  return {
    currentTag: currentTagFromDigest || currentTag, // Use version from digest lookup if available
    currentVersion: currentTagFromDigest || currentTag,
    currentDigest: formatDigest(currentDigest),
    currentDigestFull: currentDigest,
    hasUpdate: hasUpdate,
    latestTag: latestTag,
    newVersion: latestTag,
    latestDigest: formatDigest(latestDigest),
    latestDigestFull: latestDigest,
    latestPublishDate: latestPublishDate,
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

  // Stop the container
  await portainerService.stopContainer(portainerUrl, endpointId, containerId);

  // Pull the latest image
  await portainerService.pullImage(portainerUrl, endpointId, newImageName);

  // Remove old container
  await portainerService.removeContainer(portainerUrl, endpointId, containerId);

  // Create new container with same configuration
  const containerConfig = {
    Image: newImageName,
    Cmd: containerDetails.Config.Cmd,
    Env: containerDetails.Config.Env,
    ExposedPorts: containerDetails.Config.ExposedPorts,
    HostConfig: containerDetails.HostConfig,
    Labels: containerDetails.Config.Labels,
    WorkingDir: containerDetails.Config.WorkingDir,
    Entrypoint: containerDetails.Config.Entrypoint,
  };

  // Pass container name as separate parameter (Docker API uses it as query param)
  const newContainer = await portainerService.createContainer(
    portainerUrl,
    endpointId,
    containerConfig,
    originalContainerName
  );

  // Start the new container
  await portainerService.startContainer(portainerUrl, endpointId, newContainer.Id);

  // Invalidate cache for this image so next check gets fresh data
  dockerRegistryService.clearDigestCache(imageRepo, currentTag);

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
  // Check cache first unless force refresh is requested
  if (!forceRefresh) {
    const cached = await getContainerCache('containers');
    if (cached) {
      console.log('✅ Using cached container data from database');
      return cached;
    }
    // No cached data found - return empty result instead of fetching from Docker Hub
    // User must explicitly click "Pull" to fetch fresh data
    console.log('📦 No cached data found, returning empty result. User must click "Pull" to fetch data.');
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  } else {
    console.log('🔄 Force refresh requested, fetching fresh data...');
    // Don't clear cache immediately - keep old data visible until new data is ready
    // Cache will be replaced when new data is saved
  }

  console.log('⏳ Fetching container updates from Portainer...');
  const allContainers = [];

  // Get Portainer instances from database
  const portainerInstances = await getAllPortainerInstances();
  
  if (portainerInstances.length === 0) {
    console.log('⚠️  No Portainer instances configured. Please add instances from the home page.');
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
            
            console.log(`🔍 Checking updates for container: ${container.Names[0]?.replace('/', '') || container.Id.substring(0, 12)}`);
            console.log(`   Image: ${imageName}`);
            
            const updateInfo = await checkImageUpdates(
              imageName,
              details,
              portainerUrl,
              endpointId
            );
            
            console.log(`   Update check result:`, {
              hasUpdate: updateInfo.hasUpdate,
              currentDigest: updateInfo.currentDigest,
              latestDigest: updateInfo.latestDigest,
              currentTag: updateInfo.currentTag,
              latestTag: updateInfo.latestTag,
            });

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
              imageRepo: updateInfo.imageRepo,
              stackName: stackName,
            };
          } catch (error) {
            // If a single container fails, log it but don't break the entire process
            console.error(`   ❌ Error checking updates for container ${container.Names[0]?.replace('/', '') || container.Id.substring(0, 12)}:`, error.message);
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
    
    try {
      await portainerService.authenticatePortainer(portainerUrl, username, password);
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
    
    try {
      await portainerService.authenticatePortainer(portainerUrl, username, password);
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
              currentTag: null,
              currentVersion: null,
              latestDigest: null,
              latestTag: null,
              latestVersion: null,
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
    
    try {
      await portainerService.authenticatePortainer(portainerUrl, username, password);
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


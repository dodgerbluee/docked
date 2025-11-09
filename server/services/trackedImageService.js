/**
 * Tracked Image Service
 * Handles update checking for tracked images (Docker and GitHub)
 */

const dockerRegistryService = require('./dockerRegistryService');
const githubService = require('./githubService');
const { updateTrackedImage } = require('../db/database');

/**
 * Check for updates on a single tracked image
 * @param {Object} trackedImage - Tracked image object from database
 * @returns {Promise<Object>} - Update information
 */
async function checkTrackedImage(trackedImage) {
  const sourceType = trackedImage.source_type || 'docker';
  
  // Handle GitHub repositories
  if (sourceType === 'github' && trackedImage.github_repo) {
    return await checkGitHubTrackedImage(trackedImage);
  }
  
  // Handle Docker images (existing logic)
  const imageName = trackedImage.image_name;
  
  // Extract image name and tag
  const imageParts = imageName.includes(':')
    ? imageName.split(':')
    : [imageName, 'latest'];
  const repo = imageParts[0];
  const currentTag = imageParts[1];

  // Get the latest image digest from registry
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
  let latestTag = currentTag;
  let latestVersion = null; // Don't set a default - only set if we successfully get info

  if (latestImageInfo && latestImageInfo.digest) {
    latestDigest = latestImageInfo.digest;
    latestTag = latestImageInfo.tag || currentTag;
    
    // If the tag is "latest", try to find the actual version tag it points to
    if (latestTag === 'latest' && latestDigest) {
      try {
        const actualTag = await dockerRegistryService.getTagFromDigest(repo, latestDigest);
        if (actualTag && actualTag !== 'latest' && actualTag.trim() !== '') {
          latestVersion = actualTag.trim();
          latestTag = actualTag.trim(); // Use the actual tag for display
        } else {
          // If we can't find the actual tag, don't set latestVersion (keep as null)
          // This means we'll keep the existing stored version
          latestVersion = null;
        }
      } catch (error) {
        // If we can't find the actual tag, don't update the version
        latestVersion = null;
      }
    } else if (latestTag && latestTag !== 'latest') {
      // For non-latest tags, use the tag as the version
      latestVersion = latestTag;
    } else {
      // If tag is still "latest" and we couldn't resolve it, don't update version
      latestVersion = null;
    }

    // Compare digests to determine if update is available
    if (trackedImage.current_digest && latestDigest) {
      // If digests are different, there's an update available
      hasUpdate = trackedImage.current_digest !== latestDigest;
    } else if (latestVersion && latestVersion !== 'latest') {
      // Fallback: if we can't compare digests, compare tags (only if we have a real version)
      if (trackedImage.current_version && trackedImage.current_version !== latestVersion) {
        hasUpdate = true;
      }
    }
  }

  // Format digest for display (shortened version)
  const formatDigest = (digest) => {
    if (!digest) return null;
    // Return first 12 characters after "sha256:" for display
    return digest.replace('sha256:', '').substring(0, 12);
  };

  // Get publish date for latest tag (non-blocking - don't fail if this errors)
  // Use the resolved version tag (not "latest") if available
  let latestPublishDate = null;
  const tagForPublishDate = latestVersion !== 'latest' ? latestVersion : latestTag;
  if (tagForPublishDate && hasUpdate) {
    try {
      latestPublishDate = await dockerRegistryService.getTagPublishDate(repo, tagForPublishDate);
    } catch (error) {
      // Don't fail the entire update check if publish date fetch fails
      latestPublishDate = null;
    }
  }

  // If current version is "latest" and we found the actual version, update it
  // Also update if current version is not set
  let currentVersionToStore = trackedImage.current_version;
  let currentDigestToStore = trackedImage.current_digest;
  
  // Only update current version if we found a real version (not "latest")
  if (latestVersion && latestVersion !== 'latest') {
    if (!currentVersionToStore || currentVersionToStore === 'latest') {
      currentVersionToStore = latestVersion;
    }
  }
  
  if (!currentDigestToStore && latestDigest) {
    currentDigestToStore = latestDigest;
  }

  // Update the tracked image in database
  // Only update if we successfully got image info
  const updateData = {
    has_update: hasUpdate ? 1 : 0,
    last_checked: new Date().toISOString(),
  };

  // Only update latest_version if we have a valid value (not null, not empty, not "latest" unless we couldn't resolve it)
  if (latestVersion) {
    // Convert to string to ensure proper type
    const versionStr = String(latestVersion).trim();
    if (versionStr !== '' && versionStr !== 'null' && versionStr !== 'undefined') {
      updateData.latest_version = versionStr;
    }
  }
  
  if (latestDigest) {
    // Convert to string to ensure proper type
    const digestStr = String(latestDigest).trim();
    if (digestStr !== '' && digestStr !== 'null' && digestStr !== 'undefined') {
      updateData.latest_digest = digestStr;
    }
  }

  // Update current version/digest if we have better information
  if (currentVersionToStore && currentVersionToStore !== trackedImage.current_version) {
    updateData.current_version = currentVersionToStore;
  }
  if (currentDigestToStore && currentDigestToStore !== trackedImage.current_digest) {
    updateData.current_digest = currentDigestToStore;
  }

  await updateTrackedImage(trackedImage.id, updateData);

  // Use the resolved current version (or fallback to stored/currentTag)
  // Ensure we always return a string, never null/undefined
  const displayCurrentVersion = currentVersionToStore 
    ? String(currentVersionToStore) 
    : (trackedImage.current_version ? String(trackedImage.current_version) : currentTag);
  
  // Use latestVersion if we have it, otherwise use the stored latest_version or currentTag
  // Ensure we return a string, not null/undefined, and prefer actual versions over "latest"
  let displayLatestVersion = currentTag; // Default fallback
  if (latestVersion && latestVersion !== 'latest') {
    displayLatestVersion = String(latestVersion);
  } else if (trackedImage.latest_version && trackedImage.latest_version !== 'latest') {
    displayLatestVersion = String(trackedImage.latest_version);
  } else if (trackedImage.latest_version) {
    displayLatestVersion = String(trackedImage.latest_version);
  }
  
  return {
    id: trackedImage.id,
    name: trackedImage.name,
    imageName: imageName,
    currentVersion: displayCurrentVersion,
    currentDigest: formatDigest(currentDigestToStore || trackedImage.current_digest),
    latestVersion: displayLatestVersion,
    latestDigest: formatDigest(latestDigest || trackedImage.latest_digest),
    hasUpdate: Boolean(hasUpdate), // Ensure boolean, not 0/1
    latestPublishDate: latestPublishDate,
    imageRepo: repo,
  };
}

/**
 * Check for updates on a GitHub tracked image
 * @param {Object} trackedImage - Tracked image object from database
 * @returns {Promise<Object>} - Update information
 */
async function checkGitHubTrackedImage(trackedImage) {
  const githubRepo = trackedImage.github_repo;
  
  let hasUpdate = false;
  let latestVersion = null;
  let latestRelease = null;
  let currentVersionRelease = null;
  let currentVersionPublishDate = null;

  try {
    // Get latest release from GitHub
    latestRelease = await githubService.getLatestRelease(githubRepo);
    
    if (latestRelease && latestRelease.tag_name) {
      latestVersion = latestRelease.tag_name;
      
      // Compare with current version to determine if update is available
      if (trackedImage.current_version) {
        // Simple string comparison - if different, there's an update
        hasUpdate = trackedImage.current_version !== latestVersion;
        
        // Get publish date for current version
        try {
          currentVersionRelease = await githubService.getReleaseByTag(githubRepo, trackedImage.current_version);
          if (currentVersionRelease && currentVersionRelease.published_at) {
            currentVersionPublishDate = currentVersionRelease.published_at;
          }
        } catch (err) {
          // Non-blocking - if we can't get current version release, continue
          console.error(`Error fetching current version release for ${githubRepo}:${trackedImage.current_version}:`, err.message);
        }
      } else {
        // If no current version set, this is the first check - no update yet
        hasUpdate = false;
      }
    }
  } catch (error) {
    // If rate limit exceeded, propagate the error
    if (error.message && error.message.includes('rate limit')) {
      throw new Error(error.message);
    }
    // For other errors, log and continue (will show no update)
    console.error(`Error checking GitHub repo ${githubRepo}:`, error.message);
    latestVersion = null;
  }

  // Update the tracked image in database
  const updateData = {
    has_update: hasUpdate ? 1 : 0,
    last_checked: new Date().toISOString(),
  };

  // Only update latest_version if we have a valid value
  if (latestVersion) {
    const versionStr = String(latestVersion).trim();
    if (versionStr !== '' && versionStr !== 'null' && versionStr !== 'undefined') {
      updateData.latest_version = versionStr;
    }
  }

  // Update current version if we don't have one yet
  let currentVersionToStore = trackedImage.current_version;
  if (!currentVersionToStore && latestVersion) {
    currentVersionToStore = latestVersion;
    updateData.current_version = latestVersion;
  }

  // Store current version publish date if we have it
  if (currentVersionPublishDate) {
    updateData.current_version_publish_date = currentVersionPublishDate;
  }

  await updateTrackedImage(trackedImage.id, updateData);

  // Format display values
  const displayCurrentVersion = currentVersionToStore 
    ? String(currentVersionToStore) 
    : (trackedImage.current_version ? String(trackedImage.current_version) : 'Not checked');
  
  const displayLatestVersion = latestVersion 
    ? String(latestVersion) 
    : (trackedImage.latest_version ? String(trackedImage.latest_version) : 'Unknown');

  return {
    id: trackedImage.id,
    name: trackedImage.name,
    imageName: null,
    githubRepo: githubRepo,
    sourceType: 'github',
    currentVersion: displayCurrentVersion,
    currentDigest: null,
    latestVersion: displayLatestVersion,
    latestDigest: null,
    hasUpdate: Boolean(hasUpdate),
    latestPublishDate: latestRelease?.published_at || null,
    currentVersionPublishDate: currentVersionPublishDate,
    releaseUrl: latestRelease?.html_url || null,
  };
}

/**
 * Check for updates on all tracked images
 * @param {Array} trackedImages - Array of tracked image objects
 * @returns {Promise<Array>} - Array of update information
 */
async function checkAllTrackedImages(trackedImages) {
  const results = [];
  
  for (const image of trackedImages) {
    try {
      const result = await checkTrackedImage(image);
      results.push(result);
    } catch (error) {
      // If rate limit exceeded, stop processing and propagate error
      if (error.isRateLimitExceeded) {
        throw error;
      }
      // For other errors, log and continue with other images
      console.error(`Error checking tracked image ${image.name}:`, error.message);
      results.push({
        id: image.id,
        name: image.name,
        imageName: image.image_name,
        error: error.message,
      });
    }
  }
  
  return results;
}

module.exports = {
  checkTrackedImage,
  checkAllTrackedImages,
};


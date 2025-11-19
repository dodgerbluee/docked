/**
 * User Import Parsers
 * Utility functions for parsing and validating user import JSON files
 */

/**
 * Parse and normalize user import JSON data
 * Supports multiple formats:
 * 1. { users: [...] } - array of users
 * 2. Export format with user object
 * 3. Direct array of users
 */
export function parseUserImportFile(fileContent) {
  try {
    const jsonData = JSON.parse(fileContent);

    // Support both formats:
    // 1. { users: [...] } - array of users (may have nested user object)
    // 2. Export format with user object (convert to array)
    let usersArray = null;

    if (jsonData.users && Array.isArray(jsonData.users)) {
      // Normalize the users array - handle both flat and nested user structures
      usersArray = jsonData.users.map((userItem) => {
        // If the item has a nested 'user' property (export format), extract and merge it
        if (userItem.user && typeof userItem.user === "object") {
          return {
            ...userItem.user, // Spread user properties (username, email, role, etc.)
            ...userItem, // Spread top-level properties (portainerInstances, etc.)
            // Override with nested user properties to ensure they take precedence
            username: userItem.user.username,
            email: userItem.user.email,
            role: userItem.user.role,
            instanceAdmin:
              userItem.user.instance_admin !== undefined
                ? userItem.user.instance_admin
                : userItem.user.instanceAdmin !== undefined
                  ? userItem.user.instanceAdmin
                  : false,
            instance_admin: userItem.user.instance_admin,
          };
        }
        // Otherwise, use the item as-is (flat structure)
        return userItem;
      });
    } else if (jsonData.user && typeof jsonData.user === "object") {
      // Convert single user export format to array
      // Merge top-level properties (portainerInstances, dockerHubCredentials, discordWebhooks, trackedImages) into user object
      const userWithConfig = {
        ...jsonData.user,
        portainerInstances: jsonData.portainerInstances || jsonData.user.portainerInstances,
        dockerHubCredentials: jsonData.dockerHubCredentials || jsonData.user.dockerHubCredentials,
        discordWebhooks: jsonData.discordWebhooks || jsonData.user.discordWebhooks,
        trackedImages: jsonData.trackedImages || jsonData.user.trackedImages,
      };
      usersArray = [userWithConfig];
    } else if (Array.isArray(jsonData)) {
      usersArray = jsonData;
    } else {
      return {
        success: false,
        error: "Invalid JSON format. Expected { users: [...] } or export format with user object",
        data: null,
      };
    }

    // Validate each user has required fields
    for (const user of usersArray) {
      if (!user.username) {
        return {
          success: false,
          error: "Each user must have a 'username' field",
          data: null,
        };
      }
    }

    // Identify instance admin users for summary display
    const instanceAdminUsers = usersArray.filter((user) => {
      const instanceAdmin =
        user.instanceAdmin !== undefined
          ? user.instanceAdmin
          : user.instance_admin === true || user.instance_admin === 1;
      return instanceAdmin;
    });

    return {
      success: true,
      data: {
        users: usersArray,
        instanceAdminUsers: instanceAdminUsers.map((u) => ({ username: u.username })),
      },
    };
  } catch (parseError) {
    return {
      success: false,
      error: `Invalid JSON: ${parseError.message}`,
      data: null,
    };
  }
}

/**
 * Check if a user is an instance admin
 */
export function isInstanceAdmin(user) {
  return user.instanceAdmin !== undefined
    ? user.instanceAdmin
    : user.instance_admin === true || user.instance_admin === 1;
}

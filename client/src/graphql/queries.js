// GraphQL documents as plain strings (urql v4 parses them directly)

// --- Queries ---

export const ME_QUERY = /* GraphQL */ `
  query Me {
    me {
      id
      username
      role
      passwordChanged
      createdAt
      updatedAt
    }
  }
`;

export const USER_PREFERENCES_QUERY = /* GraphQL */ `
  query UserPreferences {
    userPreferences {
      colorScheme
      disablePortainerPage
      disableTrackedAppsPage
      refreshingTogglesEnabled
    }
  }
`;

export const SUMMARY_STATS_QUERY = /* GraphQL */ `
  query SummaryStats {
    summaryStats {
      totalContainers
      totalSources
      totalRunners
      totalTrackedApps
    }
  }
`;

// --- Mutations ---

export const UPDATE_USER_PREFERENCES_MUTATION = /* GraphQL */ `
  mutation UpdateUserPreferences($input: UpdateUserPreferencesInput!) {
    updateUserPreferences(input: $input) {
      success
      message
    }
  }
`;

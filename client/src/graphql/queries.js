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

export const RUNNERS_QUERY = /* GraphQL */ `
  query Runners {
    runners {
      id
      name
      url
      enabled
      version
      latestVersion
      versionCheckedAt
      dockerEnabled
      lastHeartbeat
      healthStatus
      dockerStatusSince
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_RUNNER_MUTATION = /* GraphQL */ `
  mutation UpdateRunner($id: ID!, $input: UpdateRunnerInput!) {
    updateRunner(id: $id, input: $input) {
      id
      name
      url
      enabled
    }
  }
`;

export const DELETE_RUNNER_MUTATION = /* GraphQL */ `
  mutation DeleteRunner($id: ID!) {
    deleteRunner(id: $id) {
      success
      message
    }
  }
`;

export const USERS_QUERY = /* GraphQL */ `
  query Users {
    users {
      id
      username
      role
      instanceAdmin
      email
      lastLogin
      createdAt
      updatedAt
    }
  }
`;

export const SET_USER_ROLE_MUTATION = /* GraphQL */ `
  mutation SetUserRole($userId: ID!, $role: Role!) {
    setUserRole(userId: $userId, role: $role) {
      success
      message
    }
  }
`;

export const SET_USER_PASSWORD_MUTATION = /* GraphQL */ `
  mutation SetUserPassword($userId: ID!, $newPassword: String!) {
    setUserPassword(userId: $userId, newPassword: $newPassword) {
      success
      message
    }
  }
`;

export const UPDATE_USERNAME_MUTATION = /* GraphQL */ `
  mutation UpdateUsername($input: UpdateUsernameInput!) {
    updateUsername(input: $input) {
      success
      message
      username
      token
      refreshToken
    }
  }
`;

export const UPDATE_PASSWORD_MUTATION = /* GraphQL */ `
  mutation UpdatePassword($input: UpdatePasswordInput!) {
    updatePassword(input: $input) {
      success
      message
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

export const CONTAINERS_QUERY = /* GraphQL */ `
  query Containers {
    containerGroup {
      standalone {
        items {
          id
          dockerContainerId
          name
          imageName
          imageRepo
          status
          state
          stackName
          endpointId
          currentDigest
          usesNetworkMode
          providesNetwork
          lastSeen
          createdAt
          source {
            ... on SourceInstance {
              id
              name
              url
              type
            }
            ... on Runner {
              id
              name
              url
              type
            }
          }
          imageInfo {
            registry
            namespace
            repository
            currentTag
            currentVersion
            currentDigest
            latestTag
            latestVersion
            latestDigest
            hasUpdate
            latestPublishDate
            lastChecked
          }
        }
        totalCount
      }
      stacks {
        id
        name
        endpointId
        source {
          ... on SourceInstance {
            id
            name
            type
          }
          ... on Runner {
            id
            name
            type
          }
        }
        containers {
          items {
            id
            dockerContainerId
            name
            imageName
            imageRepo
            status
            state
            stackName
            endpointId
            currentDigest
            usesNetworkMode
            providesNetwork
            lastSeen
            createdAt
            imageInfo {
              registry
              namespace
              repository
              currentTag
              currentVersion
              currentDigest
              latestTag
              latestVersion
              latestDigest
              hasUpdate
              latestPublishDate
              lastChecked
            }
          }
          totalCount
        }
      }
      sources {
        id
        name
        url
        type
      }
      runners {
        id
        name
        url
        type
        enabled
        version
        dockerEnabled
        lastHeartbeat
        healthStatus
      }
      stats {
        totalContainers
        containersWithUpdates
        totalSources
        totalRunners
        totalTrackedApps
        trackedAppsWithUpdates
        unusedImagesCount
      }
      unusedImagesCount
    }
  }
`;

export const SOURCE_INSTANCES_QUERY = /* GraphQL */ `
  query SourceInstances {
    sourceInstances {
      id
      name
      url
      type
      authType
      ipAddress
      displayOrder
      createdAt
      updatedAt
      hasApiKey
      hasPassword
    }
  }
`;

export const TRACKED_APPS_QUERY = /* GraphQL */ `
  query TrackedApps {
    trackedApps {
      id
      name
      imageName
      githubRepo
      sourceType
      currentVersion
      currentDigest
      latestVersion
      latestDigest
      hasUpdate
      lastChecked
      createdAt
      updatedAt
    }
  }
`;

export const INTENTS_QUERY = /* GraphQL */ `
  query Intents {
    intents {
      id
      name
      description
      enabled
      matchContainers
      matchImages
      matchSources
      matchStacks
      matchRegistries
      excludeContainers
      excludeImages
      excludeStacks
      excludeRegistries
      scheduleType
      scheduleCron
      scheduleTimezone
      maxConcurrent
      dryRun
      sequentialDelaySec
      lastEvaluatedAt
      createdAt
      updatedAt
    }
  }
`;

export const DISCORD_WEBHOOKS_QUERY = /* GraphQL */ `
  query DiscordWebhooks {
    discordWebhooks {
      id
      maskedUrl
      serverName
      channelName
      enabled
      avatarUrl
      guildId
      channelId
      createdAt
      updatedAt
    }
  }
`;

export const BATCH_CONFIGS_QUERY = /* GraphQL */ `
  query BatchConfigs {
    batchConfigs {
      jobType
      enabled
      intervalMinutes
    }
  }
`;

export const BATCH_RUNS_QUERY = /* GraphQL */ `
  query BatchRuns($jobType: BatchJobType, $first: Int, $after: String) {
    batchRuns(jobType: $jobType, first: $first, after: $after) {
      items {
        id
        jobType
        status
        queuedAt
        startedAt
        completedAt
        durationMs
        containersChecked
        containersUpdated
        errorMessage
        logs
        isManual
      }
      totalCount
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export const UPGRADE_HISTORY_QUERY = /* GraphQL */ `
  query UpgradeHistory($first: Int, $after: String, $filter: UpgradeHistoryFilterInput) {
    upgradeHistory(first: $first, after: $after, filter: $filter) {
      items {
        id
        dockerContainerId
        containerName
        endpointId
        oldImage
        newImage
        oldDigest
        newDigest
        oldVersion
        newVersion
        imageRepo
        registry
        namespace
        repository
        status
        errorMessage
        upgradeDurationMs
        intentId
        performedBy {
          id
          username
        }
        createdAt
        source {
          ... on SourceInstance {
            id
            name
            url
            type
          }
          ... on Runner {
            id
            name
            url
            type
          }
        }
      }
      totalCount
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export const UNUSED_IMAGES_QUERY = /* GraphQL */ `
  query UnusedImages {
    unusedImages {
      id
      repoTags
      sizeBytes
      created
      sourceUrl
      endpointId
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

export const CREATE_SOURCE_INSTANCE_MUTATION = /* GraphQL */ `
  mutation CreateSourceInstance($input: CreateSourceInstanceInput!) {
    createSourceInstance(input: $input) {
      id
      name
      url
      type
      authType
      ipAddress
      displayOrder
      createdAt
      updatedAt
      hasApiKey
      hasPassword
    }
  }
`;

export const UPDATE_SOURCE_INSTANCE_MUTATION = /* GraphQL */ `
  mutation UpdateSourceInstance($id: ID!, $input: UpdateSourceInstanceInput!) {
    updateSourceInstance(id: $id, input: $input) {
      id
      name
      url
      type
      authType
      ipAddress
      displayOrder
      createdAt
      updatedAt
      hasApiKey
      hasPassword
    }
  }
`;

export const DELETE_SOURCE_INSTANCE_MUTATION = /* GraphQL */ `
  mutation DeleteSourceInstance($id: ID!) {
    deleteSourceInstance(id: $id) {
      success
      message
    }
  }
`;

export const CREATE_TRACKED_APP_MUTATION = /* GraphQL */ `
  mutation CreateTrackedApp($input: CreateTrackedAppInput!) {
    createTrackedApp(input: $input) {
      id
      name
      imageName
      githubRepo
      sourceType
      currentVersion
      latestVersion
      hasUpdate
      lastChecked
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_TRACKED_APP_MUTATION = /* GraphQL */ `
  mutation UpdateTrackedApp($id: ID!, $input: UpdateTrackedAppInput!) {
    updateTrackedApp(id: $id, input: $input) {
      id
      name
      imageName
      githubRepo
      sourceType
      currentVersion
      latestVersion
      hasUpdate
      lastChecked
      createdAt
      updatedAt
    }
  }
`;

export const DELETE_TRACKED_APP_MUTATION = /* GraphQL */ `
  mutation DeleteTrackedApp($id: ID!) {
    deleteTrackedApp(id: $id) {
      success
      message
    }
  }
`;

export const CREATE_INTENT_MUTATION = /* GraphQL */ `
  mutation CreateIntent($input: CreateIntentInput!) {
    createIntent(input: $input) {
      id
      name
      description
      enabled
      matchContainers
      matchImages
      matchSources
      matchStacks
      matchRegistries
      excludeContainers
      excludeImages
      excludeStacks
      excludeRegistries
      scheduleType
      scheduleCron
      scheduleTimezone
      maxConcurrent
      dryRun
      sequentialDelaySec
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_INTENT_MUTATION = /* GraphQL */ `
  mutation UpdateIntent($id: ID!, $input: UpdateIntentInput!) {
    updateIntent(id: $id, input: $input) {
      id
      name
      description
      enabled
      matchContainers
      matchImages
      matchSources
      matchStacks
      matchRegistries
      excludeContainers
      excludeImages
      excludeStacks
      excludeRegistries
      scheduleType
      scheduleCron
      scheduleTimezone
      maxConcurrent
      dryRun
      sequentialDelaySec
      createdAt
      updatedAt
    }
  }
`;

export const DELETE_INTENT_MUTATION = /* GraphQL */ `
  mutation DeleteIntent($id: ID!) {
    deleteIntent(id: $id) {
      success
      message
    }
  }
`;

export const CREATE_DISCORD_WEBHOOK_MUTATION = /* GraphQL */ `
  mutation CreateDiscordWebhook($input: CreateDiscordWebhookInput!) {
    createDiscordWebhook(input: $input) {
      id
      maskedUrl
      serverName
      channelName
      enabled
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_DISCORD_WEBHOOK_MUTATION = /* GraphQL */ `
  mutation UpdateDiscordWebhook($id: ID!, $input: UpdateDiscordWebhookInput!) {
    updateDiscordWebhook(id: $id, input: $input) {
      id
      maskedUrl
      serverName
      channelName
      enabled
      createdAt
      updatedAt
    }
  }
`;

export const DELETE_DISCORD_WEBHOOK_MUTATION = /* GraphQL */ `
  mutation DeleteDiscordWebhook($id: ID!) {
    deleteDiscordWebhook(id: $id) {
      success
      message
    }
  }
`;

export const TEST_DISCORD_WEBHOOK_MUTATION = /* GraphQL */ `
  mutation TestDiscordWebhook($id: ID!) {
    testDiscordWebhook(id: $id) {
      success
      message
    }
  }
`;

export const TEST_DISCORD_WEBHOOK_URL_MUTATION = /* GraphQL */ `
  mutation TestDiscordWebhookUrl($webhookUrl: String!) {
    testDiscordWebhookUrl(webhookUrl: $webhookUrl) {
      success
      message
    }
  }
`;

export const DISCORD_WEBHOOK_INFO_QUERY = /* GraphQL */ `
  query DiscordWebhookInfo($webhookUrl: String!) {
    discordWebhookInfo(webhookUrl: $webhookUrl) {
      name
      channelId
      guildId
      avatar
    }
  }
`;

export const BATCH_LOG_LEVEL_QUERY = /* GraphQL */ `
  query BatchLogLevel {
    batchLogLevel
  }
`;

export const SET_BATCH_LOG_LEVEL_MUTATION = /* GraphQL */ `
  mutation SetBatchLogLevel($logLevel: LogLevel!) {
    setBatchLogLevel(logLevel: $logLevel) {
      success
      message
    }
  }
`;

export const CREATE_BATCH_RUN_MUTATION = /* GraphQL */ `
  mutation CreateBatchRun($jobType: BatchJobType, $isManual: Boolean) {
    createBatchRun(jobType: $jobType, isManual: $isManual) {
      id
      status
      jobType
    }
  }
`;

export const UPDATE_BATCH_RUN_MUTATION = /* GraphQL */ `
  mutation UpdateBatchRun(
    $id: ID!
    $status: BatchRunStatus!
    $containersChecked: Int
    $containersUpdated: Int
    $errorMessage: String
    $logs: String
  ) {
    updateBatchRun(
      id: $id
      status: $status
      containersChecked: $containersChecked
      containersUpdated: $containersUpdated
      errorMessage: $errorMessage
      logs: $logs
    ) {
      success
      message
    }
  }
`;

export const UPDATE_BATCH_CONFIG_MUTATION = /* GraphQL */ `
  mutation UpdateBatchConfig($input: UpdateBatchConfigInput!) {
    updateBatchConfig(input: $input) {
      success
      message
    }
  }
`;

export const TRIGGER_BATCH_JOB_MUTATION = /* GraphQL */ `
  mutation TriggerBatchJob($jobType: BatchJobType, $idempotencyKey: String) {
    triggerBatchJob(jobType: $jobType, idempotencyKey: $idempotencyKey) {
      id
      jobType
      status
      startedAt
      isManual
    }
  }
`;

export const PULL_CONTAINERS_MUTATION = /* GraphQL */ `
  mutation PullContainers($sourceInstanceId: ID, $runnerId: ID) {
    pullContainers(sourceInstanceId: $sourceInstanceId, runnerId: $runnerId) {
      id
      type
      status
      message
      queuedAt
    }
  }
`;

export const UPGRADE_CONTAINER_MUTATION = /* GraphQL */ `
  mutation UpgradeContainer($input: UpgradeContainerInput!) {
    upgradeContainer(input: $input) {
      id
      type
      status
      message
      queuedAt
    }
  }
`;

export const DELETE_IMAGES_MUTATION = /* GraphQL */ `
  mutation DeleteImages($images: [DeleteImageInput!]!) {
    deleteImages(images: $images) {
      success
      deleted
      failed
      results {
        imageId
        success
      }
    }
  }
`;

export const LOGIN_MUTATION = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      token
      refreshToken
      user {
        id
        username
        role
        passwordChanged
      }
    }
  }
`;

export const REGISTER_MUTATION = /* GraphQL */ `
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      token
      refreshToken
      user {
        id
        username
        role
        passwordChanged
      }
    }
  }
`;

export const REFRESH_TOKEN_MUTATION = /* GraphQL */ `
  mutation RefreshToken($input: RefreshTokenInput!) {
    refreshToken(input: $input) {
      token
      refreshToken
      user {
        id
        username
        role
      }
    }
  }
`;

export const LOGOUT_MUTATION = /* GraphQL */ `
  mutation Logout {
    logout {
      success
      message
    }
  }
`;

export const TRIGGER_INTENT_MUTATION = /* GraphQL */ `
  mutation TriggerIntent($id: ID!) {
    triggerIntent(id: $id) {
      id
      intentId
      status
      triggerType
      containersMatched
      containersUpgraded
      containersFailed
      containersSkipped
      errorMessage
      queuedAt
      startedAt
      completedAt
      durationMs
    }
  }
`;

export const INTENT_EXECUTIONS_QUERY = /* GraphQL */ `
  query IntentExecutions($intentId: ID, $first: Int) {
    intentExecutions(intentId: $intentId, first: $first) {
      items {
        id
        intentId
        status
        triggerType
        containersMatched
        containersUpgraded
        containersFailed
        containersSkipped
        errorMessage
        queuedAt
        startedAt
        completedAt
        durationMs
        intent {
          name
        }
      }
      totalCount
    }
  }
`;

export const INTENT_EXECUTION_QUERY = /* GraphQL */ `
  query IntentExecution($id: ID!) {
    intentExecution(id: $id) {
      id
      intentId
      status
      triggerType
      containersMatched
      containersUpgraded
      containersFailed
      containersSkipped
      errorMessage
      queuedAt
      startedAt
      completedAt
      durationMs
      intent {
        name
      }
      containers {
        items {
          id
          executionId
          dockerContainerId
          containerName
          imageName
          sourceInstanceId
          runnerId
          status
          oldImage
          newImage
          oldDigest
          newDigest
          errorMessage
          durationMs
          createdAt
        }
      }
    }
  }
`;

export const DRY_RUN_INTENT_MUTATION = /* GraphQL */ `
  mutation DryRunIntent($id: ID!) {
    dryRunIntent(id: $id) {
      id
      intentId
      status
      containersMatched
      containersUpgraded
      containersFailed
      containersSkipped
      startedAt
      completedAt
      durationMs
    }
  }
`;

export const LOGS_QUERY = /* GraphQL */ `
  query Logs($lines: Int, $offset: Int) {
    logs(lines: $lines, offset: $offset) {
      logs
      fileSize
      rotated
    }
  }
`;

export const UPLOAD_AVATAR_MUTATION = /* GraphQL */ `
  mutation UploadAvatar($file: Upload!) {
    uploadAvatar(file: $file) {
      success
      message
    }
  }
`;

export const DELETE_AVATAR_MUTATION = /* GraphQL */ `
  mutation DeleteAvatar {
    deleteAvatar {
      success
      message
    }
  }
`;

export const REPOSITORY_TOKENS_QUERY = /* GraphQL */ `
  query RepositoryTokens {
    repositoryTokens {
      id
      provider
      maskedToken
      createdAt
      updatedAt
    }
  }
`;

export const SAVE_REPOSITORY_TOKEN_MUTATION = /* GraphQL */ `
  mutation SaveRepositoryToken($input: CreateRepositoryTokenInput!) {
    saveRepositoryToken(input: $input) {
      id
      provider
      maskedToken
    }
  }
`;

export const DELETE_REPOSITORY_TOKEN_MUTATION = /* GraphQL */ `
  mutation DeleteRepositoryToken($id: ID!) {
    deleteRepositoryToken(id: $id) {
      success
      message
    }
  }
`;

export const VERSION_QUERY = /* GraphQL */ `
  query AppVersion {
    version {
      version
      environment
      isDevBuild
    }
  }
`;

export const LATEST_RELEASE_QUERY = /* GraphQL */ `
  query LatestRelease {
    latestRelease {
      tagName
      publishedAt
      htmlUrl
    }
  }
`;

export const CHECK_TRACKED_APP_UPDATE_MUTATION = /* GraphQL */ `
  mutation CheckTrackedAppUpdate($id: ID!) {
    checkTrackedAppUpdate(id: $id) {
      success
      hasUpdate
      currentVersion
      latestVersion
    }
  }
`;

export const CHECK_TRACKED_APP_UPDATES_MUTATION = /* GraphQL */ `
  mutation CheckTrackedAppUpdates {
    checkTrackedAppUpdates {
      success
      checked
      updated
    }
  }
`;

export const CLEAR_TRACKED_APP_CACHE_MUTATION = /* GraphQL */ `
  mutation ClearTrackedAppCache {
    clearTrackedAppCache {
      success
      message
    }
  }
`;

export const VALIDATE_SOURCE_CREDENTIALS_MUTATION = /* GraphQL */ `
  mutation ValidateSourceCredentials($input: ValidateSourceCredentialsInput!) {
    validateSourceCredentials(input: $input) {
      valid
      message
      errorCode
    }
  }
`;

export const REORDER_SOURCE_INSTANCES_MUTATION = /* GraphQL */ `
  mutation ReorderSourceInstances($instances: [ReorderSourceInput!]!) {
    reorderSourceInstances(instances: $instances) {
      success
      message
    }
  }
`;

export const CHECK_SOURCE_INSTANCE_HEALTH_MUTATION = /* GraphQL */ `
  mutation CheckSourceInstanceHealth($id: ID!) {
    checkSourceInstanceHealth(id: $id) {
      online
      message
    }
  }
`;

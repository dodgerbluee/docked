# Registry Service

A unified, extensible registry abstraction layer for container image management with automatic provider selection, fallback strategies, and comprehensive error handling.

## Architecture

The registry service provides a clean abstraction over multiple container registries (Docker Hub, GHCR, GitLab, etc.) with the following components:

### Core Components

1. **RegistryProvider** (`RegistryProvider.js`)
   - Abstract base class defining the interface for all registry providers
   - Ensures consistent behavior across different registries
   - Handles authentication, rate limiting, and error transformation

2. **RegistryManager** (`RegistryManager.js`)
   - Centralized manager for all registry operations
   - Automatic provider selection based on image repository
   - Implements fallback strategy: Primary Registry → GitHub Releases → Cached Data
   - Singleton pattern for efficient resource usage

3. **Providers** (`providers/`)
   - **DockerHubProvider**: Docker Hub Registry API v2
   - **GHCRProvider**: GitHub Container Registry API v2
   - **GitLabProvider**: GitLab Container Registry API v2
   - **GitHubReleasesProvider**: GitHub Releases API (fallback provider)

4. **Public API** (`index.js`)
   - Clean, unified interface for all registry operations
   - Hides implementation details from consumers

## Features

### Automatic Provider Selection

The service automatically detects which provider to use based on the image repository:

```javascript
const registryService = require("./services/registry");

// Docker Hub (automatic detection)
await registryService.getLatestDigest("nginx", "latest");

// GHCR (automatic detection)
await registryService.getLatestDigest("ghcr.io/owner/repo", "latest");

// GitLab (automatic detection)
await registryService.getLatestDigest("registry.gitlab.com/group/project", "latest");
```

### Fallback Strategy

When the primary registry API fails or is rate limited, the service automatically falls back to GitHub Releases API (if a GitHub repo mapping is available):

```javascript
// Primary: Try Docker Hub/GHCR/GitLab Registry API
// Fallback: Try GitHub Releases API (if githubRepo provided)
const result = await registryService.getLatestDigest("my-image", "latest", {
  userId: 123,
  githubRepo: "owner/repo", // Enables GitHub Releases fallback
  useFallback: true, // Default: true
});
```

### Rate Limit Handling

All providers implement intelligent rate limiting:

- **Docker Hub**: 200 requests/6 hours (anonymous), 5,000/6 hours (authenticated)
- **GHCR**: 5,000 requests/hour (with GitHub token)
- **GitLab**: Varies by plan
- **GitHub Releases**: 5,000 requests/hour (with token)

The service automatically:

- Adds delays between requests
- Detects rate limit errors (429)
- Falls back to alternative providers when rate limited
- Uses authentication when available for higher limits

### Caching

Aggressive caching reduces API calls:

- Digest lookups: 24 hours TTL
- Publish dates: 24 hours TTL
- Provider selection: In-memory cache

## Usage

### Basic Usage

```javascript
const registryService = require("./services/registry");

// Get latest digest
const latestInfo = await registryService.getLatestDigest("nginx", "latest", {
  userId: 123, // Optional: for authenticated requests
});

if (latestInfo) {
  console.log(`Latest digest: ${latestInfo.digest}`);
  console.log(`Latest tag: ${latestInfo.tag}`);
  console.log(`Provider: ${latestInfo.provider}`);
  console.log(`Is fallback: ${latestInfo.isFallback}`);
}
```

### Check for Updates

```javascript
const currentDigest = "sha256:abc123...";
const currentTag = "1.0.0";
const latestInfo = await registryService.getLatestDigest("my-image", currentTag);

const hasUpdate = registryService.hasUpdate(currentDigest, currentTag, latestInfo);
```

### Get Publish Date

```javascript
const publishDate = await registryService.getTagPublishDate("nginx", "latest", {
  userId: 123,
  githubRepo: "nginx/nginx", // Optional: for GitHub Releases fallback
});
```

### Check if Image Exists

```javascript
const exists = await registryService.imageExists("my-image", {
  userId: 123,
});
```

## Adding a New Provider

To add support for a new registry:

1. Create a new provider class extending `RegistryProvider`:

```javascript
const RegistryProvider = require("../RegistryProvider");

class MyRegistryProvider extends RegistryProvider {
  getName() {
    return "myregistry";
  }

  canHandle(imageRepo) {
    return imageRepo.startsWith("myregistry.io/");
  }

  async getLatestDigest(imageRepo, tag, options) {
    // Implementation
  }

  // ... implement other required methods
}

module.exports = MyRegistryProvider;
```

2. Register the provider in `RegistryManager.js`:

```javascript
const MyRegistryProvider = require("./providers/MyRegistryProvider");

constructor() {
  this.providers = [
    new DockerHubProvider(),
    new GHCRProvider(),
    new GitLabProvider(),
    new MyRegistryProvider(), // Add here
  ];
}
```

## Error Handling

The service provides comprehensive error handling:

- **Rate Limit Errors**: Automatically detected and handled with fallback
- **Network Errors**: Retried with exponential backoff
- **Authentication Errors**: Logged and gracefully handled
- **404 Errors**: Silently handled (image not found)

All errors are transformed through `handleError()` for consistent error objects.

## Performance Considerations

1. **Caching**: Aggressive caching reduces API calls
2. **Provider Caching**: Provider selection is cached per image repo
3. **Lazy Loading**: Providers are instantiated only when needed
4. **Batch Operations**: Consider batching multiple lookups

## Configuration

### Environment Variables

- `GITHUB_TOKEN`: GitHub token for GHCR and GitHub Releases API (higher rate limits)
- `GITLAB_TOKEN`: GitLab token for GitLab Container Registry
- Docker Hub credentials: Managed through Settings UI (stored in database)

### Cache Configuration

Cache TTL is configured in `server/config/index.js`:

```javascript
cache: {
  digestCacheTTL: 24 * 60 * 60 * 1000, // 24 hours
}
```

## Testing

```javascript
// Clear all caches (useful for testing)
registryService.clearAllCaches();

// Clear cache for specific image
registryService.clearCache("nginx", "latest");
```

## Migration Guide

### From `dockerRegistryService`

**Before:**

```javascript
const dockerRegistryService = require("./dockerRegistryService");
const result = await dockerRegistryService.getLatestImageDigest("nginx", "latest", userId);
```

**After:**

```javascript
const registryService = require("./services/registry");
const result = await registryService.getLatestDigest("nginx", "latest", { userId });
```

### Benefits

1. **Multi-registry support**: Works with Docker Hub, GHCR, GitLab, and more
2. **Automatic fallback**: Falls back to GitHub Releases when registry APIs fail
3. **Better rate limit handling**: Intelligent delays and fallback strategies
4. **Consistent API**: Same interface for all registries
5. **Extensible**: Easy to add new registries

## Best Practices

1. **Always provide `userId`** when available for authenticated requests (higher rate limits)
2. **Provide `githubRepo`** when known to enable GitHub Releases fallback
3. **Handle rate limit errors** gracefully in your application
4. **Use caching** - the service caches aggressively, but you can also cache results
5. **Monitor provider usage** - check `result.provider` and `result.isFallback` for insights

## Troubleshooting

### Rate Limit Errors

If you're hitting rate limits:

1. Configure authentication (Docker Hub credentials, GitHub token, etc.)
2. Reduce request frequency
3. Enable fallback (GitHub Releases) for known repos

### Provider Not Found

If a provider isn't found:

1. Check if the image repo format is correct
2. Verify the provider is registered in `RegistryManager`
3. Check provider's `canHandle()` method

### Fallback Not Working

If fallback isn't working:

1. Ensure `githubRepo` is provided in options
2. Verify `useFallback: true` (default)
3. Check if GitHub Releases API is accessible

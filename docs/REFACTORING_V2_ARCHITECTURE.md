# V2 Architecture Refactoring

## Overview

This document describes the refactored architecture for container update detection, which addresses multi-architecture image handling and follows production-grade separation of concerns.

## Problem Statement

### Issues with Previous Implementation

1. **Architecture-Blind Comparisons**: Compared digests without considering the container's actual platform (OS/arch/variant)
2. **Tag-Based Logic**: Mixed tag comparisons with digest comparisons, leading to false positives
3. **Scattered Responsibilities**: Logic spread across multiple services without clear boundaries
4. **Multi-Arch False Positives**: For images like `postgres:15`, different architectures have different digests, causing perpetual "update available" states
5. **External Dependencies**: Relied on `crane`/`skopeo` which aren't available on all platforms

## New Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    API / Batch Layer                         │
│  Entry points: imageUpdateServiceV2, DockerHubPullHandlerV2 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              UpdateComparisonService                         │
│  Orchestrates: Portainer → ImageResolver → Registry         │
│  Performs: Digest-based comparison (platform-specific)      │
└─────────────────────────────────────────────────────────────┘
         ↓                    ↓                    ↓
┌──────────────────┐ ┌──────────────┐  ┌──────────────────────┐
│ PortainerClient  │ │ImageResolver │  │   RegistryClient     │
│                  │ │              │  │                      │
│ Single source of │ │ Normalizes   │  │ OCI-compliant        │
│ truth for:       │ │ image refs   │  │ Multi-arch aware     │
│ - Containers     │ │              │  │ Platform-specific    │
│ - ImageID        │ │ Extracts     │  │ digest selection     │
│ - Platform       │ │ running      │  │                      │
│   (OS/arch)      │ │ digest       │  │ Direct HTTP queries  │
│ - RepoDigests    │ │              │  │ (no CLI tools)       │
└──────────────────┘ └──────────────┘  └──────────────────────┘
```

## Core Components

### 1. PortainerClient (`server/clients/PortainerClient.js`)

**Responsibility**: Single source of truth for container metadata

**Key Methods**:
- `getEndpoints()` - List Docker environments
- `getContainers(endpointId)` - List containers
- `getContainerDetails(endpointId, containerId)` - Full container inspect
- `getImageDetails(endpointId, imageId)` - Image metadata including platform
- `extractContainerMetadata(endpointId, container)` - Normalized metadata object

**Why**: Portainer is the authoritative source for what's actually running. We query it once and extract all needed data upfront.

### 2. RegistryClient (`server/clients/RegistryClient.js`)

**Responsibility**: Query OCI registries for platform-specific digests

**Key Methods**:
- `parseImageReference(imageRef)` - Normalize to canonical form
- `getPlatformSpecificDigest(imageRef, platform)` - Core multi-arch logic
- `hasUpdate(runningDigest, registryDigest)` - Pure comparison

**Multi-Arch Handling**:
```javascript
// When registry returns a manifest list:
{
  "manifests": [
    {
      "digest": "sha256:abc123...",  // linux/amd64
      "platform": {"os": "linux", "architecture": "amd64"}
    },
    {
      "digest": "sha256:def456...",  // linux/arm64
      "platform": {"os": "linux", "architecture": "arm64"}
    }
  ]
}

// We select the digest matching container's platform, not the manifest list digest
```

**Why**: Docker Registry v2 API is standard across all OCI registries. Direct HTTP queries work without external tools.

### 3. ImageResolver (`server/services/ImageResolver.js`)

**Responsibility**: Extract running digest from Portainer metadata

**Key Methods**:
- `extractRunningDigest(repoDigests, imageReference)` - Find correct digest
- `validateContainerMetadata(metadata)` - Ensure we have required data
- `isDigestPinned(imageReference)` - Detect immutable images

**Why**: `RepoDigests` array can contain multiple entries. We must match the one corresponding to the image reference the container is using.

### 4. UpdateComparisonService (`server/services/UpdateComparisonService.js`)

**Responsibility**: Orchestrate comparison

**Flow**:
1. Get container metadata from Portainer (includes platform)
2. Extract running digest from RepoDigests
3. Query registry for platform-specific digest
4. Compare: `runningDigest !== registryDigest`

**Result Object**:
```javascript
{
  containerName: "postgres_db",
  imageReference: "postgres:15",
  platform: {os: "linux", architecture: "amd64", variant: null},
  runningDigest: "sha256:abc123...",   // What's running
  registryDigest: "sha256:abc123...",  // What's in registry (same platform)
  hasUpdate: false,                     // Digests match = no update
  isManifestList: true,
  error: null
}
```

## Migration Strategy

### Phase 1: Parallel Implementation (Current)

- Old code remains unchanged
- New components are separate files
- Use environment variable to enable V2:

```bash
USE_V2_UPDATE_LOGIC=true node server/server.js
```

### Phase 2: Gradual Cutover (Recommended)

1. Test V2 with Docker Hub Pull batch job
2. Monitor for false positives/negatives
3. Enable V2 for specific Portainer instances
4. Full cutover after validation period

### Phase 3: Cleanup (Future)

- Remove old `imageUpdateService.js`
- Remove `dockerRegistryService.js` (digest extraction)
- Remove `containerTools.js` (`crane`/`skopeo` wrappers)
- Remove incorrect `computeHasUpdate` logic

## Usage Examples

### Direct Use (Recommended for New Code)

```javascript
const UpdateComparisonService = require("./services/UpdateComparisonService");

const service = new UpdateComparisonService();

// Check single container
const result = await service.checkContainerUpdate({
  portainerUrl: "https://portainer.example.com",
  apiKey: "ptr_...",
  endpointId: 2,
  container: containerObject,
});

console.log(`Has update: ${result.hasUpdate}`);
console.log(`Running: ${result.runningDigest}`);
console.log(`Registry: ${result.registryDigest}`);
console.log(`Platform: ${result.platform.os}/${result.platform.architecture}`);
```

### Adapter Use (Backward Compatible)

```javascript
const { checkImageUpdates } = require("./services/imageUpdateServiceV2");

// Old interface, new implementation
const updateInfo = await checkImageUpdates(
  imageName,
  containerDetails,
  portainerUrl,
  endpointId,
  userId
);
```

### Batch Processing

```javascript
// Register V2 handler
const DockerHubPullHandlerV2 = require("./services/batch/handlers/DockerHubPullHandlerV2");
batchManager.registerHandler(new DockerHubPullHandlerV2());
```

## Key Decisions & Rationale

### Why Not Use `crane`/`skopeo`?

**Decision**: Use direct HTTP registry queries

**Rationale**:
- Cross-platform (works on Windows without external tools)
- No PATH dependencies
- Controlled error handling
- Registry authentication is explicit

### Why Extract ImageID from Portainer?

**Decision**: Use Portainer's ImageID + RepoDigests

**Rationale**:
- Docker uses ImageID internally to track what was pulled
- For multi-arch, ImageID identifies the specific architecture variant
- RepoDigests contains the manifest digest(s) for what was pulled
- This is the ground truth of what's running

### Why Compare Manifest Digests, Not Image Config Digests?

**Decision**: Use manifest digests from RepoDigests

**Rationale**:
- Manifest digest is what Docker pulls from registry
- Image config digest (ImageID) is internal Docker identifier
- They are different SHA256 hashes (config vs manifest)
- Registry returns manifest digests, Portainer provides both

### Why Not Compare Tags?

**Decision**: Never compare tag names

**Rationale**:
- Tags are mutable pointers
- `postgres:15` might point to `15.0`, `15.1`, `15.2` at different times
- Only digest comparison is reliable
- Tag-based logic led to the original bugs

## Testing

### Unit Tests (Future)

```javascript
describe("RegistryClient", () => {
  it("should select correct platform from manifest list", async () => {
    const client = new RegistryClient();
    const result = await client.getPlatformSpecificDigest(
      "postgres:15",
      {os: "linux", architecture: "amd64"}
    );
    expect(result.digest).toMatch(/^sha256:/);
    expect(result.isManifestList).toBe(true);
  });
});
```

### Integration Tests

1. Run batch job with `USE_V2_UPDATE_LOGIC=true`
2. Verify no false positives for multi-arch images
3. Confirm real updates are detected
4. Check logs for platform-specific digest selection

## Performance Considerations

### Caching Strategy (To Implement)

```javascript
// In UpdateComparisonService
const cacheKey = `${imageRef}:${platform.os}/${platform.architecture}`;
const cachedDigest = cache.get(cacheKey);
if (cachedDigest && !cache.isExpired(cacheKey)) {
  return cachedDigest;
}
```

**TTL Recommendations**:
- Registry digests: 5-15 minutes (images don't change that often)
- Auth tokens: 5 minutes (short-lived)
- Portainer metadata: No cache (always fresh)

### Deduplication

Current batch process queries same image multiple times if multiple containers use it.

**Optimization** (Future):
- Group containers by `imageReference:platform`
- Query registry once per unique image+platform
- Apply result to all matching containers

## Monitoring & Observability

### Key Metrics to Track

1. **False Positive Rate**: Containers showing "update available" but no real update
2. **Platform Distribution**: What % of containers are amd64 vs arm64
3. **Registry Query Time**: Average latency per registry
4. **Auth Failures**: Track authentication issues

### Logging

Structured logs include:
- `platform`: `linux/amd64`
- `isManifestList`: `true/false`
- `runningDigest`: First 12 chars
- `registryDigest`: First 12 chars

## Troubleshooting

### Container Shows "Update Available" Incorrectly

**Check**:
1. `result.platform` - Is it correct?
2. `result.runningDigest` - Does it match what's in RepoDigests?
3. `result.registryDigest` - Is this for the correct platform?
4. `result.isManifestList` - If true, was correct manifest selected?

### Container Shows "No Update" Incorrectly

**Check**:
1. `result.error` - Is there an error?
2. Registry accessibility - Can you manually query the manifest?
3. Auth token - Is authentication working?

### "Cannot Determine Updates" Error

**Causes**:
- Image is locally built (no RepoDigests)
- Image was pulled before RepoDigests were populated
- Container details missing platform metadata

**Solution**: Re-pull the image or skip update checks for local images

## Future Enhancements

1. **Caching Layer**: Add Redis/in-memory cache with explicit TTLs
2. **Rate Limiting**: Respect registry rate limits (especially Docker Hub)
3. **Credentials Support**: Pass registry credentials for private images
4. **Webhook Notifications**: Alert when updates are detected
5. **Auto-Update**: Optionally trigger Portainer pulls when updates found

## API Contract (V2)

### UpdateComparisonService.checkContainerUpdate()

**Input**:
```typescript
{
  portainerUrl: string;
  apiKey: string;
  endpointId: number;
  container: {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
  };
}
```

**Output**:
```typescript
{
  containerName: string;
  containerId: string;
  imageReference: string;
  platform: {
    os: string;
    architecture: string;
    variant?: string;
  };
  runningDigest: string;      // sha256:...
  registryDigest: string;     // sha256:...
  hasUpdate: boolean;
  tag: string;
  isManifestList: boolean;
  state: string;
  status: string;
  error: string | null;
}
```

## References

- [OCI Distribution Spec](https://github.com/opencontainers/distribution-spec)
- [Docker Registry HTTP API V2](https://docs.docker.com/registry/spec/api/)
- [OCI Image Manifest](https://github.com/opencontainers/image-spec/blob/main/manifest.md)
- [OCI Image Index](https://github.com/opencontainers/image-spec/blob/main/image-index.md)

## Questions?

Contact: Principal Engineer (as per original refactoring prompt)

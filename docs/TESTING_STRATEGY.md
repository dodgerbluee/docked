# Testing Strategy for Docked Application

**Last Updated:** 2026-01-21  
**Author:** Principal Engineering  
**Purpose:** Ensure container update detection remains accurate and regression-free

## Executive Summary

This document outlines a comprehensive testing strategy for the Docked application, with specific focus on ensuring that container update detection logic (especially multi-arch RepoDigest handling) cannot regress without test failures.

**Test Suite Classification:** This is a **Multi-Layer Test Strategy** combining:

- **Unit Tests** - Individual function/method testing
- **Integration Tests** - Service layer and database interactions
- **Functional Tests** - End-to-end API workflows
- **Contract Tests** - External service interactions (Portainer, Docker registries)

## Problem Statement

### Critical Bug Example

**Issue:** Containers with `RepoDigests` containing the latest registry digest incorrectly show as "update available"

**Root Cause:** The update detection logic (`computeHasUpdate`) must check if the `latestDigest` exists in ANY of the container's `RepoDigests` (for multi-arch support), not just compare current vs latest digest.

**Impact:** False positives in update notifications, incorrect update counts, user confusion

### Testing Goal

Ensure that when we fix bugs like this, they cannot be reintroduced without test failures.

---

## Testing Architecture

### Test Pyramid Structure

```
                    ┌─────────────────────┐
                    │   E2E/Functional    │  (10% - Slow, Comprehensive)
                    │   API → UI Flow     │
                    └─────────────────────┘
                 ┌──────────────────────────┐
                 │   Integration Tests      │   (30% - Medium Speed)
                 │   Service + Repository   │
                 └──────────────────────────┘
              ┌──────────────────────────────────┐
              │        Unit Tests                │    (60% - Fast, Focused)
              │  Functions, Helpers, Utilities   │
              └──────────────────────────────────┘
```

**Rationale:**

- **60% Unit Tests:** Fast, isolated, test business logic edge cases
- **30% Integration Tests:** Test service interactions, database operations
- **10% Functional Tests:** Test complete user workflows, API contracts

---

## Layer 1: Unit Tests (Foundation)

### 1.1 Container Update Helpers (`containerUpdateHelpers.js`)

**File:** `server/utils/__tests__/containerUpdateHelpers.test.js`

**Test Cases:**

```javascript
describe("normalizeDigest", () => {
  // Edge cases for digest normalization
  test("removes sha256: prefix", () => {
    expect(normalizeDigest("sha256:abc123")).toBe("abc123");
  });

  test("handles digest without prefix", () => {
    expect(normalizeDigest("abc123")).toBe("abc123");
  });

  test("handles null/undefined", () => {
    expect(normalizeDigest(null)).toBeNull();
    expect(normalizeDigest(undefined)).toBeNull();
  });

  test("converts to lowercase", () => {
    expect(normalizeDigest("sha256:ABC123")).toBe("abc123");
  });

  test("handles mixed case with SHA256 prefix", () => {
    expect(normalizeDigest("SHA256:MixedCase")).toBe("mixedcase");
  });
});

describe("computeHasUpdate", () => {
  // CRITICAL: Test the bug we fixed
  describe("multi-arch RepoDigests support", () => {
    test("returns false when latestDigest exists in repoDigests array", () => {
      const container = {
        currentDigest: "sha256:old123",
        latestDigest: "sha256:new456",
        repoDigests: [
          "sha256:old123", // Current architecture
          "sha256:new456", // Latest digest (different arch)
          "sha256:other789", // Another architecture
        ],
      };

      // Should return FALSE because latestDigest IS in repoDigests
      expect(computeHasUpdate(container)).toBe(false);
    });

    test("returns true when latestDigest NOT in repoDigests", () => {
      const container = {
        currentDigest: "sha256:old123",
        latestDigest: "sha256:brandnew999",
        repoDigests: ["sha256:old123", "sha256:old456"],
      };

      expect(computeHasUpdate(container)).toBe(true);
    });

    test("handles repoDigests with different case and prefixes", () => {
      const container = {
        currentDigest: "old123",
        latestDigest: "SHA256:NEW456",
        repoDigests: ["sha256:new456", "sha256:old123"],
      };

      expect(computeHasUpdate(container)).toBe(false);
    });

    test("returns true when repoDigests is empty", () => {
      const container = {
        currentDigest: "sha256:old123",
        latestDigest: "sha256:new456",
        repoDigests: [],
      };

      expect(computeHasUpdate(container)).toBe(true);
    });

    test("returns true when repoDigests is null", () => {
      const container = {
        currentDigest: "sha256:old123",
        latestDigest: "sha256:new456",
        repoDigests: null,
      };

      expect(computeHasUpdate(container)).toBe(true);
    });
  });

  describe("fallback provider (GitHub Releases)", () => {
    test("compares versions when isFallback is true", () => {
      const container = {
        isFallback: true,
        currentVersion: "v1.2.3",
        latestVersion: "v1.2.4",
      };

      expect(computeHasUpdate(container)).toBe(true);
    });

    test("normalizes versions (removes v prefix)", () => {
      const container = {
        isFallback: true,
        currentVersion: "v1.2.3",
        latestVersion: "1.2.3",
      };

      expect(computeHasUpdate(container)).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("returns false when no digest information available", () => {
      const container = {
        currentDigest: null,
        latestDigest: null,
      };

      expect(computeHasUpdate(container)).toBe(false);
    });

    test("prefers full digests over short digests", () => {
      const container = {
        currentDigest: "short123",
        currentDigestFull: "sha256:fullcurrent456",
        latestDigest: "short789",
        latestDigestFull: "sha256:fulllatest999",
        repoDigests: ["sha256:fulllatest999"],
      };

      // Should use full digests and find match
      expect(computeHasUpdate(container)).toBe(false);
    });
  });
});
```

**Coverage Target:** 100% line coverage, all edge cases

---

### 1.2 Registry Update Detection (`RegistryManager.hasUpdate`)

**File:** `server/services/registry/__tests__/RegistryManager.test.js`

**Test Cases:**

```javascript
describe("RegistryManager.hasUpdate", () => {
  let registryManager;

  beforeEach(() => {
    registryManager = new RegistryManager();
  });

  describe("digest comparison with RepoDigests", () => {
    test("returns false when latestInfo.digest exists in repoDigests", () => {
      const currentDigest = "sha256:current123";
      const currentTag = "latest";
      const latestInfo = { digest: "sha256:latest456" };
      const repoDigests = ["sha256:current123", "sha256:latest456"];

      expect(registryManager.hasUpdate(currentDigest, currentTag, latestInfo, repoDigests)).toBe(
        false
      );
    });

    test("normalizes digest prefixes in repoDigests comparison", () => {
      const currentDigest = "current123";
      const currentTag = "latest";
      const latestInfo = { digest: "SHA256:latest456" };
      const repoDigests = ["sha256:latest456"];

      expect(registryManager.hasUpdate(currentDigest, currentTag, latestInfo, repoDigests)).toBe(
        false
      );
    });

    test("returns true when latestInfo.digest NOT in repoDigests", () => {
      const currentDigest = "sha256:current123";
      const currentTag = "latest";
      const latestInfo = { digest: "sha256:brandnew999" };
      const repoDigests = ["sha256:current123", "sha256:old456"];

      expect(registryManager.hasUpdate(currentDigest, currentTag, latestInfo, repoDigests)).toBe(
        true
      );
    });
  });

  describe("version comparison", () => {
    test("compares semantic versions correctly", () => {
      const latestInfo = { version: "2.0.0" };

      expect(registryManager.hasUpdate(null, "1.9.9", latestInfo)).toBe(true);
    });
  });
});
```

---

### 1.3 Image Update Service Functions

**File:** `server/services/__tests__/imageUpdateService.test.js`

**Test Cases:**

```javascript
describe("calculateUpdateStatus", () => {
  test("correctly identifies update when digests differ and latest not in repoDigests", () => {
    const currentDigest = "sha256:old123";
    const currentTag = "latest";
    const latestImageInfo = { digest: "sha256:new456" };
    const repoDigests = ["sha256:old123", "sha256:another789"];

    const result = calculateUpdateStatus(currentDigest, currentTag, latestImageInfo, repoDigests);

    expect(result.hasUpdate).toBe(true);
    expect(result.latestDigest).toBe("sha256:new456");
  });

  test("returns no update when latest digest is in repoDigests", () => {
    const currentDigest = "sha256:arm64digest";
    const currentTag = "latest";
    const latestImageInfo = { digest: "sha256:amd64digest" };
    const repoDigests = [
      "sha256:arm64digest",
      "sha256:amd64digest", // Latest is here (different arch)
    ];

    const result = calculateUpdateStatus(currentDigest, currentTag, latestImageInfo, repoDigests);

    expect(result.hasUpdate).toBe(false);
  });

  test("handles null repoDigests gracefully", () => {
    const result = calculateUpdateStatus("sha256:old", "latest", { digest: "sha256:new" }, null);

    expect(result.hasUpdate).toBe(true);
  });
});

describe("extractImageInfo", () => {
  test("handles image with tag", () => {
    expect(extractImageInfo("postgres:15-alpine")).toEqual({
      repo: "postgres",
      currentTag: "15-alpine",
    });
  });

  test("defaults to latest when no tag", () => {
    expect(extractImageInfo("postgres")).toEqual({
      repo: "postgres",
      currentTag: "latest",
    });
  });

  test("handles registry prefixes", () => {
    expect(extractImageInfo("ghcr.io/owner/repo:v1.0.0")).toEqual({
      repo: "ghcr.io/owner/repo",
      currentTag: "v1.0.0",
    });
  });
});
```

---

## Layer 2: Integration Tests (Service Layer)

### 2.1 Container Query Service Integration

**File:** `server/services/__tests__/containerQueryService.integration.test.js`

**Purpose:** Test service interactions with database and cache

**Test Cases:**

```javascript
describe("ContainerQueryService Integration", () => {
  let testUserId;
  let testContainerId;

  beforeEach(async () => {
    // Setup test database with known state
    testUserId = await createTestUser("testuser");
    testContainerId = await createTestContainer({
      userId: testUserId,
      name: "test-postgres",
      image: "postgres:15",
      currentDigest: "sha256:old123",
      latestDigest: "sha256:new456",
      repoDigests: ["sha256:old123", "sha256:new456"], // Multi-arch
    });
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  test("getContainers returns correct hasUpdate for multi-arch images", async () => {
    const containers = await containerQueryService.getContainers(testUserId);

    const testContainer = containers.find((c) => c.id === testContainerId);

    // Should be FALSE because latest digest IS in repoDigests
    expect(testContainer.hasUpdate).toBe(false);
  });

  test("cache invalidation after container update", async () => {
    // Get initial state
    const beforeUpdate = await containerQueryService.getContainers(testUserId);

    // Update container (simulate upgrade)
    await containerCacheService.updateContainerCache(testContainerId, {
      currentDigest: "sha256:new456",
      latestDigest: "sha256:new456",
    });

    // Get updated state
    const afterUpdate = await containerQueryService.getContainers(testUserId);

    const container = afterUpdate.find((c) => c.id === testContainerId);
    expect(container.currentDigest).toBe("sha256:new456");
    expect(container.hasUpdate).toBe(false);
  });

  test("handles missing repoDigests in database", async () => {
    await createTestContainer({
      userId: testUserId,
      name: "test-nginx",
      image: "nginx:latest",
      currentDigest: "sha256:old",
      latestDigest: "sha256:new",
      repoDigests: null, // Missing repoDigests
    });

    const containers = await containerQueryService.getContainers(testUserId);
    const nginx = containers.find((c) => c.name === "test-nginx");

    // Should fall back to simple digest comparison
    expect(nginx.hasUpdate).toBe(true);
  });
});
```

---

### 2.2 Container Upgrade Flow Integration

**File:** `server/services/__tests__/containerUpgradeService.integration.test.js`

**Purpose:** Test complete upgrade workflow including cache updates

**Test Cases:**

```javascript
describe("ContainerUpgradeService Integration", () => {
  test("upgrade updates cache with new digest", async () => {
    const containerId = await createTestContainer({
      currentDigest: "sha256:v1",
      latestDigest: "sha256:v2",
    });

    // Mock Portainer API responses
    mockPortainerUpgrade();

    // Execute upgrade
    await containerUpgradeService.upgradeContainer(containerId, userId);

    // Verify cache updated
    const cached = await containerCacheService.getContainerFromCache(containerId);
    expect(cached.currentDigest).toBe("sha256:v2");
    expect(cached.hasUpdate).toBe(false);
  });

  test("handles multi-arch upgrade with repoDigests update", async () => {
    const containerId = await createTestContainer({
      currentDigest: "sha256:arm64old",
      latestDigest: "sha256:amd64new",
      repoDigests: ["sha256:arm64old"],
    });

    mockPortainerUpgrade({
      newRepoDigests: ["sha256:amd64new", "sha256:arm64new"],
    });

    await containerUpgradeService.upgradeContainer(containerId, userId);

    const cached = await containerCacheService.getContainerFromCache(containerId);
    expect(cached.repoDigests).toContain("sha256:amd64new");
    expect(cached.hasUpdate).toBe(false);
  });
});
```

---

### 2.3 Registry Service Integration

**File:** `server/services/registry/__tests__/integration.test.js`

**Purpose:** Test registry provider interactions with caching

**Test Cases:**

```javascript
describe("Registry Service Integration", () => {
  describe("getLatestDigest", () => {
    test("Docker Hub official image", async () => {
      const result = await registryService.getLatestDigest("postgres", "15");

      expect(result.digest).toMatch(/^sha256:[a-f0-9]+$/);
      expect(result.provider).toBe("docker-hub");
    });

    test("GHCR image with authentication", async () => {
      const result = await registryService.getLatestDigest("ghcr.io/owner/repo", "latest", {
        userId: testUserId,
      });

      expect(result.digest).toBeDefined();
      expect(result.provider).toBe("ghcr");
    });

    test("fallback to GitHub Releases", async () => {
      const result = await registryService.getLatestDigest("linuxserver/sonarr", "latest", {
        userId: testUserId,
      });

      // May use GitHub Releases fallback
      if (result.isFallback) {
        expect(result.version).toBeDefined();
        expect(result.provider).toBe("github-releases");
      }
    });
  });

  describe("cache behavior", () => {
    test("caches digest lookups", async () => {
      const repo = "nginx";
      const tag = "alpine";

      const start1 = Date.now();
      const result1 = await registryService.getLatestDigest(repo, tag);
      const duration1 = Date.now() - start1;

      const start2 = Date.now();
      const result2 = await registryService.getLatestDigest(repo, tag);
      const duration2 = Date.now() - start2;

      expect(result1.digest).toBe(result2.digest);
      expect(duration2).toBeLessThan(duration1 / 10); // Cached should be 10x faster
    });
  });
});
```

---

## Layer 3: Functional Tests (API/End-to-End)

### 3.1 Container Update Detection API

**File:** `server/__tests__/functional/containerUpdates.test.js`

**Purpose:** Test complete API workflows from request to response

**Test Cases:**

```javascript
describe("Container Update Detection API", () => {
  let authToken;
  let portainerInstanceId;

  beforeAll(async () => {
    authToken = await getTestAuthToken();
    portainerInstanceId = await setupMockPortainerInstance();
  });

  describe("GET /api/containers", () => {
    test("returns containers with accurate hasUpdate for multi-arch images", async () => {
      // Setup: Create tracked container with multi-arch repoDigests
      mockPortainerAPI({
        containers: [
          {
            Id: "test123",
            Names: ["/test-postgres"],
            Image: "postgres:15",
            ImageID: "sha256:old123",
            // Multi-arch: container has multiple digests
            Config: {
              Image: "postgres@sha256:old123",
            },
          },
        ],
      });

      mockPortainerImageInspect({
        RepoDigests: [
          "postgres@sha256:old123", // Current (ARM64)
          "postgres@sha256:latest456", // Latest (AMD64)
        ],
      });

      mockDockerHubAPI({
        digest: "sha256:latest456", // Latest registry digest
      });

      const response = await request(app)
        .get("/api/containers")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const testContainer = response.body.containers.find((c) => c.name === "test-postgres");

      // CRITICAL: Should be false because latest digest IS in repoDigests
      expect(testContainer.hasUpdate).toBe(false);
      expect(testContainer.repoDigests).toHaveLength(2);
    });

    test("identifies true updates when latest not in repoDigests", async () => {
      mockPortainerAPI({
        containers: [
          {
            Id: "nginx123",
            Names: ["/test-nginx"],
            Image: "nginx:alpine",
            ImageID: "sha256:v1",
          },
        ],
      });

      mockPortainerImageInspect({
        RepoDigests: ["nginx@sha256:v1"],
      });

      mockDockerHubAPI({
        digest: "sha256:v2", // Genuinely new version
      });

      const response = await request(app)
        .get("/api/containers")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const nginx = response.body.containers.find((c) => c.name === "test-nginx");

      expect(nginx.hasUpdate).toBe(true);
      expect(nginx.latestDigest).toBe("sha256:v2");
    });
  });

  describe("POST /api/containers/:id/upgrade", () => {
    test("upgrade updates cache and subsequent GET reflects no update", async () => {
      const containerId = "upgrade-test-123";

      // Initial state: has update
      mockPortainerContainer({
        id: containerId,
        imageDigest: "sha256:old",
        repoDigests: ["sha256:old"],
      });

      // Check initial state
      let response = await request(app)
        .get("/api/containers")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      let container = response.body.containers.find((c) => c.id === containerId);
      expect(container.hasUpdate).toBe(true);

      // Perform upgrade
      mockPortainerUpgrade({
        newDigest: "sha256:new",
        newRepoDigests: ["sha256:new"],
      });

      await request(app)
        .post(`/api/containers/${containerId}/upgrade`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Verify update reflected immediately
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait max 2 seconds

      response = await request(app)
        .get("/api/containers")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      container = response.body.containers.find((c) => c.id === containerId);
      expect(container.hasUpdate).toBe(false);
      expect(container.currentDigest).toBe("sha256:new");
    });
  });

  describe("GET /api/containers/:id/check-update", () => {
    test("manual check detects updates correctly with multi-arch", async () => {
      const containerId = "check-test-456";

      mockPortainerContainer({
        id: containerId,
        repoDigests: ["sha256:arm64", "sha256:amd64old"],
      });

      mockDockerHubAPI({
        digest: "sha256:amd64new", // New AMD64 version available
      });

      const response = await request(app)
        .get(`/api/containers/${containerId}/check-update`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.hasUpdate).toBe(true);
      expect(response.body.latestDigest).toBe("sha256:amd64new");
    });
  });
});
```

---

### 3.2 Batch Update Scanning Functional Tests

**File:** `server/__tests__/functional/batchUpdateScanning.test.js`

**Test Cases:**

```javascript
describe("Batch Update Scanning", () => {
  test("batch scan correctly identifies updates across multiple containers", async () => {
    await setupMultipleContainers([
      { name: "postgres", hasUpdate: false, repoDigests: ["sha256:latest"] },
      { name: "nginx", hasUpdate: true, repoDigests: ["sha256:old"] },
      { name: "redis", hasUpdate: false, repoDigests: ["sha256:current", "sha256:latest"] },
    ]);

    mockBatchRegistryLookups();

    const response = await request(app)
      .post("/api/batch/scan-updates")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.containersScanned).toBe(3);
    expect(response.body.updatesFound).toBe(1); // Only nginx
    expect(response.body.containers).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "nginx", hasUpdate: true })])
    );
  });
});
```

---

## Layer 4: Contract Tests (External APIs)

### 4.1 Portainer API Contract Tests

**File:** `server/__tests__/contracts/portainer.contract.test.js`

**Purpose:** Ensure Portainer API responses match our expectations

**Test Cases:**

```javascript
describe("Portainer API Contracts", () => {
  test("container inspect returns expected RepoDigests structure", async () => {
    const response = await portainerService.inspectImage(imageId);

    expect(response).toHaveProperty("RepoDigests");
    expect(Array.isArray(response.RepoDigests)).toBe(true);

    if (response.RepoDigests.length > 0) {
      response.RepoDigests.forEach((digest) => {
        expect(digest).toMatch(/^[^@]+@sha256:[a-f0-9]+$/);
      });
    }
  });

  test("multi-arch images have multiple RepoDigests", async () => {
    const multiArchImages = ["postgres:15", "nginx:alpine", "redis:7"];

    for (const image of multiArchImages) {
      const response = await portainerService.inspectImage(image);

      // Multi-arch images should have at least 2 digests
      if (response.RepoDigests) {
        console.log(`${image}: ${response.RepoDigests.length} digests`);
      }
    }
  });
});
```

---

### 4.2 Docker Registry API Contract Tests

**File:** `server/__tests__/contracts/dockerHub.contract.test.js`

**Test Cases:**

```javascript
describe("Docker Hub API Contracts", () => {
  test("manifest digest format", async () => {
    const result = await dockerHubProvider.getLatestDigest("postgres", "15");

    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("multi-arch manifest list", async () => {
    const result = await dockerHubProvider.getAllArchitectures("postgres", "15");

    expect(result.manifests).toBeDefined();
    expect(Array.isArray(result.manifests)).toBe(true);

    result.manifests.forEach((manifest) => {
      expect(manifest).toHaveProperty("platform.architecture");
      expect(manifest).toHaveProperty("digest");
    });
  });
});
```

---

## Test Data Management

### Test Fixtures

**File:** `server/__tests__/fixtures/containers.js`

```javascript
const containerFixtures = {
  // Multi-arch container with latest already pulled
  postgresMultiArchCurrent: {
    name: "postgres-prod",
    image: "postgres:15",
    currentDigest: "sha256:arm64digest",
    latestDigest: "sha256:amd64digest",
    repoDigests: [
      "sha256:arm64digest",
      "sha256:amd64digest", // Latest is here
    ],
    expectedHasUpdate: false,
  },

  // Multi-arch container needing update
  postgresMultiArchOutdated: {
    name: "postgres-old",
    image: "postgres:15",
    currentDigest: "sha256:oldarm64",
    latestDigest: "sha256:newamd64",
    repoDigests: ["sha256:oldarm64", "sha256:oldamd64"],
    expectedHasUpdate: true,
  },

  // Single-arch container with update
  nginxSingleArchOutdated: {
    name: "nginx-web",
    image: "nginx:alpine",
    currentDigest: "sha256:v1",
    latestDigest: "sha256:v2",
    repoDigests: ["sha256:v1"],
    expectedHasUpdate: true,
  },

  // Container using GitHub Releases fallback
  linuxserverFallback: {
    name: "sonarr",
    image: "linuxserver/sonarr:latest",
    currentVersion: "v3.0.9.1549",
    latestVersion: "v3.0.10.1567",
    isFallback: true,
    provider: "github-releases",
    expectedHasUpdate: true,
  },
};

module.exports = containerFixtures;
```

---

## Continuous Integration Setup

### Jest Configuration

**File:** `server/jest.config.js`

```javascript
module.exports = {
  testEnvironment: "node",
  coverageDirectory: "coverage",
  collectCoverageFrom: [
    "services/**/*.js",
    "utils/**/*.js",
    "controllers/**/*.js",
    "!**/__tests__/**",
    "!**/node_modules/**",
  ],
  coverageThresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Critical files need 100% coverage
    "./utils/containerUpdateHelpers.js": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./services/registry/RegistryManager.js": {
      branches: 90,
      functions: 90,
      lines: 90,
    },
  },
  testMatch: ["**/__tests__/**/*.test.js", "**/__tests__/**/*.spec.js"],
  testPathIgnorePatterns: ["/node_modules/", "/coverage/"],
  setupFilesAfterEnv: ["<rootDir>/__tests__/setup.js"],
};
```

---

### GitHub Actions Workflow

**File:** `.github/workflows/test.yml`

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm run install-all

      - name: Run unit tests
        run: cd server && npm test -- --coverage --testPathPattern="__tests__/.*\\.test\\.js$" --testPathIgnorePatterns="integration|functional|contract"

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./server/coverage/lcov.info
          flags: unit

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run integration tests
        run: cd server && npm test -- --testPathPattern="integration"

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./server/coverage/lcov.info
          flags: integration

  functional-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Start services
        run: docker-compose up -d

      - name: Run functional tests
        run: cd server && npm test -- --testPathPattern="functional"

      - name: Stop services
        run: docker-compose down

  contract-tests:
    runs-on: ubuntu-latest
    # Only run on main branch (requires real API calls)
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run contract tests
        run: cd server && npm test -- --testPathPattern="contract"
        env:
          DOCKER_HUB_USERNAME: ${{ secrets.DOCKER_HUB_USERNAME }}
          DOCKER_HUB_PASSWORD: ${{ secrets.DOCKER_HUB_PASSWORD }}
```

---

## Test Suite Classification

### Answer to Your Question

**This is a COMPREHENSIVE TEST SUITE combining multiple testing approaches:**

1. **Unit Tests (60%)**
   - Pure function testing
   - Isolated, fast, deterministic
   - Test individual business logic functions

2. **Integration Tests (30%)**
   - Service layer integration
   - Database interactions
   - Cache behavior
   - Multi-component workflows

3. **Functional Tests (10%)**
   - Also called **End-to-End (E2E) Tests**
   - Full API request/response cycles
   - Complete user workflows
   - Tests the system as users interact with it

4. **Contract Tests (As Needed)**
   - Verify external API assumptions
   - Document expected API responses
   - Catch breaking changes in dependencies

### Industry Term

This strategy is best described as:

- **"Multi-Layer Integration Testing with Regression Prevention"**
- Or more simply: **"Comprehensive Test Pyramid Strategy"**

**It is NOT purely:**

- Unit Testing (too broad)
- Integration Testing (includes unit and functional)
- Acceptance Testing (that's typically user-facing BDD)

---

## Implementation Roadmap

### Phase 1: Critical Unit Tests (Week 1)

- [x] `containerUpdateHelpers.test.js` - All update logic edge cases
- [x] `RegistryManager.test.js` - Registry update detection
- [x] `imageUpdateService.test.js` - Update calculation logic

### Phase 2: Integration Tests (Week 2)

- [ ] `containerQueryService.integration.test.js`
- [ ] `containerUpgradeService.integration.test.js`
- [ ] `registryService.integration.test.js`
- [ ] `containerCacheService.integration.test.js`

### Phase 3: Functional Tests (Week 3)

- [ ] `containerUpdates.test.js` - Full API workflows
- [ ] `batchUpdateScanning.test.js` - Batch operations
- [ ] `upgradeWorkflow.test.js` - Complete upgrade cycle

### Phase 4: Contract Tests (Week 4)

- [ ] `portainer.contract.test.js`
- [ ] `dockerHub.contract.test.js`
- [ ] `ghcr.contract.test.js`

### Phase 5: CI/CD Integration (Week 5)

- [ ] Setup GitHub Actions workflows
- [ ] Configure code coverage tracking
- [ ] Add pre-commit hooks
- [ ] Branch protection rules

---

## Success Metrics

### Coverage Targets

- **Unit Tests:** 100% coverage on critical update logic
- **Integration Tests:** 80% coverage on service layer
- **Functional Tests:** Cover all happy paths + critical error scenarios

### Regression Prevention KPIs

- **Zero False Positives:** No containers marked as "update available" when they already have the latest
- **Zero False Negatives:** All genuine updates detected within 5 minutes
- **100% Upgrade Success Accuracy:** Post-upgrade, `hasUpdate` must be `false` within 2 seconds

### Build Quality Gates

- All tests must pass before merge
- Coverage must not decrease
- No new critical code without tests

---

## Maintenance Guidelines

### When to Add Tests

**ALWAYS add tests when:**

1. Fixing a bug (add test that would have caught it)
2. Adding a new feature
3. Modifying update detection logic
4. Changing digest comparison logic
5. Updating external API integrations

### Test Maintenance

**Monthly:**

- Review and update contract tests
- Check for flaky tests
- Update fixtures with real-world data

**Quarterly:**

- Review coverage reports
- Identify untested edge cases
- Refactor slow tests

---

## Tools and Libraries

### Testing Frameworks

- **Jest:** Primary test runner (unit, integration, functional)
- **Supertest:** HTTP API testing
- **nock:** HTTP mocking for external APIs
- **jest-mock-extended:** Advanced mocking

### Coverage and Reporting

- **Istanbul (via Jest):** Code coverage
- **Codecov:** Coverage tracking and reporting
- **Jest HTML Reporter:** Human-readable test reports

### CI/CD

- **GitHub Actions:** Automated test execution
- **Husky:** Pre-commit hooks
- **lint-staged:** Run tests on changed files

---

## Conclusion

This testing strategy ensures that **critical bugs like the RepoDigests false positive cannot be reintroduced without test failures**. By implementing this comprehensive multi-layer approach, you'll have:

1. **Fast feedback** - Unit tests catch issues in seconds
2. **Confidence** - Integration tests verify components work together
3. **Real-world validation** - Functional tests ensure user workflows work
4. **External dependency safety** - Contract tests catch API changes

The key to preventing regressions is **test coverage on the exact logic that was broken**, combined with **comprehensive edge case testing** and **automated CI/CD enforcement**.

---

**Next Steps:**

1. Review and approve this strategy
2. Prioritize which tests to implement first (I recommend starting with `containerUpdateHelpers.test.js`)
3. Set up CI/CD pipeline
4. Begin Phase 1 implementation

Would you like me to start implementing any specific test files?

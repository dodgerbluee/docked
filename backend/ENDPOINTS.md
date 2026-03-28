# API Endpoints

## GET /api/containers

Returns all containers for the authenticated user, grouped by Docker Compose stack and also as a flat list.

### Authentication

Bearer JWT token required (`Authorization: Bearer <token>`).

### Query Parameters

None currently acted on by the Go backend. The Node.js backend accepted `useNewCache`, `portainerOnly`, `refreshUpdates`, and `portainerUrl` — these are not yet implemented.

### Data Sources

Containers come from two sources, merged into a single response:

| Source                | How fetched                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Portainer**         | Read from local SQLite DB (`containers` table, joined with `deployed_images` and `registry_image_versions`)                  |
| **Runner (dockhand)** | Fetched live from each enabled runner's `GET {runner_url}/containers` endpoint, then enriched with registry data from the DB |

### Response Shape

```json
{
  "grouped": true,
  "stacks": [
    {
      "name": "mystack",
      "updateCount": 1,
      "uptodateCount": 2,
      "totalCount": 3,
      "containers": [
        /* same Container objects as flat list */
      ]
    }
  ],
  "containers": [
    /* flat list of all containers */
  ],
  "unusedImagesCount": 0
}
```

`stacks` and `containers` contain the same objects — `containers` is a convenience flat list so the frontend doesn't need to flatten stacks for bulk operations. Containers with no stack are grouped under `"Unstacked"` (sorted last).

### Container Object

```json
{
  "id": "1d080d45a215...",
  "name": "nginx-proxy-manager",
  "image": "jc21/nginx-proxy-manager:latest",
  "imageRepo": "jc21/nginx-proxy-manager",
  "status": "Up 7 days",
  "state": "running",
  "stackName": "proxy",

  "currentDigest": "sha256:abc123...",
  "repoDigests": ["sha256:abc123..."],
  "latestDigest": "sha256:abc123...",
  "latestVersion": "latest",
  "latestTag": "latest",
  "latestPublishDate": "2026-02-17T05:43:40Z",
  "hasUpdate": false,
  "noDigest": false,
  "lastChecked": "2026-03-23 19:22:33",
  "provider": "dockerhub",

  "source": "portainer",
  "endpointId": 3,
  "sourceUrl": "https://proxy.example.com",
  "sourceName": "Proxy",

  "runnerId": null,
  "runnerName": null,
  "runnerUrl": null,

  "usesNetworkMode": false,
  "providesNetwork": false,

  "lastSeen": "2026-03-23 18:00:00",
  "createdAt": "2026-01-01 00:00:00"
}
```

### Field Reference

| Field               | Type         | Description                                                                          |
| ------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `id`                | string       | Docker container ID                                                                  |
| `name`              | string       | Container name                                                                       |
| `image`             | string       | Full image reference, e.g. `repo/image:tag`                                          |
| `imageRepo`         | string       | Image name without tag                                                               |
| `status`            | string       | Human-readable status, e.g. `"Up 7 days"`                                            |
| `state`             | string       | Docker state: `"running"`, `"exited"`, etc.                                          |
| `stackName`         | string\|null | Docker Compose project name                                                          |
| `currentDigest`     | string\|null | sha256 digest of the running image                                                   |
| `repoDigests`       | string[]     | Manifest-list digests from the registry (sha256-only, image prefix stripped)         |
| `latestDigest`      | string\|null | Latest digest from registry scan                                                     |
| `latestVersion`     | string\|null | Latest version string from registry                                                  |
| `latestTag`         | string\|null | Latest tag from registry                                                             |
| `latestPublishDate` | string\|null | Publish date of latest registry image                                                |
| `hasUpdate`         | bool         | `true` if `repoDigests` are known and none match `latestDigest`                      |
| `noDigest`          | bool         | `true` if registry has this image but no digest (version-only update detection)      |
| `lastChecked`       | string\|null | Timestamp of last registry check                                                     |
| `provider`          | string\|null | Registry provider: `"dockerhub"`, `"ghcr"`, etc.                                     |
| `source`            | string       | `"portainer"` or `"runner"`                                                          |
| `endpointId`        | int\|null    | Portainer endpoint ID (Portainer containers only)                                    |
| `sourceUrl`         | string\|null | Portainer instance URL (Portainer containers only)                                   |
| `sourceName`        | string\|null | Portainer instance display name (Portainer containers only)                          |
| `runnerId`          | int\|null    | Runner DB ID (runner containers only)                                                |
| `runnerName`        | string\|null | Runner display name (runner containers only)                                         |
| `runnerUrl`         | string\|null | Runner base URL (runner containers only)                                             |
| `usesNetworkMode`   | bool         | Container uses another container's network (`service:` or `container:` network mode) |
| `providesNetwork`   | bool         | Another container references this container's network                                |
| `lastSeen`          | string       | Last time this container was seen in a scan                                          |
| `createdAt`         | string       | DB record creation timestamp                                                         |

### Update Detection Logic

`hasUpdate` is computed from `repoDigests` and `latestDigest`:

- If `repoDigests` is empty → `false` (conservative — no basis for comparison)
- If `latestDigest` is null → `false`
- If any entry in `repoDigests` matches `latestDigest` (after normalizing `sha256:` prefix) → `false`
- Otherwise → `true`

### Notes

- Runner containers are fetched live on every request (with a 10s timeout per runner). A failing runner is skipped and logged — it does not fail the whole request.
- Registry enrichment for runner containers is a DB-only lookup (no live registry call on this endpoint). Live registry checks happen via the batch scan endpoint.

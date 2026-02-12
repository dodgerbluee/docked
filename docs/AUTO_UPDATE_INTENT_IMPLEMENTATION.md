# Auto-Update Intent System - Implementation Guide

## Overview

The Auto-Update Intent system is fully implemented in the codebase and ready for use. This guide explains how it works and how to use it.

## Architecture Summary

### Key Components

1. **Database Model** (`db/autoUpdateIntents.js`)
   - CRUD operations for AutoUpdateIntent
   - Persistent storage across Portainer wipes
   - User-scoped (each user can have their own intents)

2. **Matching Logic** (`services/intentMatchingService.js`)
   - Priority-based matching algorithm
   - Image repository normalization
   - No Portainer IDs - uses stable identifiers

3. **Batch Handler** (`services/batch/handlers/AutoUpdateHandler.js`)
   - Orchestrates auto-update execution
   - Reuses existing upgrade logic
   - Records results for audit trail

4. **API Controller** (`controllers/autoUpdateIntentController.js`)
   - RESTful CRUD operations
   - Dry-run capability (test-match endpoint)
   - Enable/disable endpoints

5. **Routes** (`routes/index.js`)
   - Full REST API for intent management
   - Swagger documentation included

## Database Schema

```sql
CREATE TABLE auto_update_intents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  
  -- Matching criteria (at least one required)
  stack_name TEXT,
  service_name TEXT,
  image_repo TEXT,
  container_name TEXT,
  
  -- Configuration
  enabled INTEGER DEFAULT 0,
  notify_discord INTEGER DEFAULT 0,
  notify_on_update_detected INTEGER DEFAULT 0,
  notify_on_batch_start INTEGER DEFAULT 0,
  notify_on_success INTEGER DEFAULT 0,
  notify_on_failure INTEGER DEFAULT 0,
  
  -- Metadata
  description TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  
  UNIQUE(user_id, stack_name, service_name),
  UNIQUE(user_id, image_repo),
  UNIQUE(user_id, container_name),
  FOREIGN KEY (user_id) REFERENCES users(id)
)
```

## Matching Algorithm

The system matches containers to intents using a three-tier priority system:

### Priority 1: Stack + Service (Most Stable)
```
intent.stack_name == container.stack_name 
AND intent.service_name == container.service_name
```
**Best for**: Docker Compose containers with named services
**Stability**: Survives Portainer wipes (container names change but service structure persists)

### Priority 2: Image Repository (Good Coverage)
```
normalize(intent.image_repo) == normalize(container.image_repo)
```
**Normalization handles**:
- `library/nginx` → `nginx` (official images)
- `docker.io/nginx` → `nginx` (explicit registry)
- `GHCR.IO/...` → `ghcr.io/...` (case-insensitivity)

**Best for**: Same image across multiple Portainer instances
**Coverage**: Can match 1-N containers

### Priority 3: Container Name (Least Stable)
```
intent.container_name == container.container_name
```
**Best for**: Non-compose containers with fixed names
**Stability**: Low (container name could change manually)

## How It Works

### 1. Creating an Intent

```bash
curl -X POST http://localhost:3000/api/auto-update/intents \
  -H "Content-Type: application/json" \
  -d {
    "imageRepo": "ghcr.io/linuxserver/plex",
    "enabled": false,  # Always starts disabled (safety)
    "notifyDiscord": true,
    "notifyOnSuccess": true,
    "notifyOnFailure": true,
    "description": "Auto-upgrade Plex container"
  }
```

**Response**:
```json
{
  "success": true,
  "message": "Auto-update intent created",
  "intent": {
    "id": 1,
    "user_id": 123,
    "imageRepo": "ghcr.io/linuxserver/plex",
    "enabled": 0,
    "notifyDiscord": 1,
    "created_at": "2025-02-03T...",
    ...
  }
}
```

### 2. Testing What Matches (Dry-Run)

Before enabling, test what containers would be matched:

```bash
curl -X POST http://localhost:3000/api/auto-update/intents/1/test-match
```

**Response**:
```json
{
  "success": true,
  "message": "Found 2 matching container(s)",
  "matchedCount": 2,
  "matchedContainers": [
    {
      "id": "abc123def456",
      "name": "plex",
      "imageRepo": "ghcr.io/linuxserver/plex",
      "imageName": "ghcr.io/linuxserver/plex:latest",
      "stackName": "media",
      "hasUpdate": true,
      "updateAvailable": "1.41.0"
    },
    {
      "id": "xyz789uvu000",
      "name": "plex-dev",
      "imageRepo": "ghcr.io/linuxserver/plex",
      "imageName": "ghcr.io/linuxserver/plex:latest",
      "stackName": "test",
      "hasUpdate": false,
      "updateAvailable": null
    }
  ],
  "withUpdatesCount": 1,
  "summary": {
    "totalMatched": 2,
    "withUpdates": 1,
    "upToDate": 1
  }
}
```

### 3. Enabling the Intent

Once satisfied with the match results:

```bash
curl -X POST http://localhost:3000/api/auto-update/intents/1/enable
```

Now the intent is active and will be processed by the batch job.

### 4. Batch Job Execution

The auto-update batch handler processes all enabled intents:

```javascript
// Pseudocode flow
for each enabled intent:
  - Find matched containers
  - For each matched container with has_update = true:
    - Call upgradeSingleContainer() (existing logic)
    - Record result (success/failure)
    - Log and notify (if enabled)
  - Record intent results to batch_runs
```

**Results are stored in**: `batch_runs` table with `job_type = 'auto-update'`

### 5. What Happens After Portainer Wipe

**Scenario**: User wipes Portainer data and re-ingests containers from same Portainer instance.

**Before**: 
- Container ID: `abc123...` (now invalid)
- Intent: "Auto-upgrade Plex" (based on image_repo)

**After Portainer Wipe/Re-ingest**:
- Container ID: `xyz999...` (new ID)
- Intent still exists (not affected by wipe)
- Container has same image_repo: `ghcr.io/linuxserver/plex`
- **Matching runs again**: Intent re-attaches to new container ID automatically
- Auto-updates resume without user action

## API Reference

### Create Intent
```
POST /api/auto-update/intents
Content-Type: application/json

{
  "stackName": "media",              # Optional
  "serviceName": "plex",             # Optional (requires stackName)
  "imageRepo": "ghcr.io/linuxserver/plex",  # Optional
  "containerName": "plex",           # Optional
  "enabled": false,                  # Required (default: false)
  "notifyDiscord": false,            # Optional
  "notifyOnUpdateDetected": false,   # Optional
  "notifyOnBatchStart": false,       # Optional
  "notifyOnSuccess": false,          # Optional
  "notifyOnFailure": false,          # Optional
  "description": "..."               # Optional
}

# At least one matching criterion must be provided
```

### List Intents
```
GET /api/auto-update/intents

Response:
{
  "success": true,
  "intents": [...],
  "count": 5
}
```

### Get Intent
```
GET /api/auto-update/intents/:id
```

### Update Intent
```
PATCH /api/auto-update/intents/:id
Content-Type: application/json

{
  "enabled": true,
  "notifyDiscord": true,
  "description": "Updated description"
  # Only provide fields you want to update
}
```

### Delete Intent
```
DELETE /api/auto-update/intents/:id
```

### Test Matching (Dry-Run)
```
POST /api/auto-update/intents/:id/test-match

Response shows what containers would be matched without making changes
```

### Enable Intent
```
POST /api/auto-update/intents/:id/enable
```

### Disable Intent
```
POST /api/auto-update/intents/:id/disable

# Disabling stops auto-updates for matched containers
# Already-completed upgrades are NOT rolled back
```

## Safety Features

### 1. Opt-In by Default
- All intents start with `enabled = 0`
- Must explicitly enable to activate auto-updates
- No accidents from forgotten configuration

### 2. Explicit Matching
- No auto-match without user consent
- Test-match endpoint shows exactly what will be upgraded
- UI should always show what containers match before enabling

### 3. No Phantom Upgrades
- If intent matches zero containers → skip silently (logged)
- If intent matches multiple containers → upgrade all (idempotent by container ID)
- If container matches multiple intents → upgrade once (idempotent)

### 4. Reuses Existing Logic
- Upgrades use `upgradeSingleContainer()` (battle-tested)
- Same authentication, error handling, retry logic
- Results recorded in `upgrade_history` (existing table)

### 5. Audit Trail
- All intents logged with intent ID and user ID
- All upgrades recorded in `batch_runs` table
- Manual inspection via: SELECT * FROM batch_runs WHERE job_type = 'auto-update'

## Configuration

### Enabling Auto-Update Batch Job

The batch handler exists but must be registered with the batch scheduler.

**Example** (in your batch configuration):

```javascript
// In batch scheduler initialization:
const AutoUpdateHandler = require('./services/batch/handlers/AutoUpdateHandler');

batchManager.registerHandler({
  type: 'auto-update',
  handler: AutoUpdateHandler.handle,
  enabled: true,
  intervalMinutes: 60,  // Run every hour
});
```

### Discord Notifications (Future Implementation)

Design is documented in `services/autoUpdateDiscordNotifications.js`. Integration ready but not activated in current version.

To activate:
1. Add `await discordService.queueNotification()` calls in AutoUpdateHandler.executeIntent()
2. Use notification templates from autoUpdateDiscordNotifications.js
3. Test with `/api/discord/test` endpoint

## Troubleshooting

### Intent Created but Not Matching

**Check**:
1. Is intent enabled? `GET /api/auto-update/intents/:id` → check `enabled` field
2. Run test-match: `POST /api/auto-update/intents/:id/test-match` → check matchedCount
3. Are container fields matching the intent criteria?
   - Verify image_repo is exactly right (use test-match output)
   - Check container names in test-match output
   - Verify stack/service names if using compose matching

### Batch Job Not Running

**Check**:
1. Is batch handler registered?
2. Is any intent enabled? `GET /api/auto-update/intents` → check for `enabled = 1`
3. Are there containers in the system? `GET /api/containers` should return containers
4. Check batch_runs table: `SELECT * FROM batch_runs WHERE job_type = 'auto-update' ORDER BY id DESC LIMIT 10`

### Upgrades Failing

**Check**:
1. Upgrade history: `SELECT * FROM upgrade_history ORDER BY id DESC LIMIT 10`
2. Logs: Check for `AutoUpdateHandler` errors
3. Run manual upgrade: `POST /api/containers/:containerId/upgrade` to test upgrade logic independently

## Future Enhancements

### Phase 2 (Not Implemented Yet)

1. **Discord Notifications** (design ready, integration pending)
   - Update detected notifications
   - Batch start/complete notifications
   - Per-container success/failure notifications

2. **Scheduling / Cron**
   - Set custom schedules per intent
   - Timezone support

3. **Advanced Matching**
   - Regex patterns for image repos
   - Label-based matching

4. **Rollback Support**
   - Store previous container config
   - One-click rollback to previous version

5. **Canary Deployments**
   - Upgrade subset of containers first
   - Verify before upgrading rest
   - Automatic rollback on failure

## Code Structure

```
server/
├── db/
│   ├── autoUpdateIntents.js          # Database CRUD layer
│   ├── migrations/
│   │   └── 0002_auto_update_intent.js # Schema migration
│   └── index.js                      # Re-exports auto-update functions
├── services/
│   ├── intentMatchingService.js      # Matching algorithm
│   ├── autoUpdateDiscordNotifications.js  # Notification templates (design)
│   └── batch/
│       └── handlers/
│           └── AutoUpdateHandler.js  # Batch job orchestration
├── controllers/
│   └── autoUpdateIntentController.js # REST endpoint handlers
└── routes/
    └── index.js                      # API routes (POST/GET/PATCH/DELETE)
```

## Testing

### Manual Testing Steps

1. **Create intent**:
   ```bash
   curl -X POST http://localhost:3000/api/auto-update/intents \
     -H "Content-Type: application/json" \
     -d '{"imageRepo": "nginx", "enabled": false}'
   ```

2. **Test matching**:
   ```bash
   curl -X POST http://localhost:3000/api/auto-update/intents/1/test-match
   # Should show nginx containers matching
   ```

3. **Enable intent**:
   ```bash
   curl -X POST http://localhost:3000/api/auto-update/intents/1/enable
   ```

4. **Verify batch handler works** (requires scheduler setup):
   - Check batch_runs table
   - Verify upgraded containers in Docker

### Unit Tests

Services have clear interfaces for testing:
- `intentMatchingService.buildIntentMap()` - test matching logic
- `intentMatchingService.matchesIntent()` - test individual matches
- `intentMatchingService.normalizeImageRepo()` - test image normalization

Example test:
```javascript
const intentMatchingService = require('../services/intentMatchingService');

// Test stack+service matching
const intent = {
  stack_name: 'media',
  service_name: 'plex',
  image_repo: null,
  container_name: null,
};

const container = {
  stack_name: 'media',
  service_name: 'plex',
  container_name: 'media_plex_1',
  image_repo: 'ghcr.io/linuxserver/plex',
};

const matches = intentMatchingService.matchesIntent(intent, container);
// assert(matches === true)
```

## Performance Notes

- Intent matching: O(intents × containers) - runs once per batch cycle
- Index on (user_id, enabled) optimizes intent query
- No impact on normal container operations
- Upgrade execution is sequential per intent (conservative default)

## Security Considerations

1. **User Isolation**: All intents user-scoped via user_id
2. **No Shell Execution**: Uses existing API-based upgrade, no exec()
3. **Authentication**: All endpoints require auth middleware
4. **UNIQUE Constraints**: Prevent duplicate intents
5. **Safe Defaults**: Disabled by default, explicit enable required

---

**Last Updated**: February 3, 2025
**Status**: Core features implemented, Discord notifications design ready

# Auto-Update Intent System Design

## Overview

The Auto-Update Intent system enables opt-in automatic container upgrades that **survive Portainer database wipes**. The key insight is to persist **user intent** (e.g., "automatically upgrade Plex containers") rather than Portainer IDs (which become invalid after a wipe).

## Core Concept: AutoUpdateIntent

An `AutoUpdateIntent` represents a user's decision to automatically update containers matching certain criteria. It is:
- **Persistent** across Portainer data wipes
- **Match-based** using stable identifiers (image repo, stack+service, container name)
- **Intent-based** not ID-based
- **Independent** from any running container instance

### Data Model

```sql
CREATE TABLE auto_update_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  
  -- Matching criteria (at least one must be set)
  -- Matched in priority order: stack_service > image_repo > container_name
  stack_name TEXT,
  service_name TEXT,  -- Within stack (e.g., "web" in docker-compose)
  image_repo TEXT,    -- Full image repo without tag (e.g., "ghcr.io/linuxserver/plex")
  container_name TEXT,  -- Fallback (least stable, but useful for non-compose containers)
  
  -- Intent configuration
  enabled INTEGER DEFAULT 0,
  notify_discord INTEGER DEFAULT 0,
  notify_on_update_detected INTEGER DEFAULT 0,
  notify_on_batch_start INTEGER DEFAULT 0,
  notify_on_success INTEGER DEFAULT 0,
  notify_on_failure INTEGER DEFAULT 0,
  
  -- Metadata
  description TEXT,  -- User-provided description (e.g., "Auto-upgrade all Plex instances")
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  UNIQUE(user_id, stack_name, service_name),
  UNIQUE(user_id, image_repo),
  UNIQUE(user_id, container_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)

-- Indexes for efficient matching
CREATE INDEX idx_auto_update_intents_user_enabled 
  ON auto_update_intents(user_id, enabled)
CREATE INDEX idx_auto_update_intents_stack_service 
  ON auto_update_intents(user_id, stack_name, service_name) WHERE enabled = 1
CREATE INDEX idx_auto_update_intents_image_repo 
  ON auto_update_intents(user_id, image_repo) WHERE enabled = 1
CREATE INDEX idx_auto_update_intents_container_name 
  ON auto_update_intents(user_id, container_name) WHERE enabled = 1
```

## Matching Algorithm

After Portainer sync (when containers are re-ingested), the system matches containers to intents:

```
FOR each container in newly_ingested_containers:
  FOR each enabled AutoUpdateIntent:
    
    // Priority 1: Stack + Service (most stable after re-ingest)
    IF intent.stack_name AND intent.service_name:
      IF container.stack_name == intent.stack_name 
         AND container.service_name == intent.service_name:
        MATCH(intent, container)
        CONTINUE to next intent
    
    // Priority 2: Image Repo (stable, can match multiple containers)
    IF intent.image_repo:
      IF normalize(container.image_repo) == normalize(intent.image_repo):
        MATCH(intent, container)
        CONTINUE to next intent
    
    // Priority 3: Container Name (least stable but useful)
    IF intent.container_name:
      IF container.name == intent.container_name:
        MATCH(intent, container)
        CONTINUE to next intent

// Result: Each intent matches zero, one, or many containers
// Each container may match zero, one, or many intents (though typically one)
```

**Important properties:**
- If an intent matches zero containers: **log and skip** (don't create phantom upgrades)
- If an intent matches multiple containers: **upgrade each one**
- If a container matches multiple intents: **upgrade once** (idempotent)
- After a Portainer wipe and re-ingest: intents re-attach automatically by re-running matching logic

## Batch Auto-Update Job Flow

The `AutoUpdateHandler` batch job executes periodically:

```
1. Fetch all enabled AutoUpdateIntents for user
2. Fetch all containers from normalized tables (portainer_containers)
3. Run matching algorithm → build intent→containers map
4. FOR each intent with matched containers:
     a. Check if any matched container has an update available
     b. IF has_update:
        - Call existing upgradeSingleContainer() for each matched container
        - Gather results (success/failure)
        - Send Discord notifications if enabled
     c. IF no update:
        - Log "no update available for intent"
5. Record batch run results to batch_runs table
6. Send batch completion summary to Discord
```

**Key design decisions:**
- Upgrades execute **sequentially per intent** (conservative default)
- Reuses **existing upgrade logic** (upgradeSingleContainer) - no duplication
- Stores results in existing **batch_runs** table
- Discord notifications are **opt-in per intent**

## Matching Normalization

The matching logic must normalize image repos to handle variations:

```javascript
// Examples of normalization needed:
"library/nginx" → "nginx"  (official images)
"ghcr.io/linuxserver/plex" → "ghcr.io/linuxserver/plex"  (GHCR)
"docker.io/nginx" → "nginx"  (explicit registry)
"GHCR.IO/Linuxserver/Plex" → "ghcr.io/linuxserver/plex"  (case-insensitive)
```

## Service Architecture

### New Services

1. **AutoUpdateIntentService** (`services/autoUpdateIntentService.js`)
   - CRUD for AutoUpdateIntent
   - Enable/disable intents
   - Update notification preferences

2. **IntentMatchingService** (`services/intentMatchingService.js`)
   - Implements matching algorithm
   - Normalizes image repos
   - Returns intent→containers mapping
   - Validates intent constraints

3. **AutoUpdateHandler** (`services/batch/handlers/AutoUpdateHandler.js`)
   - Batch job handler for auto-update processing
   - Orchestrates intent matching, upgrade execution, notifications
   - Records results to batch_runs

### Database Module

New DB access layer: `db/autoUpdateIntents.js`
- createIntent()
- updateIntent()
- getIntent()
- listIntents()
- deleteIntent()
- markEnabled/markDisabled()

## API Endpoints

```
POST   /api/auto-update/intents
       Create new auto-update intent
       
GET    /api/auto-update/intents
       List all intents for user
       
GET    /api/auto-update/intents/:id
       Get specific intent
       
PATCH  /api/auto-update/intents/:id
       Update intent (enable/disable, notification prefs, matching rules)
       
DELETE /api/auto-update/intents/:id
       Delete intent
       
POST   /api/auto-update/intents/:id/test-match
       Test matching: returns which containers would be matched by this intent
       
POST   /api/auto-update/run
       Manually trigger auto-update batch job (admin/testing)
```

## Discord Notifications

Each intent can opt into notifications:
- `notify_on_update_detected`: "Found update for Plex"
- `notify_on_batch_start`: "Auto-update batch started"
- `notify_on_success`: "✓ Plex upgraded from 1.0 to 1.1"
- `notify_on_failure`: "✗ Plex upgrade failed: connection timeout"

Notifications use existing `discordService.sendNotification()` with new template types:
- `auto-update-detected`
- `auto-update-batch-started`
- `auto-update-success`
- `auto-update-failure`
- `auto-update-batch-complete`

## Safety Constraints

1. **Disabled by default**: All intents start with `enabled = 0`
2. **No phantom upgrades**: If an intent matches zero containers, do nothing
3. **Explicit opt-in**: Users must create and enable an intent to get auto-updates
4. **Dry-run support**: POST `/auto-update/intents/:id/test-match` shows what would be matched
5. **Audit trail**: All upgrades are recorded in `upgrade_history` table (existing table)

## Migration Strategy

1. Create `auto_update_intents` table with all indexes
2. No data migration needed (new feature, no legacy data)
3. Bump schema_migrations version

## Open Questions / Tradeoffs

- **Cascading matches**: Should one container matched by multiple intents be upgraded once or multiple times?
  - **Decision**: Upgrade once (idempotent by container ID)
  
- **Partial failures**: If batch has 3 intents and 1 fails, still report as partial success?
  - **Decision**: Yes, report results per intent in batch_runs.logs

- **Scheduling**: When does the batch job run?
  - **Decision**: Not implemented yet (scheduled separately), but handler is structured for it

- **Rollback**: Can users disable an intent retroactively?
  - **Decision**: Yes, disable intent, but no rollback of already-completed upgrades

## Non-Goals (Not Implementing Yet)

- Scheduling / cron (handler is prepared for external scheduler)
- Rollbacks
- Canary / phased updates
- Watchtower-style env var automation

## Implementation Phases

### Phase 1 (Current)
- ✓ Design and data model
- ✓ Matching service
- ✓ Database layer
- ✓ Batch handler
- ✓ API endpoints
- ✓ Basic Discord integration

### Phase 2 (Future)
- Scheduling / cron
- Advanced notification templates
- Rollback support
- Canary deployments

# Auto-Update Intent System - Quick Start

## TL;DR

Enable automatic container upgrades that **survive Portainer database wipes**.

## 3-Minute Setup

### 1. Create an Intent

Choose your matching criteria:

```bash
# By image repository (most flexible)
curl -X POST http://localhost:3000/api/auto-update/intents \
  -H "Content-Type: application/json" \
  -d '{
    "imageRepo": "ghcr.io/linuxserver/plex",
    "description": "Auto-upgrade Plex"
  }'

# By stack + service (Docker Compose)
curl -X POST http://localhost:3000/api/auto-update/intents \
  -H "Content-Type: application/json" \
  -d '{
    "stackName": "media",
    "serviceName": "plex",
    "description": "Auto-upgrade Plex service"
  }'

# By container name (fallback)
curl -X POST http://localhost:3000/api/auto-update/intents \
  -H "Content-Type: application/json" \
  -d '{
    "containerName": "my-plex",
    "description": "Auto-upgrade Plex"
  }'
```

Save the intent ID from response (let's say it's `1`).

### 2. Test What Will Match

```bash
curl -X POST http://localhost:3000/api/auto-update/intents/1/test-match
```

See the matching containers:
```json
{
  "matchedCount": 2,
  "matchedContainers": [
    {
      "name": "plex",
      "imageRepo": "ghcr.io/linuxserver/plex",
      "hasUpdate": true,
      "updateAvailable": "1.41.0"
    },
    {
      "name": "plex-dev",
      "imageRepo": "ghcr.io/linuxserver/plex",
      "hasUpdate": false
    }
  ],
  "withUpdatesCount": 1
}
```

### 3. Enable Auto-Updates

```bash
curl -X POST http://localhost:3000/api/auto-update/intents/1/enable
```

✅ **Done!** Auto-updates are now active.

## What Happens Next

The batch job will:
1. Run periodically (check your batch scheduler config)
2. Find containers matching the intent
3. Upgrade any with available updates
4. Skip containers with no updates
5. Log all operations

## Key Features

### ✅ Survives Portainer Wipes
- Intent persists
- Automatically re-matches after re-ingest
- No user action needed

### ✅ Multiple Matching Methods
- `imageRepo`: Match same image across instances
- `stackName + serviceName`: Match Docker Compose services
- `containerName`: Match specific containers

### ✅ Safe by Default
- Starts disabled (must enable explicitly)
- Dry-run endpoint to test first
- Nothing happens without user action

### ✅ Integrates with Existing Logic
- Uses proven `upgradeSingleContainer()` function
- Same error handling and retries
- Results recorded in `upgrade_history`

## Common Tasks

### List All Intents
```bash
curl http://localhost:3000/api/auto-update/intents
```

### Update an Intent
```bash
curl -X PATCH http://localhost:3000/api/auto-update/intents/1 \
  -H "Content-Type: application/json" \
  -d '{"description": "New description"}'
```

### Enable/Disable
```bash
# Enable
curl -X POST http://localhost:3000/api/auto-update/intents/1/enable

# Disable
curl -X POST http://localhost:3000/api/auto-update/intents/1/disable
```

### Delete an Intent
```bash
curl -X DELETE http://localhost:3000/api/auto-update/intents/1
```

## Troubleshooting

### Intent Not Matching Any Containers
```bash
# Check what containers exist
curl http://localhost:3000/api/containers

# Test matching again
curl -X POST http://localhost:3000/api/auto-update/intents/1/test-match
# Should show matchedCount > 0
```

### Batch Job Not Running
Check your batch scheduler:
```bash
# Should see auto-update entries
curl http://localhost:3000/api/batch/runs?jobType=auto-update
```

### Container Upgrade Failed
Check upgrade history:
```bash
# View last failed upgrades
curl http://localhost:3000/api/containers/upgrade-history?status=failed
```

## Configuration

### Batch Scheduler Setup (Required)

Add to your batch scheduler initialization:

```javascript
const AutoUpdateHandler = require('./services/batch/handlers/AutoUpdateHandler');

scheduler.registerJob({
  type: 'auto-update',
  handler: AutoUpdateHandler.handle,
  enabled: true,
  intervalMinutes: 60,  // Run every hour
});
```

Without this, intents are created but not automatically executed.

### Discord Notifications (Optional, Future)

When ready to enable notifications:

1. Create Discord webhook in your Discord server
2. Add webhook to Docked settings
3. Update intent with `notifyDiscord: true`
4. Integration code is designed and ready in `autoUpdateDiscordNotifications.js`

## Database Schema (Reference)

```sql
CREATE TABLE auto_update_intents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  stack_name TEXT,
  service_name TEXT,
  image_repo TEXT,
  container_name TEXT,
  enabled INTEGER DEFAULT 0,
  notify_discord INTEGER DEFAULT 0,
  notify_on_update_detected INTEGER DEFAULT 0,
  notify_on_batch_start INTEGER DEFAULT 0,
  notify_on_success INTEGER DEFAULT 0,
  notify_on_failure INTEGER DEFAULT 0,
  description TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
```

## API Examples

### cURL
```bash
# Create intent
curl -X POST http://localhost:3000/api/auto-update/intents \
  -H "Content-Type: application/json" \
  -d '{"imageRepo": "nginx"}'

# List intents
curl http://localhost:3000/api/auto-update/intents

# Test matching
curl -X POST http://localhost:3000/api/auto-update/intents/1/test-match

# Enable
curl -X POST http://localhost:3000/api/auto-update/intents/1/enable

# Disable
curl -X POST http://localhost:3000/api/auto-update/intents/1/disable

# Update
curl -X PATCH http://localhost:3000/api/auto-update/intents/1 \
  -H "Content-Type: application/json" \
  -d '{"description": "new description"}'

# Delete
curl -X DELETE http://localhost:3000/api/auto-update/intents/1
```

### JavaScript/Node.js
```javascript
const apiUrl = 'http://localhost:3000/api/auto-update/intents';

// Create
const response = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ imageRepo: 'nginx' })
});
const intent = await response.json();

// List
const all = await fetch(apiUrl).then(r => r.json());

// Test match
await fetch(`${apiUrl}/${intent.intent.id}/test-match`, {
  method: 'POST'
}).then(r => r.json());

// Enable
await fetch(`${apiUrl}/${intent.intent.id}/enable`, {
  method: 'POST'
});
```

### Python
```python
import requests

api_url = 'http://localhost:3000/api/auto-update/intents'

# Create
response = requests.post(api_url, json={'imageRepo': 'nginx'})
intent_id = response.json()['intent']['id']

# Test match
requests.post(f'{api_url}/{intent_id}/test-match')

# Enable
requests.post(f'{api_url}/{intent_id}/enable')

# List
requests.get(api_url).json()
```

## Performance

- **Matching**: O(intents × containers) - happens once per batch cycle
- **Upgrades**: Sequential per intent (conservative, safe)
- **Database**: Indexed for fast intent lookup
- **No Impact**: Normal container operations unaffected

## Safety

- ✅ Disabled by default
- ✅ Explicit enable required
- ✅ Test-match before enabling
- ✅ Reuses proven upgrade logic
- ✅ All operations logged
- ✅ Idempotent (safe to retry)

## What Happens After Portainer Wipe

**Before**: Plex container (ID: abc123...) is auto-updated
**Wipe**: Portainer data deleted, containers re-ingested
**After**: 
- Same container now has new ID (xyz789...)
- Intent still exists (not affected by wipe)
- Batch job finds container by image_repo (stable identifier)
- Auto-update resumes automatically ✨

## Links

- 📖 **Full Implementation Guide**: See `AUTO_UPDATE_INTENT_IMPLEMENTATION.md`
- 🏗️ **Architecture Design**: See `AUTO_UPDATE_INTENT_DESIGN.md`
- 📊 **Full Summary**: See `AUTO_UPDATE_INTENT_SUMMARY.md`

---

**Need help?** Check the docs folder for detailed guides and troubleshooting.

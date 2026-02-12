# Auto-Update Intent Integration Checklist

## Pre-Integration Verification

- [ ] Database migration has been run
  - Check: `SELECT * FROM sqlite_master WHERE type='table' AND name='auto_update_intents'`
  - Should return table definition

- [ ] Routes are loaded
  - Check: Application starts without errors
  - Check: `/api/auto-update/intents` returns 401 (auth required) or 200 (empty list)

- [ ] Controller loads without errors
  - Check: No import errors in logs
  - Check: Swagger docs include `/auto-update` endpoints

- [ ] Database functions are exported
  - Check: `require('./db').createIntent` resolves (in Node REPL)

## Integration Steps

### 1. Locate Batch Scheduler

Find where batch jobs are registered:

```bash
# Usually in:
- server/services/batch/index.js
- server/services/batch/Scheduler.js
- server/server.js (batch initialization)
- Check imports for "BatchManager" or "Scheduler"
```

### 2. Register AutoUpdateHandler

Add to batch scheduler initialization:

```javascript
// At the top of file
const AutoUpdateHandler = require('./handlers/AutoUpdateHandler');

// In scheduler registration section (find where other handlers are registered):
batchScheduler.registerHandler({
  type: 'auto-update',
  handler: AutoUpdateHandler.handle,
  enabled: true,  // Or false initially for testing
  intervalMinutes: 60,  // Run every hour
  // OR if using different scheduling system:
  name: 'auto-update',
  job: AutoUpdateHandler.handle,
  schedule: '0 * * * *',  // Cron: every hour
});
```

### 3. Verify Handler Receives Correct Parameters

Check that your batch scheduler passes:

```javascript
// The handler expects:
async function handle(params) {
  const { logger } = params;
  // logs using logger if provided
}

// So scheduler should call:
await handler({
  logger: batchLogger,
  // ... other standard batch params
});
```

### 4. Test Handler Directly

```javascript
// In Node REPL or test file:
const AutoUpdateHandler = require('./services/batch/handlers/AutoUpdateHandler');

const testResult = await AutoUpdateHandler.handle({
  logger: {
    info: (msg, data) => console.log('INFO:', msg, data),
    warn: (msg, data) => console.log('WARN:', msg, data),
    error: (msg, data) => console.log('ERROR:', msg, data),
    debug: (msg, data) => console.log('DEBUG:', msg, data),
  }
});

console.log('Result:', testResult);
// Should output:
// - Info logs about users being processed
// - Result object with { success, itemsUpdated, message, intentResults }
```

### 5. Verify Batch Results Recording

Check that results are stored:

```bash
# After handler runs:
SELECT * FROM batch_runs 
WHERE job_type = 'auto-update' 
ORDER BY id DESC LIMIT 1;

# Should show:
# - status: 'completed' or 'failed'
# - job_type: 'auto-update'
# - containers_updated: number
# - logs: JSON with results
```

### 6. Test with Real Intents

Create test intent and verify it runs:

```bash
# Create intent
curl -X POST http://localhost:3000/api/auto-update/intents \
  -H "Content-Type: application/json" \
  -d '{
    "imageRepo": "nginx",
    "enabled": true,
    "description": "Test intent"
  }'

# Let batch job run (or trigger manually)
# Check batch_runs for results
```

## Scheduler Integration Examples

### If Using Existing BatchManager Pattern

```javascript
// server/services/batch/index.js or similar
const AutoUpdateHandler = require('./handlers/AutoUpdateHandler');

module.exports = {
  handlers: {
    'docker-hub-pull': DockerHubPullHandler,
    'tracked-apps-check': TrackedAppsCheckHandler,
    'auto-update': AutoUpdateHandler,  // ADD THIS
  },
  
  // If has registration function:
  registerHandler(type, handler) {
    this.handlers[type] = handler;
  }
};
```

### If Using Node-Cron

```javascript
const cron = require('node-cron');
const AutoUpdateHandler = require('./services/batch/handlers/AutoUpdateHandler');

// Run at 00:00, 06:00, 12:00, 18:00 (every 6 hours)
cron.schedule('0 0,6,12,18 * * *', async () => {
  const logger = require('./utils/logger');
  try {
    const result = await AutoUpdateHandler.handle({ logger });
    logger.info('Auto-update batch completed', result);
  } catch (err) {
    logger.error('Auto-update batch failed', err);
  }
});
```

### If Using node-schedule

```javascript
const schedule = require('node-schedule');
const AutoUpdateHandler = require('./services/batch/handlers/AutoUpdateHandler');

// Run every hour
const job = schedule.scheduleJob('0 * * * *', async () => {
  const logger = require('./utils/logger');
  try {
    const result = await AutoUpdateHandler.handle({ logger });
    logger.info('Auto-update batch result', result);
  } catch (err) {
    logger.error('Auto-update batch error', err);
  }
});
```

### If Using Custom Scheduler

```javascript
class CustomScheduler {
  addJob(config) {
    setInterval(async () => {
      try {
        const result = await config.handler({ logger: config.logger });
        // Record result to batch_runs
        await recordBatchRun({
          job_type: config.type,
          status: result.success ? 'completed' : 'failed',
          duration_ms: result.duration,
          containers_checked: result.total,
          containers_updated: result.itemsUpdated,
          logs: JSON.stringify(result),
        });
      } catch (err) {
        // Record failure
      }
    }, config.intervalMinutes * 60 * 1000);
  }
}

// Usage:
scheduler.addJob({
  type: 'auto-update',
  handler: AutoUpdateHandler.handle,
  intervalMinutes: 60,
  logger: logger,
});
```

## Testing Checklist

### Unit Test AutoUpdateHandler

```javascript
// test/AutoUpdateHandler.test.js
const AutoUpdateHandler = require('../services/batch/handlers/AutoUpdateHandler');

describe('AutoUpdateHandler', () => {
  it('should handle empty intent list', async () => {
    const result = await AutoUpdateHandler.handle({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }
    });
    
    expect(result.success).toBe(true);
    expect(result.intentResults).toBeDefined();
  });

  it('should match containers by image repo', async () => {
    // Create test intent with imageRepo
    // Create test container with matching imageRepo
    // Run handler
    // Verify container matched
  });
});
```

### Integration Test

```javascript
// test/integration/auto-update.test.js
describe('Auto-Update Integration', () => {
  it('E2E: Create intent, run batch, verify upgrade', async () => {
    // 1. Create user and container
    // 2. Create auto-update intent
    // 3. Call handler directly
    // 4. Verify upgrade_history records
    // 5. Verify batch_runs records
  });
});
```

### Manual Verification

```bash
# 1. Check handler logs
grep -i "AutoUpdateHandler\|auto-update" logs/*.log

# 2. Check database records
SELECT * FROM auto_update_intents WHERE enabled = 1;
SELECT * FROM batch_runs WHERE job_type = 'auto-update' ORDER BY id DESC LIMIT 5;
SELECT * FROM upgrade_history WHERE auto_updated = 1 ORDER BY id DESC LIMIT 5;

# 3. Verify batch scheduler is running
# (Depends on your scheduler - check its logs/status)

# 4. API test
curl -X POST http://localhost:3000/api/auto-update/intents \
  -H "Content-Type: application/json" \
  -d '{"imageRepo": "nginx", "enabled": true}'

# 5. Wait for batch to run and check results
sleep 61  # Wait past next batch cycle
curl http://localhost:3000/api/batch/runs?jobType=auto-update
```

## Troubleshooting Integration

### Handler Not Running

```bash
# Check if scheduler is initialized
grep -i "batch.*init\|scheduler" logs/*.log

# Check if job is registered
curl http://localhost:3000/api/batch/config  # If endpoint exists

# Check handler directly
node -e "require('./services/batch/handlers/AutoUpdateHandler').handle({ logger: console })"
```

### Handler Running But No Upgrades

```javascript
// Debug: Check if intents exist
const db = require('./db');
const intents = await db.listIntents(userId, { enabledOnly: true });
console.log('Enabled intents:', intents.length);

// Check if containers exist
const containers = await db.getPortainerContainersWithUpdates(userId);
console.log('Containers with updates:', containers.filter(c => c.has_update).length);

// Check matching
const intentMatchingService = require('./services/intentMatchingService');
const intentMap = intentMatchingService.buildIntentMap(intents, containers);
console.log('Matches:', intentMap.map(m => ({ 
  intentId: m.intent.id,
  matchCount: m.matchCount 
})));
```

### Handler Crashing

```bash
# Check logs for errors
tail -f logs/error.log | grep -i "auto-update"

# Check that database is accessible
sqlite3 data/users.db "SELECT COUNT(*) FROM auto_update_intents;"

# Check that Portainer instances are configured
sqlite3 data/users.db "SELECT COUNT(*) FROM portainer_instances;"

# Run handler with verbose logging
NODE_DEBUG=*  node server.js  # May be too verbose
```

## Performance Tuning

### If Handler Takes Too Long

```javascript
// Parallel upgrades per intent (careful: more resource-intensive)
// In AutoUpdateHandler.executeIntent(), change from:
for (const container of matchedContainers) { ... }
// To:
const upgradePromises = matchedContainers.map(container => 
  performUpgrade(container)
);
const results = await Promise.allSettled(upgradePromises);
```

### If Database Queries Are Slow

```sql
-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_auto_update_intents_user_enabled 
  ON auto_update_intents(user_id, enabled);

CREATE INDEX IF NOT EXISTS idx_portainer_containers_user_has_update 
  ON portainer_containers(user_id, has_update);

-- Check query performance
EXPLAIN QUERY PLAN 
  SELECT * FROM auto_update_intents WHERE enabled = 1;
```

### If Too Many Batch Jobs Queue Up

```javascript
// Check batch queue size
db.all(
  `SELECT COUNT(*) as count FROM batch_runs WHERE status = 'pending'`,
  (err, row) => console.log('Pending jobs:', row.count)
);

// Increase interval if needed
// In registration: intervalMinutes: 120  // Run every 2 hours
```

## Monitoring

### Health Check

```javascript
// Create a health check endpoint:
app.get('/health/auto-update', async (req, res) => {
  const lastRun = await db.getBatchRun('auto-update', 1);
  const enabledIntents = await db.countEnabledIntents();
  
  return res.json({
    status: lastRun ? 'ok' : 'never-run',
    lastRun: lastRun?.completed_at,
    enabledIntents,
    nextEstimatedRun: calculateNextRun(),
  });
});
```

### Alerting

```javascript
// Alert if batch hasn't run recently
const lastRun = await db.getBatchRun('auto-update', 1);
if (lastRun && Date.now() - lastRun.completed_at > 24 * 60 * 60 * 1000) {
  alert('Auto-update batch has not run in 24 hours');
}

// Alert if intents enabled but scheduler not running
const enabledIntents = await db.countEnabledIntents();
if (enabledIntents > 0 && !schedulerRunning) {
  alert('Auto-update enabled but batch scheduler not running');
}
```

## Success Criteria

- ✅ Handler registered with scheduler
- ✅ Handler runs at expected intervals
- ✅ batch_runs records created with job_type='auto-update'
- ✅ Enabled intents are processed
- ✅ Matched containers are upgraded
- ✅ No errors in logs
- ✅ Test intent successfully enables and disables

---

**Integration complete!** Your auto-update system is now active.

# Intents, avatar and container details regressions

Investigated 2026-11-11. Source checkout: `0be9923` (`3.31.4-dev`). Public version endpoint at `https://docked.dbluee.net/api/version` reports `3.31.5-dev`. Changes below are local and have not been deployed. Preserve the deployment's newer changes when integrating this patch.

## 1–2. Missing schedule_timezone and invisible intents

The intent SELECT includes `schedule_timezone`; SQLite rejects the entire read if that column is absent. This explains why existing intents can disappear from the UI without being deleted.

The local database snapshot records schema version 15, lacks the column, and still contains two intent rows. That snapshot is not the deployed database. Migration 16 already adds the column, and the API entry point runs migrations before listening. The reported production error means the database used by that request lacks the required schema; whether this is an outdated process, a different database path, or a migration-ledger mismatch still requires authenticated server inspection.

**Implemented:** Startup now reconciles this required column even when a restored/imported ledger already records version 16 or higher. The repair is additive and idempotent. Regression tests cover both version-15 and already-version-17 ledgers, preserve the intent name, match patterns and cron, and run startup twice. Successful client refreshes also clear the previous read error.

**Deployment verification:** Confirm the running process's database path and schema ledger, inspect `PRAGMA table_info(intents)`, and record the pre-rollout intent count using the actual database. After integration and restart, verify the column, the same count, and the authenticated GraphQL intent list. Do not recreate intents or reset the database to solve this error.

## 3. Default profile picture

Three source defects were found:

- Without DATA_DIR, database defaults resolve to `/data/users.db` when `/data` exists, or `../data/users.db` in development. Both avatar reads and GraphQL upload/delete used `./data` instead.
- Legacy username-directory recovery stopped when the destination ID directory existed, even if only its recent directory existed and the current avatar was missing.
- The recent-avatar hook discarded the Go backend's URL-string entries because it expected objects with a url field.

**Implemented:** A shared data-root resolver aligns avatar operations with explicit DATA_DIR or the database directory. Legacy recovery copies missing files without overwriting current ID-keyed files. Recent entries normalize to the string format the settings components expect. Existing hostile-username migration tests remain intact.

**Deployment verification:** Verify DATA_DIR/DATABASE_PATH and the mounted avatar directory. Authenticated GET `/api/avatars` must return the user's image bytes, not an HTML login response or a 404. Check current ID-keyed and safe legacy username-keyed files. The local snapshot contains no avatar JPEGs, so it cannot establish where the user's correct production image is stored. No production avatar has been replaced or deleted.

## 4. Edit button on Apps

Commit `4492168` added a visible Edit button to tracked-app cards for keyboard access; it did not remove the existing 500 ms hold gesture. Runner AppCard does not contain that edit control.

**Implemented:** Tracked-app cards retain press-and-hold editing and their original pointer appearance. The Edit button appears on keyboard focus. Pending hold timers are cleaned up on unmount. Holding a card does not also trigger its upgrade action.

## 5. Original container information view

Found the exact original component in history: `client/src/components/containers/ContainerDebugModal.jsx`, titled **Container Details**. It displayed **Image Digest Comparison**, **Current (Deployed)**, **Registry (Latest)**, upgrade history, and developer-mode record tables. Commit `3a21017` deleted the modal, REST handler and callback chain. Later commit `a3cfb8d` connected name clicks to upgrade confirmation instead. That replacement was also gated by update availability/developer mode, leaving many name clicks inactive.

**Implemented:** Restored the inspector through a new authenticated GraphQL query, `containerDetails(containerId, runnerId)`. Every lookup includes user ownership and explicit runner identity. Same Docker IDs on different runners no longer require a first-host search. Name clicks in All, Updates and Current open the inspector independently of upgrade eligibility. The card body retains its upgrade action.

The view shows full SHA values and repository digest arrays, container/runner/image metadata, and the latest 20 upgrade records. Developer mode exposes container, deployed-image, registry and duplicate-name records, bounded to 100 rows per related list. Live-only runner containers are supported; persisted records remain a fallback when a runner cannot be reached. Closing/changing the inspector ignores late responses from the old view. Raw runner credentials are never part of this payload.

## Validation and live status

- Full backend suite and Go vet passed.
- Full client suite passed: 29 files, 234 tests, followed by targeted verification for the final intent-refresh change.
- Production client build and lint for changed client files passed.
- Chromium fixture checks passed for all three container tabs, full SHA display, Escape close, hold-to-edit and keyboard edit access. Mobile at 390 px had no horizontal overflow or page errors. These exercise current local components with mocked GraphQL responses, not the deployed service.
- Read-only production version check succeeded. The workspace's saved verification browser profile has no usable login session, so protected production intent/avatar checks remain unverified.

The public version alone cannot prove this patch is present. Complete the deployment-specific checks above after integrating into the newer deployed revision; the code changes do not alter the running instance by themselves.

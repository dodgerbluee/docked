# Cache and Update Detection System Design

## Experience Standard

### Core Principles
1. **No Flickering**: Users should never see update counts change from high to low during page load
2. **Immediate Accuracy**: When a container is upgraded (manually or via app), the UI reflects the change within 2 seconds
3. **Consistent State**: Cache and UI are always in sync - no stale data visible
4. **Progressive Enhancement**: Show cached data immediately, enhance with fresh data seamlessly
5. **Silent Updates**: Background updates should not disrupt user experience

### User Experience Requirements

#### Page Load / Navigation
- **Initial Load**: Show cached data immediately (if available)
- **Background Refresh**: Fetch fresh Portainer data in background
- **Update Detection**: Compare fresh Portainer data with cache to detect changes
- **UI Update**: Only update UI when we have definitive information (no intermediate states)

#### Container Upgrade (Manual or App)
- **Immediate**: Within 2 seconds, UI should reflect the upgrade
- **Cache Update**: Database cache updated immediately after upgrade completes
- **No Flicker**: Update count should decrease smoothly, not jump around

#### Background Scanning
- **Silent**: Updates happen in background without disrupting user
- **Batch Updates**: Update UI in batches, not one-by-one
- **Debounced**: Multiple rapid changes are batched together

## Architecture

### Cache Strategy

#### Three-Layer Cache System
1. **Database Cache** (Persistent)
   - Stores: container metadata, current digest, latest digest, update status
   - Updated: After upgrades, after pulls, after manual detection
   - Purpose: Survive restarts, provide baseline data

2. **Memory Cache** (In-Memory)
   - Stores: Recently fetched Portainer data, computed update status
   - TTL: 30 seconds
   - Purpose: Reduce Portainer API calls, provide instant responses

3. **UI State** (React State)
   - Stores: Current display state, optimistic updates
   - Updated: From cache or fresh data
   - Purpose: Smooth UI rendering

### Update Detection Flow

```
1. User Action / Page Load
   ↓
2. Check Memory Cache (if < 30s old, use it)
   ↓
3. If cache miss or stale:
   a. Fetch fresh Portainer data
   b. Fetch database cache
   c. Compare digests
   d. Update database cache with changes
   e. Update memory cache
   ↓
4. Return merged result (fresh Portainer + cached update info)
   ↓
5. UI updates with definitive data
```

### State Machine

```
Container States:
- UNKNOWN: No data available
- CACHED: Has cached data, freshness unknown
- FRESH: Has fresh Portainer data
- UPDATING: Currently being upgraded
- UP_TO_DATE: No update available
- HAS_UPDATE: Update available
```

### Cache Update Triggers

1. **After Container Upgrade**
   - Immediately update database cache with new digest
   - Invalidate memory cache for that container
   - Update UI optimistically

2. **After Portainer Fetch**
   - Compare fresh digest with cached digest
   - If different, update database cache
   - Update memory cache

3. **Periodic Background Sync**
   - Every 5 minutes, check for manual upgrades
   - Update cache silently
   - Only update UI if user is on relevant page

## Implementation Plan

### Phase 1: Cache Service
- Create unified cache service
- Implement three-layer caching
- Add cache invalidation logic

### Phase 2: Update Detection
- Implement digest comparison service
- Add change detection logic
- Create update notification system

### Phase 3: UI Integration
- Update React hooks to use new cache
- Implement optimistic updates
- Add smooth transitions

### Phase 4: Background Sync
- Implement periodic sync
- Add manual upgrade detection
- Create update batching

## Success Criteria

1. ✅ No flickering when loading pages
2. ✅ Update count is accurate within 2 seconds of upgrade
3. ✅ Manual upgrades detected within 5 seconds
4. ✅ No stale data visible to users
5. ✅ Smooth, responsive UI at all times


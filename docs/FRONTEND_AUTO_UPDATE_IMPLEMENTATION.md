# Frontend Auto-Update Intent System - Implementation Guide

## Overview

This guide covers building the React UI for the Auto-Update Intent system. The backend API is complete; this document covers the component architecture, state management, and UX flow.

## Architecture

### Components Structure

```
AutoUpdatePage/
├── AutoUpdatePage.js              # Main page (analogous to TrackedAppsPage)
├── AutoUpdatePage.module.css      # Page styles
├── IntentList.js                  # List of intents with actions
├── IntentCard.js                  # Individual intent display
├── CreateIntentModal.js           # Create/edit intent modal
├── TestMatchModal.js              # Show test-match results (dry-run)
└── IntentActions.js               # Reusable action buttons
```

### Data Flow

```
AutoUpdatePage (container)
  ├─ useState: intents, loading, error, selectedIntent
  ├─ useEffect: fetch intents on mount
  ├─ handleCreateIntent() → POST /api/auto-update/intents
  ├─ handleTestMatch() → POST /api/auto-update/intents/:id/test-match
  ├─ handleEnable() → POST /api/auto-update/intents/:id/enable
  ├─ handleDisable() → POST /api/auto-update/intents/:id/disable
  ├─ handleDelete() → DELETE /api/auto-update/intents/:id
  ├─ handleRefresh() → GET /api/auto-update/intents
  │
  ├─ <IntentList />
  │   └─ <IntentCard /> × N
  │       ├─ Display intent metadata
  │       ├─ Show match count
  │       ├─ Status indicator (enabled/disabled)
  │       └─ Action buttons
  │
  ├─ <CreateIntentModal />
  │   ├─ Form: imageRepo | stackName+serviceName | containerName
  │   ├─ Field: description
  │   ├─ Field: notifyDiscord (checkbox, Phase 2)
  │   └─ Submit → handleCreateIntent()
  │
  ├─ <TestMatchModal />
  │   ├─ Show matched containers
  │   ├─ Display "2/3 have updates"
  │   ├─ Table: container name, image, has_update, version
  │   └─ Close → return to list
  │
  └─ <ErrorModal /> (reuse existing)
```

## Component Details

### 1. AutoUpdatePage.js

```javascript
// Purpose: Main container, manages state and API calls
// Similar to: TrackedAppsPage.js, SummaryPage.js

Key responsibilities:
- Fetch intents list on mount
- Handle CRUD operations (create, read, update, delete)
- Manage UI state (modals, loading, errors)
- Trigger test-match and enable/disable operations

State:
- intents: []                    # List of user's intents
- loading: false                 # Fetching in progress
- error: null                    # Error message
- showCreateModal: false         # Create/edit modal visibility
- selectedIntent: null           # Intent being edited/tested
- showTestMatchModal: false      # Test match results modal
- testMatchResults: null         # Results from test-match endpoint
```

### 2. IntentCard.js

```javascript
// Purpose: Display single intent with status and actions
// Similar to: TrackedAppCard.js, PortainerInstanceCard.js

Props:
- intent: {id, imageRepo, stackName, serviceName, containerName, enabled, description, ...}
- onTestMatch: (intent) => void  # Open test-match modal
- onEnable: (id) => void
- onDisable: (id) => void
- onDelete: (id) => void
- onEdit: (intent) => void

Display:
- Matching criteria (one of: image repo, stack+service, container name)
- Description
- Status badge: "Enabled" (green) | "Disabled" (gray)
- Match count (from intent metadata, if available)
- Action buttons: Test Match, Enable/Disable, Delete, Edit
```

### 3. CreateIntentModal.js

```javascript
// Purpose: Create or edit an intent
// Similar to: AddTrackedAppModal, CreateUserModal

Props:
- isOpen: boolean
- intent: null | {id, imageRepo, stackName, serviceName, containerName, description, ...}
- onClose: () => void
- onSubmit: (intentData) => Promise

Form Fields:
1. Matching Criteria (radio/tabs):
   - [ ] Image Repository     → imageRepo text input
   - [ ] Stack + Service      → stackName (text) + serviceName (text)
   - [ ] Container Name       → containerName text input

2. Description (optional)
   - Text input
   - Placeholder: "Describe this intent (optional)"

3. Discord Notifications (Phase 2, checkbox group)
   - [ ] Notify on updates detected
   - [ ] Notify on success
   - [ ] Notify on failure

Validation:
- At least one matching criterion required
- imageRepo: must be valid registry format (optional docker.io prefix)
- stackName + serviceName: both required if using this criterion
- containerName: must be non-empty if using this criterion

On Submit:
- POST /api/auto-update/intents (create) or
- PATCH /api/auto-update/intents/:id (update)
- Close modal
- Refresh intent list

On Error:
- Show error message in modal (use existing ErrorDisplay)
- Keep modal open so user can edit
```

### 4. TestMatchModal.js

```javascript
// Purpose: Show what containers will match (dry-run)
// Similar to: BatchLogs (table display pattern)

Props:
- isOpen: boolean
- intent: {id, ...}
- testResults: {
    matchedCount: number
    withUpdatesCount: number
    matchedContainers: [{
      name: string
      imageRepo: string
      hasUpdate: boolean
      updateAvailable: string | null
    }]
  }
- onClose: () => void

Display:
1. Summary:
   - "Found X containers matching this intent"
   - "Y have updates available"

2. Table:
   - Column: Container Name
   - Column: Image Repository
   - Column: Update Available (yes/no, show version)
   - Column: Status (Will upgrade / No action)

3. Empty State:
   - "No containers match this intent"
   - "Create a different matching criterion"

4. Buttons:
   - "Close" → onClose()
   - "Enable Auto-Updates" → Call enable endpoint, close modal
```

### 5. IntentList.js

```javascript
// Purpose: Render list of intents with loading/empty states
// Similar to: Container list pattern in SummaryPage

Props:
- intents: Intent[]
- loading: boolean
- error: string | null
- onTestMatch: (intent) => void
- onEnable: (id) => void
- onDisable: (id) => void
- onDelete: (id) => void
- onEdit: (intent) => void

Display:
1. Loading state:
   - Show spinner or skeleton cards

2. Empty state:
   - "No auto-update intents yet"
   - "Create one to get started"
   - CTA button: "+ Create Intent"

3. Intents:
   - <IntentCard /> for each intent
   - Sorted by: enabled (true first), then by created_at (newest first)

4. Error state:
   - <ErrorDisplay message={error} />
   - "Retry" button to refresh
```

## API Integration

### Endpoints Used

```javascript
// All endpoints require authentication header (existing ctx)

// Create intent
POST /api/auto-update/intents
Body: {imageRepo?: string, stackName?: string, serviceName?: string, containerName?: string, description?: string, notifyDiscord?: boolean}
Response: {id, ...intent}

// List intents
GET /api/auto-update/intents
Response: {intents: []}

// Get single intent
GET /api/auto-update/intents/:id
Response: {id, ...intent}

// Update intent
PATCH /api/auto-update/intents/:id
Body: {imageRepo?, stackName?, serviceName?, containerName?, description?, notifyDiscord?}
Response: {id, ...updated_intent}

// Delete intent
DELETE /api/auto-update/intents/:id
Response: {success: true}

// Test matching (dry-run)
POST /api/auto-update/intents/:id/test-match
Response: {
  matchedCount: number
  withUpdatesCount: number
  matchedContainers: [{
    name: string
    imageRepo: string
    hasUpdate: boolean
    updateAvailable?: string
  }]
}

// Enable
POST /api/auto-update/intents/:id/enable
Response: {id, enabled: true, ...}

// Disable
POST /api/auto-update/intents/:id/disable
Response: {id, enabled: false, ...}
```

### Request Patterns (Copy from Existing)

Use the same fetch pattern as `TrackedAppsPage.js`:

```javascript
const response = await fetch(`${process.env.REACT_APP_SERVER}/api/auto-update/intents`, {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,  // From context/auth
  },
});

if (!response.ok) {
  const error = await response.json();
  throw new Error(error.message || 'Failed to fetch intents');
}

return response.json();
```

## Navigation Integration

### Add to Main Navigation

1. **Update `client/src/components/Header/Header.js` or `TabNavigation.js`**:
   - Add "Auto-Updates" tab/menu item
   - Route: `/auto-updates`

2. **Update `client/src/App.js`**:
   - Import `AutoUpdatePage` component
   - Add route:
     ```javascript
     <Route path="/auto-updates" element={<AutoUpdatePage />} />
     ```

3. **Update `client/src/components/HomePage/HomePage.js`** (if it has feature list):
   - Add Auto-Updates card linking to `/auto-updates`

## Styling

Follow existing patterns:

```css
/* AutoUpdatePage.module.css */

.pageContainer {
  padding: var(--spacing-lg);
  max-width: 1200px;
  margin: 0 auto;
}

.pageHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-lg);
}

.pageTitle {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--color-text-primary);
}

.createButton {
  background-color: var(--color-primary);
  color: white;
  padding: var(--spacing-md) var(--spacing-lg);
  border: none;
  border-radius: var(--border-radius-md);
  cursor: pointer;
  font-weight: 500;
}

.createButton:hover {
  background-color: var(--color-primary-dark);
}

.intentsList {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--spacing-md);
}

.emptyState {
  text-align: center;
  padding: var(--spacing-xl);
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-md);
  color: var(--color-text-secondary);
}

.statusBadge {
  display: inline-block;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.statusBadge.enabled {
  background-color: #e8f5e9;
  color: #2e7d32;
}

.statusBadge.disabled {
  background-color: #f5f5f5;
  color: #616161;
}

.actionButtons {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}

.actionButton {
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-border);
  background-color: white;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all 0.2s;
}

.actionButton:hover {
  background-color: var(--color-bg-hover);
}

.actionButton.danger {
  color: #d32f2f;
  border-color: #d32f2f;
}

.actionButton.danger:hover {
  background-color: #ffebee;
}
```

## Error Handling

Use existing `ErrorDisplay` and `ErrorModal` components:

```javascript
// In AutoUpdatePage.js
{error && (
  <ErrorDisplay 
    message={error} 
    onDismiss={() => setError(null)}
  />
)}
```

Common errors:
- "No auth token" → Redirect to login
- "Intent not found" → Remove from list, show notification
- "Matching criteria required" → Show in form validation
- "No containers match" → Show in test-match results
- "Database error" → Generic error message with retry

## UX Flow

### Creating an Intent

```
1. User clicks "+ Create Intent"
   ↓
2. CreateIntentModal opens (empty form)
   ↓
3. User selects matching criterion (imageRepo | stackName+serviceName | containerName)
   ↓
4. User fills in matching criteria + optional description
   ↓
5. User clicks "Create"
   ↓
6. POST /api/auto-update/intents
   ↓
7. If success:
   - Modal closes
   - Intent added to list (disabled by default)
   - Show success message
   ↓
8. If error:
   - Show error in modal
   - Keep modal open for editing
```

### Testing an Intent (Dry-Run)

```
1. User clicks "Test Match" on intent card
   ↓
2. POST /api/auto-update/intents/:id/test-match
   ↓
3. Show TestMatchModal with results
   - List matched containers
   - Show which have updates
   ↓
4. User can:
   - Click "Enable Auto-Updates" → enable + close
   - Click "Close" → back to list
```

### Enabling Auto-Updates

```
Option A: From test-match modal
1. User clicks "Enable Auto-Updates" in test-match
   ↓
2. POST /api/auto-update/intents/:id/enable
   ↓
3. Modal closes, intent list refreshes
   ↓
4. Intent card shows "Enabled" badge

Option B: From intent card
1. User clicks "Enable" button
   ↓
2. Show confirmation: "Enable auto-updates for this intent?"
   ↓
3. POST /api/auto-update/intents/:id/enable
   ↓
4. Intent card refreshes to show "Enabled" badge
```

## Phase 2 Features

These are documented for future implementation:

### Discord Notifications UI

```
In CreateIntentModal, add checkbox group:
- [ ] Notify on update detected
- [ ] Notify on upgrade success
- [ ] Notify on upgrade failure

In IntentCard, show notification badge if enabled:
- 🔔 (bell icon) if notifyDiscord is true
```

### Batch Job History

```
New component: BatchHistoryModal
- Show last N batch runs for this intent
- Display: timestamp, status (success/partial/failed), upgraded count
- Link to batch logs

Endpoint: GET /api/auto-update/intents/:id/batch-history
```

### Matching Visualization

```
Future enhancement: Show a diagram
- Stack/Service → Image Repo → Container names
- Display matching hierarchy with icons
```

## Testing Checklist

```
[ ] Create intent with imageRepo
    - Form validates imageRepo present
    - Intent created with enabled=false
    - Intent appears in list

[ ] Create intent with stackName + serviceName
    - Form validates both fields present
    - Intent created successfully

[ ] Create intent with containerName
    - Form validates containerName present
    - Intent created successfully

[ ] Test Match shows results
    - Displays matched container count
    - Shows which containers have updates
    - Empty state if no matches

[ ] Enable intent
    - Status changes from "Disabled" to "Enabled"
    - Button changes to "Disable"
    - Intent persists across page refresh

[ ] Disable intent
    - Status changes to "Disabled"
    - Auto-upgrade stops (in batch job)

[ ] Delete intent
    - Show confirmation dialog
    - Intent removed from list

[ ] Edit intent
    - Click "Edit" on card
    - Modal opens with current values
    - Can change description, matching criteria
    - PATCH request on save

[ ] Error handling
    - Network error → show error banner
    - Validation error → show in form
    - Server error → show error modal with retry

[ ] Auth
    - Without token → redirect to login
    - With expired token → refresh and retry
```

## Implementation Order

Recommended implementation order:

1. **AutoUpdatePage + IntentList** (20 min)
   - Container + list display
   - Basic fetch logic

2. **IntentCard** (15 min)
   - Display intent metadata
   - Status badge
   - Action button placeholders

3. **CreateIntentModal** (30 min)
   - Form with tabs/radio for matching criteria
   - Validation logic
   - Submit handler

4. **TestMatchModal** (20 min)
   - Display test-match results
   - Table of containers
   - Enable button

5. **Integration** (15 min)
   - Add route to App.js
   - Add navigation menu item
   - Test end-to-end

**Total time: ~100 minutes (1.5-2 hours)**

## Code Examples

### Basic Component Template

```javascript
// AutoUpdatePage.js
import { useState, useEffect } from 'react';
import styles from './AutoUpdatePage.module.css';
import IntentList from './IntentList';
import CreateIntentModal from './CreateIntentModal';
import TestMatchModal from './TestMatchModal';
import ErrorDisplay from '../ErrorDisplay/ErrorDisplay';
import { useAuth } from '../../contexts/AuthContext'; // or your auth context

export default function AutoUpdatePage() {
  const { token } = useAuth();
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTestMatchModal, setShowTestMatchModal] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState(null);
  const [testMatchResults, setTestMatchResults] = useState(null);

  // Fetch intents on mount
  useEffect(() => {
    fetchIntents();
  }, []);

  const fetchIntents = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (!response.ok) throw new Error('Failed to fetch intents');
      const data = await response.json();
      setIntents(data.intents || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateIntent = async (intentData) => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(intentData)
        }
      );
      if (!response.ok) throw new Error('Failed to create intent');
      setShowCreateModal(false);
      await fetchIntents();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTestMatch = async (intent) => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents/${intent.id}/test-match`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (!response.ok) throw new Error('Failed to test match');
      const results = await response.json();
      setTestMatchResults(results);
      setSelectedIntent(intent);
      setShowTestMatchModal(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEnable = async (id) => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents/${id}/enable`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (!response.ok) throw new Error('Failed to enable intent');
      await fetchIntents();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDisable = async (id) => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents/${id}/disable`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (!response.ok) throw new Error('Failed to disable intent');
      await fetchIntents();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this auto-update intent?')) {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_SERVER}/api/auto-update/intents/${id}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );
        if (!response.ok) throw new Error('Failed to delete intent');
        await fetchIntents();
      } catch (err) {
        setError(err.message);
      }
    }
  };

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Auto-Update Intents</h1>
        <button
          className={styles.createButton}
          onClick={() => setShowCreateModal(true)}
        >
          + Create Intent
        </button>
      </div>

      {error && (
        <ErrorDisplay
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      <IntentList
        intents={intents}
        loading={loading}
        error={error}
        onTestMatch={handleTestMatch}
        onEnable={handleEnable}
        onDisable={handleDisable}
        onDelete={handleDelete}
      />

      <CreateIntentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateIntent}
      />

      <TestMatchModal
        isOpen={showTestMatchModal}
        intent={selectedIntent}
        results={testMatchResults}
        onClose={() => setShowTestMatchModal(false)}
        onEnable={() => {
          handleEnable(selectedIntent.id);
          setShowTestMatchModal(false);
        }}
      />
    </div>
  );
}
```

---

## Summary

The frontend implementation is straightforward:

1. **5 components**: Page container, list view, card, create modal, test-match modal
2. **Follow existing patterns**: Use TrackedAppsPage, CreateUserModal as templates
3. **API integration**: 8 endpoints (create, read, update, delete, test-match, enable, disable)
4. **UX flow**: Create intent → Test match → Enable → Auto-update runs
5. **~2 hours**: Full implementation time with styling and error handling

All backend APIs are ready. Frontend can be built independently without waiting for batch scheduler integration.

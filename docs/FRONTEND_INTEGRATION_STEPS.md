# Frontend Integration - Auto-Update Intent UI

## Quick Integration Steps

Follow these 4 steps to add the auto-update UI to your app:

### Step 1: Import the Page Component

Open `client/src/App.js` and add the import:

```javascript
import AutoUpdatePage from './pages/AutoUpdatePage/AutoUpdatePage';
```

### Step 2: Add the Route

In your Routes section (typically in App.js or a Router component), add:

```javascript
<Route path="/auto-updates" element={<AutoUpdatePage />} />
```

**Example Route List:**
```javascript
<Routes>
  <Route path="/" element={<HomePage />} />
  <Route path="/summary" element={<SummaryPage />} />
  <Route path="/portainer" element={<PortainerPage />} />
  <Route path="/tracked-apps" element={<TrackedAppsPage />} />
  <Route path="/auto-updates" element={<AutoUpdatePage />} />  {/* ADD THIS */}
  <Route path="/batch" element={<BatchPage />} />
  <Route path="/admin" element={<AdminPage />} />
  <Route path="/settings" element={<SettingsPage />} />
  <Route path="/analytics" element={<AnalyticsPage />} />
  <Route path="/logs" element={<LogsPage />} />
</Routes>
```

### Step 3: Add Navigation Menu Item

Find your navigation component (likely `Header.js` or `TabNavigation.js`).

Add a new nav item pointing to `/auto-updates`:

**Example (if using tab/menu structure):**
```javascript
// In Header.js or TabNavigation.js

const navItems = [
  { path: '/', label: 'Home' },
  { path: '/summary', label: 'Summary' },
  { path: '/portainer', label: 'Portainer' },
  { path: '/tracked-apps', label: 'Tracked Apps' },
  { path: '/auto-updates', label: 'Auto-Updates' },  {/* ADD THIS */}
  { path: '/batch', label: 'Batch' },
  { path: '/admin', label: 'Admin' },
  { path: '/settings', label: 'Settings' },
];
```

**Example (if using Link components):**
```javascript
<Link to="/auto-updates" className={styles.navLink}>
  Auto-Updates
</Link>
```

### Step 4: Verify Environment Variables

Ensure `REACT_APP_SERVER` is set in your `.env.local` or `.env`:

```
REACT_APP_SERVER=http://localhost:3000
```

(or your production backend URL)

---

## File Structure

The new files are organized as:

```
client/src/
├── pages/
│   └── AutoUpdatePage/                    [NEW DIRECTORY]
│       ├── AutoUpdatePage.js              [Main page component]
│       ├── AutoUpdatePage.module.css      [Page styles]
│       └── components/
│           ├── IntentList.js
│           ├── IntentList.module.css
│           ├── IntentCard.js
│           ├── IntentCard.module.css
│           ├── CreateIntentModal.js
│           ├── CreateIntentModal.module.css
│           ├── TestMatchModal.js
│           └── TestMatchModal.module.css
```

**Total new files: 9**
- 1 page component (AutoUpdatePage.js + .module.css)
- 4 feature components (IntentList, IntentCard, CreateIntentModal, TestMatchModal)
- 4 CSS modules (one per component + page)

---

## Component Dependencies

The components only depend on:
- React (useState, useEffect) - already installed
- CSS Modules - already supported
- Standard fetch API - already available
- localStorage - for auth token (existing pattern in your app)

**No additional npm packages required.**

---

## Authentication

The components use localStorage to get the auth token:

```javascript
const token = localStorage.getItem('authToken') || localStorage.getItem('token');
```

Adjust this line if your app uses a different storage key or auth context:

```javascript
// If using Auth Context (recommended):
const { token } = useAuth();  // or const token = useContext(AuthContext).token

// If using a custom hook:
const token = useAuthToken();

// If using Redux or other state management:
const token = useSelector(state => state.auth.token);
```

---

## Testing the Integration

### 1. Verify Files Are Copied

```bash
# Should exist:
ls client/src/pages/AutoUpdatePage/AutoUpdatePage.js
ls client/src/pages/AutoUpdatePage/components/IntentList.js
# ... etc for all 9 files
```

### 2. Start the Development Server

```bash
cd client
npm start
```

### 3. Navigate to the Page

Visit: `http://localhost:3000/auto-updates`

You should see:
- Empty state with "Create Intent" button
- Heading: "Auto-Update Intents"

### 4. Test Creating an Intent

1. Click "+ Create Intent"
2. Modal should open
3. Fill in matching criteria (e.g., imageRepo: "nginx")
4. Click "Create Intent"
5. Intent should appear in list with "Disabled" status

### 5. Test Matching

1. Click "🧪 Test Match" on an intent card
2. Modal should show matched containers
3. Shows count of containers with available updates

### 6. Test Enable/Disable

1. Click "▶ Enable" button
2. Badge should change to "✓ Enabled"
3. Click "⏸ Disable" to disable again

### 7. Check Backend Logs

The backend API calls should be visible in server logs:
```
POST /api/auto-update/intents
GET /api/auto-update/intents
POST /api/auto-update/intents/:id/test-match
POST /api/auto-update/intents/:id/enable
```

---

## Troubleshooting

### Issue: "Failed to fetch intents" error

**Cause**: Backend not running or wrong REACT_APP_SERVER URL

**Fix**:
```bash
# Verify backend is running
npm run dev  # in server directory

# Check REACT_APP_SERVER in .env.local
echo $REACT_APP_SERVER
```

### Issue: 401 Unauthorized errors

**Cause**: Auth token not being sent or expired

**Fix**:
```javascript
// In AutoUpdatePage.js, verify token is available:
const token = localStorage.getItem('authToken') || localStorage.getItem('token');
console.log('Token:', token ? 'Present' : 'Missing');

// If missing, user may need to login first
```

### Issue: Modal not opening

**Cause**: State not updating properly

**Fix**: Check browser console for errors. Ensure no CSS conflicts.

### Issue: Styling looks broken

**Cause**: CSS Module imports not working or design tokens not available

**Fix**:
```bash
# Rebuild CSS Modules:
npm start

# Check browser DevTools for CSS syntax errors
# Verify .module.css files exist in the components directory
```

---

## Next Steps After Integration

### Immediate (Day 1)
- [ ] Copy all 9 files to correct locations
- [ ] Update App.js with route
- [ ] Add navigation menu item
- [ ] Test basic CRUD operations
- [ ] Verify backend API calls in network tab

### Short-term (This Week)
- [ ] Deploy backend with batch scheduler integration (see INTEGRATION_CHECKLIST.md)
- [ ] Test end-to-end: Create intent → Enable → Batch job runs
- [ ] Verify database records are created

### Future Enhancements (Phase 2)
- [ ] Add Discord notification options (checkboxes in CreateIntentModal)
- [ ] Show batch job history for each intent
- [ ] Add matching visualization diagram
- [ ] Support for editing existing intents
- [ ] Bulk enable/disable operations

---

## File Reference

Each component includes JSDoc comments explaining:
- Purpose
- Props (with types)
- Behavior
- API endpoints called

**Start with AutoUpdatePage.js** - it documents the overall structure.

---

## Support

If you encounter issues:

1. **Check Network Tab** in browser DevTools
   - Verify requests are being made
   - Check response status (401, 400, 500, etc.)
   - Read response message for details

2. **Check Browser Console**
   - Look for JavaScript errors
   - Check if token is present in localStorage

3. **Check Server Logs**
   - Verify POST/GET endpoints are being called
   - Check for database errors
   - Verify auth middleware is passing

4. **Verify Files**
   - All 9 files exist in correct locations
   - No typos in import paths
   - CSS Module extensions are `.module.css`

---

## Example File Paths (for copy-paste)

```bash
# From source (docs):
/Users/dodgerbluee/dev/docked/docs/FRONTEND_AUTO_UPDATE_IMPLEMENTATION.md

# Component files (already created):
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/AutoUpdatePage.js
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/AutoUpdatePage.module.css
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/components/IntentList.js
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/components/IntentList.module.css
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/components/IntentCard.js
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/components/IntentCard.module.css
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/components/CreateIntentModal.js
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/components/CreateIntentModal.module.css
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/components/TestMatchModal.js
/Users/dodgerbluee/dev/docked/client/src/pages/AutoUpdatePage/components/TestMatchModal.module.css
```

---

## Quick Copy Command

To copy all frontend files to the correct location:

```bash
# Files are already in correct location, just verify:
cd /Users/dodgerbluee/dev/docked
ls -la client/src/pages/AutoUpdatePage/
```

All files should be present.

---

## Questions?

Refer to:
- **FRONTEND_AUTO_UPDATE_IMPLEMENTATION.md** - Detailed component architecture
- **AUTO_UPDATE_INTENT_QUICKSTART.md** - Feature overview
- **AUTO_UPDATE_INTENT_IMPLEMENTATION.md** - Backend API reference

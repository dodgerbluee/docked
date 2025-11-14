# Frontend Tech Debt & Future Improvements

## Priority 1: Complete Migration to New Patterns

### Hook Migration
- [ ] **Migrate all hooks to use centralized API client**
  - `usePortainerInstances.js` - Replace direct axios calls
  - `useContainers.js` - Replace direct axios calls
  - `useTrackedImages.js` - Replace direct axios calls
  - `useBatchProcessing.js` - Replace direct axios calls
  - `useDockerHubCredentials.js` - Replace direct axios calls
  - `useDiscordSettings.js` - Replace direct axios calls
  - `useGeneralSettings.js` - Replace direct axios calls
  - `useUserSettings.js` - Replace direct axios calls
  - `useAvatarManagement.js` - Replace direct axios calls

- [ ] **Apply domain models to all data transformations**
  - Use `PortainerInstance.fromApiArray()` in portainer hooks
  - Use `Container.fromApiArray()` in container hooks
  - Use `TrackedImage.fromApiArray()` in tracked image hooks
  - Use `BatchRun.fromApiArray()` in batch hooks

- [ ] **Add typed error handling to all hooks**
  - Replace generic error handling with typed error checks
  - Use `getErrorMessage()` for user-facing messages
  - Handle specific error types appropriately

### Component Updates
- [ ] **Update components to use domain models**
  - Replace direct data access with model methods
  - Use typed error handling in error displays

- [ ] **Remove direct axios imports**
  - Replace with API client imports
  - Remove axios default header manipulation

## Priority 2: Testing Infrastructure

### Unit Tests
- [ ] **API Client Tests**
  - Test request interceptors
  - Test response interceptors
  - Test error transformation
  - Test authentication token injection

- [ ] **Error Handling Tests**
  - Test error class inheritance
  - Test error type checking utilities
  - Test error message extraction

- [ ] **Validation Tests**
  - Test all validation functions
  - Test edge cases
  - Test sanitization functions

- [ ] **Domain Model Tests**
  - Test model creation from API responses
  - Test array transformations
  - Test data normalization

### Integration Tests
- [ ] **Hook Tests**
  - Test hooks with mocked API client
  - Test error handling in hooks
  - Test state management

- [ ] **Component Tests**
  - Test Login component
  - Test error boundary
  - Test form validation

### E2E Tests
- [ ] **Critical User Flows**
  - Login flow
  - Container management
  - Settings updates
  - Error scenarios

## Priority 3: Performance Optimizations

### Code Splitting
- [ ] **Route-based code splitting**
  - Lazy load page components
  - Reduce initial bundle size

- [ ] **Component lazy loading**
  - Lazy load heavy components (modals, charts)
  - Use React.lazy() and Suspense

### Memoization
- [ ] **Add React.memo to expensive components**
  - Identify re-render hotspots
  - Memoize components that receive stable props

- [ ] **Optimize hook dependencies**
  - Review useCallback/useMemo usage
  - Reduce unnecessary re-renders

### Virtualization
- [ ] **Implement virtual scrolling**
  - For large container lists
  - For batch run history
  - For tracked images list

### Request Optimization
- [ ] **Add request debouncing/throttling**
  - For search inputs
  - For filter changes
  - For auto-refresh operations

- [ ] **Implement request caching**
  - Cache API responses where appropriate
  - Invalidate cache on mutations

## Priority 4: Enhanced Observability

### Error Tracking
- [ ] **Integrate error reporting service**
  - Sentry or similar
  - Capture error boundary errors
  - Capture API errors
  - Add user context

### Performance Monitoring
- [ ] **Add performance metrics**
  - Measure API call durations
  - Track component render times
  - Monitor bundle sizes

### Logging
- [ ] **Structured logging service**
  - Replace console.log with structured logger
  - Add log levels
  - Add correlation IDs
  - Send logs to backend in production

### Analytics (Optional)
- [ ] **User analytics**
  - Track user actions (if privacy policy allows)
  - Measure feature usage
  - Identify UX issues

## Priority 5: Type Safety

### TypeScript Migration
- [ ] **Consider TypeScript migration**
  - Evaluate migration effort
  - Create migration plan
  - Start with new files
  - Gradually migrate existing code

### PropTypes
- [ ] **Add PropTypes to all components**
  - Define prop types
  - Add prop validation
  - Document component APIs

### JSDoc
- [ ] **Add comprehensive JSDoc**
  - Document all public APIs
  - Add type annotations
  - Add usage examples

## Priority 6: Security Enhancements

### Input Sanitization
- [ ] **Enhanced XSS prevention**
  - Use DOMPurify for HTML sanitization
  - Review all user input handling
  - Add Content Security Policy headers

### Token Security
- [ ] **Improve token storage**
  - Consider httpOnly cookies (requires backend changes)
  - Add token refresh mechanism
  - Implement token rotation

### Security Headers
- [ ] **Add security headers**
  - CSP headers
  - X-Frame-Options
  - X-Content-Type-Options

## Priority 7: Developer Experience

### Documentation
- [ ] **API documentation**
  - Document all API client methods
  - Add usage examples
  - Document error handling patterns

- [ ] **Component documentation**
  - Document component props
  - Add Storybook stories
  - Create component library

### Development Tools
- [ ] **Add development tools**
  - React DevTools profiling
  - Redux DevTools (if state management added)
  - API mocking for development

### Code Quality
- [ ] **Add ESLint rules**
  - Stricter rules for production code
  - Import ordering
  - Consistent code style

- [ ] **Add Prettier**
  - Consistent code formatting
  - Pre-commit hooks

## Priority 8: State Management

### Consider State Management Library
- [ ] **Evaluate state management needs**
  - Current state: useState/useContext
  - Consider Redux/Zustand if complexity grows
  - Evaluate React Query for server state

### Context Optimization
- [ ] **Optimize context usage**
  - Split contexts by domain
  - Prevent unnecessary re-renders
  - Use context selectors

## Priority 9: Accessibility

### ARIA Improvements
- [ ] **Enhance ARIA attributes**
  - Add proper labels
  - Improve keyboard navigation
  - Add focus management

### Screen Reader Support
- [ ] **Test with screen readers**
  - Ensure all content is accessible
  - Add appropriate announcements
  - Test keyboard navigation

## Priority 10: Build & Deployment

### Build Optimization
- [ ] **Optimize build process**
  - Tree shaking
  - Minification
  - Asset optimization
  - Source maps for production debugging

### Environment Management
- [ ] **Improve environment handling**
  - Validate environment variables
  - Add environment-specific configs
  - Document required variables

### CI/CD
- [ ] **Add CI/CD pipeline**
  - Automated testing
  - Linting checks
  - Build verification
  - Deployment automation

## Notes

- **Migration Strategy**: Migrate hooks incrementally, starting with most-used ones
- **Testing Strategy**: Start with critical paths, expand coverage gradually
- **Performance**: Profile first, optimize based on data
- **Type Safety**: TypeScript migration should be evaluated carefully for effort vs. benefit
- **Security**: Prioritize based on risk assessment


# CI/CD Documentation

This document describes the CI/CD (Continuous Integration/Continuous Deployment) system for the Docked project.

## Overview

The Docked project uses GitHub Actions for CI/CD. The system is designed to:

- **Ensure code quality** through automated testing, linting, and security scanning
- **Automate releases** with semantic versioning and changelog generation
- **Maintain security** through dependency scanning and vulnerability detection
- **Provide visibility** into build status and deployment health

## Workflow Architecture

### Workflow Organization

```
.github/workflows/
├── ci.yml                          # Main CI pipeline (GitLab-style)
├── release.yml                     # Production release workflow (tag-based)
├── pre-release.yml                 # Development pre-release workflow
├── promote-dev-to-production.yml   # ⭐ Promote dev to production (recommended)
├── promote-to-latest.yml           # Quick promote dev to latest (re-tag only)
├── security.yml                    # Scheduled security scanning
├── docker-build.yml                # Docker image building
└── reusable/                       # Reusable workflow templates
    ├── setup-node.yml              # Node.js setup
    ├── run-tests.yml               # Test execution
    └── run-linting.yml             # Linting and formatting
```

### Workflow Types

#### 1. Continuous Integration (CI)

**CI Pipeline** (`.github/workflows/ci.yml`) - GitLab-style single pipeline
- Triggers: Pull requests and pushes to main/master
- Purpose: Unified CI pipeline for all code changes
- Jobs (run in parallel, then build depends on lint/test):
  - **validate-pr-title**: PR title validation (PRs only)
  - **lint**: Linting and formatting checks
  - **test**: Unit and integration tests with coverage
  - **security**: Security scanning (npm audit, Snyk, CodeQL)
  - **build**: Build validation (depends on lint/test)
  - **validate-changelog**: Changelog validation if version changed (PRs only)
  - **all-checks**: Final gate ensuring all checks passed

#### 2. Continuous Deployment (CD)

**Pre-Release** (`.github/workflows/pre-release.yml`)
- Triggers: Pushes to main/master
- Purpose: Create development releases
- Actions:
  - Auto-increment version based on commits
  - Build and push Docker images with `-dev` tag
  - Create GitHub pre-release
  - Tag repository

**Release** (`.github/workflows/release.yml`)
- Triggers: Tag push (v*.*.*) or manual dispatch
- Purpose: Create production releases
- Actions:
  - Extract version from tag
  - Run tests and security scans
  - Build application artifacts
  - Build and push Docker images
  - Generate changelog
  - Create GitHub release

**Promote Dev to Production** (`.github/workflows/promote-dev-to-production.yml`) ⭐ Recommended
- Triggers: Manual workflow dispatch
- Purpose: One-click promotion from dev to production
- Actions:
  - Validates permissions (admin/owner only)
  - Extracts version from latest dev tag (or uses override)
  - Runs full test suite and security scans
  - Builds production artifacts and Docker images
  - Creates git tag and GitHub release
  - Tags Docker image as version and `latest`

**Promote to Latest** (`.github/workflows/promote-to-latest.yml`)
- Triggers: Manual workflow dispatch
- Purpose: Quick promotion - just re-tag existing dev image as `latest`
- Actions:
  - Validate permissions
  - Re-tag dev Docker image as `latest` (no rebuild)
  - Optionally create GitHub release
- Use case: When dev build is already good and you just need to update `latest` tag

#### 3. Security

**Security Scan** (`.github/workflows/security.yml`)
- Triggers: Push, PR, schedule (weekly), manual
- Purpose: Security vulnerability scanning
- Scans:
  - Dependency review (PRs)
  - npm audit
  - Snyk security scan
  - CodeQL analysis

## Reusable Workflows

Reusable workflows reduce duplication and ensure consistency:

### Setup Node.js
**File**: `.github/workflows/reusable/setup-node.yml`

Sets up Node.js environment and installs dependencies.

**Inputs:**
- `node-version`: Node.js version (required)
- `cache-dependency-paths`: Package lock file paths (optional)

**Usage:**
```yaml
jobs:
  setup:
    uses: ./.github/workflows/reusable/setup-node.yml
    with:
      node-version: '18'
```

### Run Tests
**File**: `.github/workflows/reusable/run-tests.yml`

Runs tests for both server and client.

**Inputs:**
- `node-version`: Node.js version (required)
- `run-coverage`: Run with coverage (default: false)
- `upload-coverage`: Upload to Codecov (default: false)

**Outputs:**
- `server-tests-passed`: Whether server tests passed
- `client-tests-passed`: Whether client tests passed

**Usage:**
```yaml
jobs:
  test:
    uses: ./.github/workflows/reusable/run-tests.yml
    with:
      node-version: '18'
      run-coverage: true
      upload-coverage: true
```

### Run Linting
**File**: `.github/workflows/reusable/run-linting.yml`

Runs ESLint and optionally checks formatting.

**Inputs:**
- `node-version`: Node.js version (required)
- `check-formatting`: Check code formatting (default: false)

**Usage:**
```yaml
jobs:
  lint:
    uses: ./.github/workflows/reusable/run-linting.yml
    with:
      node-version: '18'
      check-formatting: true
```

## Branch Strategy

### Main Branch
- **Purpose**: Production-ready code
- **Protection**: Required PR reviews, status checks
- **Workflows**: CI on push, pre-release on merge

### Release Branches
- **Purpose**: Stabilize releases (future enhancement)
- **Naming**: `release/vX.Y.Z`
- **Workflows**: Release candidate builds

### Hotfix Branches
- **Purpose**: Critical bug fixes
- **Naming**: `hotfix/vX.Y.Z`
- **Workflows**: Fast-track release

## Version Management

### Semantic Versioning

Docked follows [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features, backward compatible
- **PATCH** (0.0.X): Bug fixes, backward compatible

### Version Bumping

**Automated** (pre-release):
- Analyzes commits since last release
- Determines increment type (major/minor/patch)
- Creates dev version (e.g., `1.2.3-dev`)

**Manual** (release):
- Use `scripts/version-bump.js`
- Creates version tag (e.g., `v1.2.3`)

### Version Scripts

**Version Bump** (`scripts/version-bump.js`)
```bash
node scripts/version-bump.js 1.2.3
```

Updates version in all `package.json` files.

**Release Validation** (`scripts/validate-release.js`)
```bash
node scripts/validate-release.js
```

Validates release readiness:
- Version consistency
- CHANGELOG entry
- Tests passing
- Build successful

## Security

### Security Checks

All security checks are **blocking** (fail on vulnerabilities):

1. **Dependency Review**: Scans PR dependencies
2. **npm audit**: Checks for known vulnerabilities
3. **Snyk**: Advanced security scanning
4. **CodeQL**: Static code analysis

### Security Workflow

The security workflow runs:
- On every PR (dependency review)
- On push to main (full scan)
- Weekly schedule (maintenance)
- Manual trigger

### Security Policy

See [SECURITY.md](../SECURITY.md) for:
- Vulnerability reporting
- Supported versions
- Security best practices

## Docker Images

### Image Tags

- `:latest` - Latest stable release
- `:dev` - Latest development build
- `:X.Y.Z` - Specific version
- `:X.Y` - Minor version tag
- `:X` - Major version tag

### Multi-Architecture

Docker images are built for:
- `linux/amd64`
- `linux/arm64`

### Registry

Images are published to:
- GitHub Container Registry (`ghcr.io/your-org/docked`)

## Release Process

### Development Release (Pre-Release)

1. **Trigger**: Push to main/master
2. **Version**: Auto-incremented based on commits
3. **Tag**: `vX.Y.Z-dev`
4. **Docker**: Tagged as `X.Y.Z-dev` and `dev`
5. **GitHub**: Pre-release created

### Production Release

1. **Trigger**: Tag push (`vX.Y.Z`) or manual dispatch
2. **Validation**: Tests, security scans, build
3. **Artifacts**: Source tarball, checksums
4. **Docker**: Tagged with version and semver tags
5. **GitHub**: Release created with changelog

### Promotion to Latest

1. **Trigger**: Manual workflow dispatch
2. **Validation**: Permissions, dev image exists
3. **Action**: Tag dev image as `latest`
4. **Optional**: Create GitHub release

See [RELEASE.md](../RELEASE.md) for detailed release process.

## Monitoring and Observability

### Build Status

- GitHub Actions provides build status badges
- PR checks show status inline
- Workflow runs are visible in Actions tab

### Artifacts

Build artifacts are uploaded for:
- Client build (`client-build`)
- Release artifacts (`release-artifacts`)
- Test coverage reports

### Logs

- Structured logging in workflows
- Step-by-step execution logs
- Error messages with context

### Metrics

- Test coverage tracked in Codecov
- Build duration visible in Actions
- Success/failure rates in Insights

## Troubleshooting

### Common Issues

**Tests Failing**
- Check test output in Actions logs
- Run tests locally: `npm test`
- Verify Node.js version matches

**Security Checks Failing**
- Review vulnerability details
- Update dependencies: `npm audit fix`
- Check Snyk dashboard for details

**Build Failing**
- Check build logs for errors
- Verify all dependencies installed
- Check Node.js version compatibility

**Release Failing**
- Verify version format (SemVer)
- Check CHANGELOG.md has entry
- Ensure all tests pass

### Getting Help

- Check workflow logs in GitHub Actions
- Review [RELEASE.md](../RELEASE.md)
- Open an issue with workflow name and error

## Best Practices

### For Developers

1. **Run checks locally** before pushing
   ```bash
   npm test
   npm run lint
   ```

2. **Follow conventional commits** for PR titles
   - `feat:`, `fix:`, `docs:`, etc.

3. **Update CHANGELOG.md** when version changes

4. **Keep dependencies updated** via Dependabot PRs

5. **Review security alerts** promptly

### For Maintainers

1. **Monitor workflow runs** regularly
2. **Review Dependabot PRs** weekly
3. **Update workflow actions** quarterly
4. **Document workflow changes** in PRs
5. **Test workflows** before merging

## Maintenance

### Updating Workflows

1. Test changes in a branch
2. Create PR with workflow changes
3. Review workflow run results
4. Merge after approval

### Updating Actions

Actions are versioned. Update carefully:
- Test in development branch first
- Review changelog for breaking changes
- Update all workflows using the action

### Dependency Updates

Dependabot automatically creates PRs for:
- npm dependencies (weekly)
- GitHub Actions (weekly)
- Docker base images (weekly)

Review and merge regularly.

## Future Enhancements

Planned improvements:

- [ ] Release branch workflow
- [ ] Environment-specific deployments (dev/staging/prod)
- [ ] Smoke tests after deployment
- [ ] Performance benchmarking
- [ ] Bundle size tracking
- [ ] Accessibility testing
- [ ] Workflow analytics dashboard

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [RELEASE.md](../RELEASE.md)
- [SECURITY.md](../SECURITY.md)

---

**Last Updated**: 2025-01-XX


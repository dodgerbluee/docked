# Release Process

This document describes the release process for Docked, following best practices for open source software releases.

## Release Schedule

- **Stable Releases**: Monthly (first Monday of each month)
- **Patch Releases**: As needed for critical bug fixes or security updates
- **Pre-releases**: Alpha, beta, and release candidates as needed

## Version Numbering

We follow [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features, backward compatible
- **PATCH** (0.0.X): Bug fixes, backward compatible

### Pre-release Versions

- **Alpha**: `1.2.3-alpha.1` - Early development, may be unstable
- **Beta**: `1.2.3-beta.1` - Feature complete, testing phase
- **RC**: `1.2.3-rc.1` - Release candidate, final testing

## Release Process

### 1. Pre-Release Preparation

1. **Update version numbers**
   ```bash
   node scripts/version-bump.js 1.2.3
   ```

2. **Update CHANGELOG.md**
   - Add new version section
   - Document all changes
   - Highlight breaking changes
   - Include migration notes if needed

3. **Run validation**
   ```bash
   node scripts/validate-release.js
   ```

4. **Create release branch** (for major releases)
   ```bash
   git checkout -b release/v1.2.3
   ```

### 2. Testing

- [ ] All automated tests pass
- [ ] Manual testing completed
- [ ] Security scan completed
- [ ] Performance benchmarks acceptable
- [ ] Documentation reviewed

### 3. Creating the Release

#### Option A: Automated Release (Recommended)

1. **Create and push tag**
   ```bash
   git tag -a v1.2.3 -m "Release v1.2.3"
   git push origin v1.2.3
   ```

2. **GitHub Actions will automatically:**
   - Run tests
   - Run security scans
   - Build artifacts
   - Build Docker images
   - Generate changelog
   - Create GitHub release

#### Option B: Manual Release

1. Go to GitHub Actions
2. Select "Release" workflow
3. Click "Run workflow"
4. Enter version number (e.g., `1.2.3`)
5. Select release type (stable or pre-release)
6. Click "Run workflow"

### 4. Post-Release

1. **Monitor release health**
   - Check application logs
   - Monitor error rates
   - Review user feedback

2. **Update documentation**
   - Update installation guides if needed
   - Update API documentation
   - Update examples

3. **Announce release**
   - GitHub release notes (automatic)
   - Social media (if applicable)
   - Mailing list (if applicable)

4. **Plan next release**
   - Review roadmap
   - Prioritize features
   - Schedule next release

## Release Checklist

Use the [Release Checklist Issue Template](.github/ISSUE_TEMPLATE/release_checklist.md) for each release.

## Hotfix Process

For urgent bug fixes or security patches:

1. **Create hotfix branch from main**
   ```bash
   git checkout -b hotfix/v1.2.4 main
   ```

2. **Make fix and test**
   ```bash
   # Make changes
   npm test
   ```

3. **Update version**
   ```bash
   node scripts/version-bump.js 1.2.4
   ```

4. **Update CHANGELOG**
   - Add entry for patch version
   - Document the fix

5. **Merge and release**
   ```bash
   git commit -m "fix: description of fix"
   git tag -a v1.2.4 -m "Hotfix v1.2.4"
   git push origin hotfix/v1.2.4
   git push origin v1.2.4
   ```

6. **Merge back to main**
   ```bash
   git checkout main
   git merge hotfix/v1.2.4
   git push origin main
   ```

## Breaking Changes

When making breaking changes:

1. **Deprecate in advance**
   - Add deprecation warnings
   - Document migration path
   - Give users time to migrate

2. **Major version bump**
   - Increment MAJOR version
   - Create migration guide
   - Provide upgrade path

3. **Clear communication**
   - Highlight in release notes
   - Provide examples
   - Offer support

## Security Releases

For security vulnerabilities:

1. **Immediate response**
   - Create security advisory
   - Prepare patch release
   - Coordinate disclosure

2. **Fast-track release**
   - Skip normal release cycle
   - Prioritize security fix
   - Release as soon as tested

3. **Communication**
   - Security advisory published
   - Users notified
   - CVE assigned (if applicable)

## Release Artifacts

Each release includes:

- Source code tarball (`.tar.gz`)
- SHA256 checksums
- Docker images (multiple architectures)
- GitHub release page
- Changelog
- Upgrade guide

## Rollback Procedure

If a release has critical issues:

1. **Identify the issue**
   - Document the problem
   - Assess impact
   - Determine if rollback needed

2. **Communicate**
   - Notify users
   - Provide workaround if possible
   - Set expectations

3. **Rollback**
   - Tag previous stable version
   - Update documentation
   - Prepare hotfix

## Release Signing

Release artifacts are signed with GPG (when configured):

```bash
# Verify signature
gpg --verify docked-1.2.3-source.tar.gz.asc
```

## Support

For release-related questions:

- Open an issue on GitHub
- Check existing documentation
- Review previous releases

## References

- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [Release Processes Rubric](rubric/release-processes.md)


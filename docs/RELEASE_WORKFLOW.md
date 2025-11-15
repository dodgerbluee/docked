# Release Workflow Guide

This guide explains the different ways to create releases in the Docked project.

## Release Flow Overview

```
Development → Dev Build → Testing → Production Release
     ↓              ↓           ↓              ↓
  Push to main  Pre-Release  Manual Test  Promote/Release
```

## Workflow Options

### 1. Development Builds (Automatic)

**Workflow**: `pre-release.yml`  
**Trigger**: Push to `main` branch  
**Creates**:

- Dev tag: `v1.2.3-dev`
- Docker image: `:dev`
- GitHub pre-release

**When to use**: Automatic - happens on every push to main

---

### 2. Production Releases

You have **three options** for creating production releases:

#### Option A: Promote Dev to Production ⭐ (Recommended)

**Workflow**: `promote-dev-to-production.yml`  
**Trigger**: Manual workflow dispatch  
**Best for**: When you've tested a dev build and want to promote it

**Steps**:

1. Test your dev build (`:dev` Docker image)
2. Go to GitHub Actions → "Promote Dev to Production"
3. Click "Run workflow"
4. Type `promote` in confirmation field
5. (Optional) Override version if needed
6. Click "Run workflow"

**What it does**:

- ✅ Extracts version from latest dev tag (removes `-dev` suffix)
- ✅ Runs full test suite and security scans
- ✅ Builds production artifacts
- ✅ Builds and pushes Docker images (`:version` and `:latest`)
- ✅ Creates git tag
- ✅ Creates GitHub release with changelog
- ✅ Attaches release artifacts

**Example**:

- Latest dev: `v1.2.3-dev`
- Promotes to: `v1.2.3` (production)

---

#### Option B: Tag-Based Release

**Workflow**: `release.yml`  
**Trigger**: Push a version tag  
**Best for**: When you want to create a release from a specific commit

**Steps**:

1. Ensure code is ready for release
2. Create and push tag:
   ```bash
   git tag -a v1.2.3 -m "Release v1.2.3"
   git push origin v1.2.3
   ```
3. Workflow runs automatically

**What it does**:

- ✅ Runs tests and security scans
- ✅ Builds production artifacts
- ✅ Builds and pushes Docker images
- ✅ Generates changelog
- ✅ Creates GitHub release

**When to use**:

- Creating release from specific commit
- Not using dev builds
- Traditional Git workflow

---

#### Option C: Manual Release Workflow

**Workflow**: `release.yml`  
**Trigger**: Manual workflow dispatch  
**Best for**: One-off releases or releases not from dev

**Steps**:

1. Go to GitHub Actions → "Release"
2. Click "Run workflow"
3. Enter version (e.g., `1.2.3`)
4. Select release type (stable or pre-release)
5. Choose whether to create tag
6. Click "Run workflow"

**What it does**: Same as tag-based, but triggered manually

---

### 3. Quick Promote (Re-tag Only)

**Workflow**: `promote-to-latest.yml`  
**Trigger**: Manual workflow dispatch  
**Best for**: When dev build is already good, just update `latest` tag

**Steps**:

1. Go to GitHub Actions → "Promote Dev to Latest"
2. Click "Run workflow"
3. Type `promote` in confirmation
4. (Optional) Create GitHub release
5. Click "Run workflow"

**What it does**:

- ✅ Re-tags existing `:dev` image as `:latest`
- ✅ Optionally creates GitHub release
- ⚠️ Does NOT rebuild or run tests

**When to use**: Quick promotion when dev build is already tested and good

---

## Comparison Table

| Method             | Trigger | Tests | Rebuild | Artifacts | Use Case                     |
| ------------------ | ------- | ----- | ------- | --------- | ---------------------------- |
| **Promote Dev** ⭐ | Manual  | ✅    | ✅      | ✅        | Tested dev → production      |
| **Tag Push**       | Git tag | ✅    | ✅      | ✅        | Release from specific commit |
| **Manual Release** | Manual  | ✅    | ✅      | ✅        | One-off releases             |
| **Quick Promote**  | Manual  | ❌    | ❌      | ❌        | Just update `latest` tag     |

## Recommended Workflow

### For Regular Releases:

1. **Develop** → Push to `main`
   - Auto-creates dev build (`v1.2.3-dev`)

2. **Test** → Pull and test dev Docker image

   ```bash
   docker pull ghcr.io/your-org/docked:dev
   # Test the application
   ```

3. **Promote** → Use "Promote Dev to Production" workflow
   - One-click promotion
   - Full validation and build
   - Production release created

### For Hotfixes:

1. **Fix** → Create hotfix branch, fix, merge to main
2. **Test** → Dev build auto-created
3. **Release** → Use tag-based or promote workflow

### For Release Candidates:

1. **Prepare** → Create release branch
2. **Test** → Multiple dev builds for testing
3. **Release** → When ready, use promote or tag workflow

## Version Management

### Dev Versions

- Format: `v1.2.3-dev`
- Auto-incremented based on commits
- Created by `pre-release.yml`

### Production Versions

- Format: `v1.2.3`
- Follows Semantic Versioning
- Created by promotion or tag workflows

### Version Override

When using "Promote Dev to Production", you can override the version:

- Leave empty: Uses latest dev version (removes `-dev`)
- Provide version: Uses your specified version (e.g., `1.2.4`)

## Permissions

All promotion workflows require:

- Repository owner, OR
- Admin permissions

This prevents unauthorized releases.

## Troubleshooting

### "No dev tag found"

- Ensure a dev build has been created (push to main)
- Check that `pre-release.yml` workflow ran successfully

### "Tag already exists"

- Version has already been released
- Use a different version or delete existing tag

### "Permission denied"

- You need owner or admin permissions
- Contact repository owner

### Promotion failed

- Check workflow logs for errors
- Ensure all tests pass
- Verify Docker registry access

## Best Practices

1. **Always test dev builds** before promoting
2. **Use "Promote Dev to Production"** for regular releases
3. **Use tag-based** for releases from specific commits
4. **Update CHANGELOG.md** before promoting
5. **Monitor release health** after promotion
6. **Keep dev and production in sync** - promote regularly

## See Also

- [RELEASE.md](../RELEASE.md) - Release process details
- [CICD.md](./CICD.md) - CI/CD system overview
- [BRANCH_PROTECTION.md](./BRANCH_PROTECTION.md) - Branch protection rules

---

**Last Updated**: 2025-01-XX

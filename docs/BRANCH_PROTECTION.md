# Branch Protection Rules

This document describes the recommended branch protection rules for the Docked repository.

## Overview

Branch protection rules enforce code quality and security standards by requiring:

- Code reviews before merging
- Passing CI/CD checks
- Up-to-date branches
- Signed commits (optional)

## Recommended Rules

### Main Branch Protection

**Branch**: `main` (or `master`)

#### Required Settings

1. **Require a pull request before merging**
   - ✅ Required number of approvals: **1**
   - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ Require review from Code Owners

2. **Require status checks to pass before merging**
   - ✅ Require branches to be up to date before merging
   - ✅ Required status checks:
     - `validate-pr-title`
     - `lint`
     - `test`
     - `security`
     - `build`
     - `validate-changelog`
     - `all-checks`

3. **Require conversation resolution before merging**
   - ✅ Require all conversations on code to be resolved

4. **Require linear history**
   - ✅ Require linear history (prevents merge commits)

5. **Require signed commits** (Optional but recommended)
   - ✅ Require signed commits

6. **Do not allow bypassing the above settings**
   - ✅ Do not allow bypassing (even for admins)

7. **Restrict who can push to matching branches**
   - ✅ Restrict pushes that create matching branches

#### Optional Settings

- **Require deployments to succeed before merging**: Not applicable (no deployments)
- **Lock branch**: Only for critical security periods

### Release Branch Protection

**Branch Pattern**: `release/*`

#### Required Settings

1. **Require a pull request before merging**
   - ✅ Required number of approvals: **2** (stricter for releases)
   - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ Require review from Code Owners

2. **Require status checks to pass before merging**
   - ✅ Require branches to be up to date before merging
   - ✅ Required status checks: Same as main branch

3. **Require conversation resolution before merging**
   - ✅ Require all conversations on code to be resolved

4. **Do not allow bypassing the above settings**
   - ✅ Do not allow bypassing (even for admins)

### Hotfix Branch Protection

**Branch Pattern**: `hotfix/*`

#### Required Settings

1. **Require a pull request before merging**
   - ✅ Required number of approvals: **1**
   - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ Require review from Code Owners

2. **Require status checks to pass before merging**
   - ✅ Require branches to be up to date before merging
   - ✅ Required status checks: Same as main branch

3. **Do not allow bypassing the above settings**
   - ⚠️ Allow bypassing for admins (for emergency fixes)

## Setting Up Branch Protection

### Via GitHub Web Interface

1. Go to **Settings** → **Branches**
2. Click **Add rule** or edit existing rule
3. Configure branch name pattern
4. Enable required settings
5. Add required status checks
6. Save changes

### Via GitHub API

```bash
# Example: Protect main branch
curl -X PUT \
  -H "Authorization: token YOUR_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/your-org/docked/branches/main/protection \
  -d '{
    "required_status_checks": {
      "strict": true,
      "contexts": [
        "CI Pipeline / validate-pr-title",
        "CI Pipeline / lint",
        "CI Pipeline / test",
        "CI Pipeline / security",
        "CI Pipeline / build",
        "CI Pipeline / validate-changelog",
        "CI Pipeline / all-checks"
      ]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "required_approving_review_count": 1,
      "dismiss_stale_reviews": true,
      "require_code_owner_reviews": true
    },
    "restrictions": null,
    "required_linear_history": true,
    "allow_force_pushes": false,
    "allow_deletions": false
  }'
```

### Via Terraform (Infrastructure as Code)

```hcl
resource "github_branch_protection" "main" {
  repository_id = github_repository.docked.id
  pattern       = "main"

  required_status_checks {
    strict   = true
    contexts = [
      "validate-pr-title",
      "lint",
      "test",
      "security",
      "build",
      "validate-changelog",
      "all-checks"
    ]
  }

  required_pull_request_reviews {
    required_approving_review_count = 1
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = true
  }

  enforce_admins             = true
  require_linear_history      = true
  allow_force_pushes          = false
  allow_deletions             = false
  required_conversation_resolution = true
}
```

## Status Checks

### Required Checks

These checks must pass before merging (from `CI Pipeline` workflow):

1. **CI Pipeline / validate-pr-title**: Validates PR title follows conventional commits (PRs only)
2. **CI Pipeline / lint**: Runs ESLint and formatting checks
3. **CI Pipeline / test**: Runs unit and integration tests
4. **CI Pipeline / security**: Runs security scans (npm audit, Snyk, CodeQL)
5. **CI Pipeline / build**: Validates build succeeds
6. **CI Pipeline / validate-changelog**: Validates CHANGELOG.md is updated (if version changed, PRs only)
7. **CI Pipeline / all-checks**: Final gate ensuring all checks passed

### Optional Checks

These checks provide information but don't block merges:

- Coverage upload (informational)
- Security scan results (reviewed manually)

## Code Owners

Code owners are defined in `.github/CODEOWNERS`. They are automatically requested for review on PRs that touch their code.

### Code Owner Groups

- `@docked-maintainers`: Global owners
- `@devops-team`: CI/CD and workflows
- `@backend-team`: Server code
- `@frontend-team`: Client code
- `@security-team`: Security-related files

## Bypassing Protection (Emergency Only)

### When to Bypass

Only in **critical emergencies**:

- Security vulnerability requiring immediate fix
- Production outage requiring hotfix
- Critical data loss prevention

### How to Bypass

1. **Via GitHub API** (if bypass allowed):

   ```bash
   # Force push (if allowed)
   git push --force origin main
   ```

2. **Via GitHub Web Interface**:
   - Go to branch settings
   - Temporarily disable protection
   - Make emergency fix
   - Re-enable protection
   - Document bypass in PR/issue

### After Bypassing

1. **Document the bypass**:
   - Create issue explaining why
   - Link to emergency fix
   - Note who authorized bypass

2. **Post-mortem**:
   - Review what went wrong
   - Update processes to prevent future bypasses
   - Update documentation

## Monitoring

### Check Protection Status

```bash
# Via GitHub CLI
gh api repos/your-org/docked/branches/main/protection

# Via web interface
# Settings → Branches → View protection rules
```

### Audit Logs

GitHub provides audit logs for:

- Protection rule changes
- Bypass events
- Force pushes
- Branch deletions

Review regularly in **Settings** → **Audit log**.

## Troubleshooting

### PR Can't Merge

**Issue**: PR shows "Required status checks must pass"

**Solutions**:

1. Check Actions tab for failed workflows
2. Fix failing checks
3. Push new commits to trigger re-run
4. Contact maintainers if checks are stuck

### Status Check Not Appearing

**Issue**: Required check not showing in PR

**Solutions**:

1. Verify workflow file is correct
2. Check workflow ran successfully
3. Ensure job name matches required check name
4. Wait for workflow to complete

### Can't Push to Protected Branch

**Issue**: Push rejected due to protection rules

**Solutions**:

1. Create a branch and PR instead
2. Request permission if legitimate need
3. Follow standard PR process

## Best Practices

1. **Never bypass protection** unless emergency
2. **Review protection rules** quarterly
3. **Update required checks** as workflows evolve
4. **Document bypasses** when they occur
5. **Monitor audit logs** regularly
6. **Test protection rules** in development branch first

## References

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [CODEOWNERS Documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [Status Checks Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/about-protected-branches#require-status-checks-before-merging)

---

**Last Updated**: 2025-01-XX

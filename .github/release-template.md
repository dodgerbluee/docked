## 🚀 Release v{{VERSION}}

**Release Date:** {{DATE}}  
**Type:** {{TYPE}}  
**Previous Version:** [v{{PREVIOUS_VERSION}}](https://github.com/{{REPO}}/releases/tag/v{{PREVIOUS_VERSION}})

## 📦 Downloads

### Source Code

- **Source Tarball:** [docked-{{VERSION}}-source.tar.gz](https://github.com/{{REPO}}/releases/download/v{{VERSION}}/docked-{{VERSION}}-source.tar.gz)
- **SHA256 Checksum:** [docked-{{VERSION}}-source.tar.gz.sha256](https://github.com/{{REPO}}/releases/download/v{{VERSION}}/docked-{{VERSION}}-source.tar.gz.sha256)

### Container Image

```bash
docker pull ghcr.io/{{REPO}}:{{VERSION}}
docker pull ghcr.io/{{REPO}}:latest  # Updated to v{{VERSION}}
```

### Package Managers

- **Docker Compose:** Update `image:` tag to `ghcr.io/{{REPO}}:{{VERSION}}`

## 🔐 Verification

Verify the checksum:

```bash
sha256sum -c docked-{{VERSION}}-source.tar.gz.sha256
```

## 📝 Release Notes

{{CHANGELOG}}

## 🔄 Upgrade Instructions

1. **Backup your data**

   ```bash
   cp -r data/users.db data/users.db.backup
   ```

2. **Stop the application**

   ```bash
   docker-compose down
   ```

3. **Update to new version**

   ```bash
   docker-compose pull
   docker-compose up -d
   ```

4. **Verify the upgrade**
   - Check application logs: `docker-compose logs -f`
   - Verify version in UI or API

For detailed upgrade instructions, see [UPGRADE.md](https://github.com/{{REPO}}/blob/main/UPGRADE.md).

## ⚠️ Breaking Changes

{{BREAKING_CHANGES}}

## 🐛 Known Issues

{{KNOWN_ISSUES}}

## 📚 Documentation

- [Installation Guide](https://github.com/{{REPO}}/blob/main/README.md#installation)
- [Upgrade Guide](https://github.com/{{REPO}}/blob/main/UPGRADE.md)
- [Full Changelog](https://github.com/{{REPO}}/blob/main/CHANGELOG.md)
- [Release Process](https://github.com/{{REPO}}/blob/main/RELEASE.md)

## 🙏 Contributors

Thanks to all contributors who made this release possible!

## 📊 Statistics

- **Commits:** {{COMMIT_COUNT}}
- **Contributors:** {{CONTRIBUTOR_COUNT}}
- **Issues Closed:** {{ISSUES_CLOSED}}
- **Pull Requests Merged:** {{PRS_MERGED}}

# Upgrade Guide

This guide provides step-by-step instructions for upgrading Docked to new versions.

## General Upgrade Process

1. **Backup your data**
   ```bash
   # Backup the database
   cp -r data/users.db data/users.db.backup
   ```

2. **Stop the application**
   ```bash
   docker-compose down
   # or
   pm2 stop docked
   ```

3. **Pull the new version**
   ```bash
   git pull origin main
   # or update Docker image
   docker pull ghcr.io/your-org/docked:latest
   ```

4. **Update dependencies** (if needed)
   ```bash
   npm run install-all
   ```

5. **Run database migrations** (if any)
   ```bash
   # Migrations are handled automatically on startup
   ```

6. **Start the application**
   ```bash
   docker-compose up -d
   # or
   pm2 start docked
   ```

7. **Verify the upgrade**
   ```bash
   # Check version
   curl http://localhost:3001/api/health
   # or check the UI
   ```

## Version-Specific Upgrade Notes

### Upgrading to v1.1.0

**Breaking Changes:**
- API endpoint `/api/v1/containers` has been removed
- Use `/api/v2/containers` instead

**Migration Steps:**
1. Update any custom scripts using the old API endpoint
2. Review the new API documentation

### Upgrading to v1.2.0

**Breaking Changes:**
- Database schema changes require migration
- Old configuration format deprecated

**Migration Steps:**
1. The database will be automatically migrated on first startup
2. Backup your database before upgrading
3. Review new configuration options in `server/.env`

### Upgrading to v2.0.0

**Breaking Changes:**
- Complete API redesign
- New authentication system
- Database schema changes

**Migration Steps:**
1. **Full backup required**
   ```bash
   cp -r data/ data-backup/
   ```

2. **Export your configuration**
   ```bash
   # Export Portainer instances
   # Export tracked applications
   # Export Discord webhooks
   ```

3. **Follow the migration guide**
   - See [MIGRATION.md](MIGRATION.md) for detailed steps

4. **Re-import configuration**
   - Use the new import tools
   - Verify all settings

## Docker Upgrades

### Using Docker Compose

```bash
# Pull latest image
docker-compose pull

# Restart services
docker-compose up -d

# Verify
docker-compose ps
docker-compose logs -f
```

### Using Docker directly

```bash
# Stop container
docker stop docked

# Remove old container
docker rm docked

# Pull new image
docker pull ghcr.io/your-org/docked:latest

# Run new container
docker run -d \
  --name docked \
  -p 3001:3001 \
  -v $(pwd)/data:/data \
  ghcr.io/your-org/docked:latest
```

## Rollback Procedures

If you encounter issues after upgrading:

### Quick Rollback (Docker)

```bash
# Stop current container
docker stop docked
docker rm docked

# Run previous version
docker run -d \
  --name docked \
  -p 3001:3001 \
  -v $(pwd)/data:/data \
  ghcr.io/your-org/docked:v1.0.0  # Previous version
```

### Database Rollback

```bash
# Restore database backup
cp data/users.db.backup data/users.db

# Restart application
docker-compose restart
```

## Pre-Upgrade Checklist

- [ ] Read the release notes for the target version
- [ ] Check for breaking changes
- [ ] Backup your database
- [ ] Backup your configuration
- [ ] Review known issues in the release notes
- [ ] Test in a staging environment (if available)
- [ ] Ensure you have rollback plan

## Post-Upgrade Verification

- [ ] Application starts successfully
- [ ] Can log in to the application
- [ ] Portainer connections work
- [ ] Container updates are detected
- [ ] Discord notifications work (if configured)
- [ ] All tracked applications are visible
- [ ] No errors in logs

## Troubleshooting

### Issue: Database migration fails

**Solution:**
1. Restore database backup
2. Check database file permissions
3. Ensure sufficient disk space
4. Review migration logs

### Issue: Application won't start

**Solution:**
1. Check application logs: `docker-compose logs`
2. Verify environment variables
3. Check port availability
4. Review error messages

### Issue: Missing data after upgrade

**Solution:**
1. Restore from backup
2. Check data directory permissions
3. Verify volume mounts in Docker

## Getting Help

If you encounter issues during upgrade:

1. Check the [GitHub Issues](https://github.com/your-org/docked/issues)
2. Review the [Documentation](https://github.com/your-org/docked#readme)
3. Open a new issue with:
   - Your current version
   - Target version
   - Error messages
   - Steps to reproduce

## Version Compatibility

| Docked Version | Node.js | Docker | Portainer API |
|----------------|---------|--------|---------------|
| 1.0.0+         | 18+     | 20+    | 2.0+          |


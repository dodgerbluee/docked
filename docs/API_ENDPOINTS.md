# API Endpoints Documentation

Complete documentation of all API endpoints in the Docked application.

## Base URL

All endpoints are prefixed with `/api` unless otherwise noted.

## Route Organization

All API routes are defined in `server/routes/index.js` and organized by controller:

- **Health & Version**: `versionController`
- **Authentication**: `authController`
- **Containers**: `containerController`
- **Images**: `imageController`
- **Portainer**: `portainerController`
- **Tracked Apps**: `trackedAppController`
- **Discord**: `discordController`
- **Batch**: `batchController`
- **Settings**: `settingsController`
- **Avatars**: `avatarController`
- **Repository Tokens**: `repositoryAccessTokenController`
- **Logs**: `logsController`

**Note:** There are some legacy routes in `server/index.js` that duplicate functionality. The routes in `server/routes/index.js` are the primary, maintained endpoints.

## Authentication

Most endpoints require authentication via JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Endpoints marked as **Public** do not require authentication.

---

## Table of Contents

- [Health & Version](#health--version)
- [Authentication](#authentication)
- [User Management](#user-management)
- [Container Management](#container-management)
- [Image Management](#image-management)
- [Portainer Instances](#portainer-instances)
- [Tracked Apps](#tracked-apps)
- [Discord Notifications](#discord-notifications)
- [Batch System](#batch-system)
- [Settings](#settings)
- [Avatars](#avatars)
- [Repository Access Tokens](#repository-access-tokens)
- [Logs](#logs)

---

## Health & Version

### GET `/api/health`

**Public** - Health check endpoint

**Response:**

```json
{
  "status": "ok"
}
```

---

### GET `/api/version`

**Public** - Get application version

**Response:**

```json
{
  "version": "1.0.0",
  "environment": "production",
  "isDevBuild": false
}
```

---

### GET `/api/version/latest-release`

**Public** - Get latest release from GitHub

**Response:**

```json
{
  "success": true,
  "latestVersion": {
    "tag_name": "v1.0.0",
    "published_at": "2024-01-01T00:00:00Z",
    "html_url": "https://github.com/dodgerbluee/docked/releases/tag/v1.0.0"
  }
}
```

---

## Authentication

### GET `/api/auth/registration-code-required`

**Public** - Check if registration code is required

**Response:**

```json
{
  "required": true
}
```

---

### GET `/api/auth/check-user-exists`

**Public** - Check if a user exists

**Query Parameters:**

- `username` (string, required) - Username to check

**Response:**

```json
{
  "exists": true
}
```

---

### POST `/api/auth/generate-registration-code`

**Public** - Generate a registration code (admin only)

**Request Body:**

```json
{
  "code": "REG123"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Registration code generated"
}
```

---

### POST `/api/auth/verify-registration-code`

**Public** - Verify a registration code

**Request Body:**

```json
{
  "code": "REG123"
}
```

**Response:**

```json
{
  "valid": true
}
```

---

### POST `/api/auth/register`

**Public** - Register a new user

**Request Body:**

```json
{
  "username": "newuser",
  "password": "password123",
  "registrationCode": "REG123" // Optional if registration codes are enabled
}
```

**Response:**

```json
{
  "success": true,
  "message": "User registered successfully",
  "token": "jwt_token_here",
  "refreshToken": "refresh_token_here",
  "username": "newuser",
  "role": "user"
}
```

---

### POST `/api/auth/login`

**Public** - User login

**Request Body:**

```json
{
  "username": "user",
  "password": "password"
}
```

**Response:**

```json
{
  "success": true,
  "token": "jwt_token_here",
  "refreshToken": "refresh_token_here",
  "username": "user",
  "role": "admin"
}
```

---

### POST `/api/auth/import-users`

**Public** - Import users from JSON (admin only)

**Request Body:**

```json
{
  "users": [
    {
      "username": "user1",
      "password": "hashed_password",
      "role": "user"
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "imported": 5,
  "failed": 0
}
```

---

### POST `/api/auth/create-user-with-config`

**Public** - Create user with full configuration (admin only)

**Request Body:**

```json
{
  "username": "newuser",
  "password": "password123",
  "role": "user",
  "portainerInstances": [...],
  "discordWebhooks": [...],
  "trackedApps": [...],
  "batchConfig": {...}
}
```

**Response:**

```json
{
  "success": true,
  "userId": 1,
  "message": "User created with configuration"
}
```

---

### POST `/api/auth/generate-instance-admin-token`

**Public** - Generate instance admin token

**Request Body:**

```json
{
  "username": "admin",
  "password": "password"
}
```

**Response:**

```json
{
  "success": true,
  "token": "instance_admin_token"
}
```

---

### POST `/api/auth/regenerate-instance-admin-token`

**Public** - Regenerate instance admin token

**Request Body:**

```json
{
  "username": "admin",
  "password": "password"
}
```

**Response:**

```json
{
  "success": true,
  "token": "new_instance_admin_token"
}
```

---

### POST `/api/auth/verify-instance-admin-token`

**Public** - Verify instance admin token

**Request Body:**

```json
{
  "token": "instance_admin_token"
}
```

**Response:**

```json
{
  "valid": true
}
```

---

### GET `/api/auth/verify`

**Protected** - Verify authentication token

**Response:**

```json
{
  "valid": true,
  "user": {
    "id": 1,
    "username": "user",
    "role": "admin"
  }
}
```

---

### GET `/api/auth/me`

**Protected** - Get current user information

**Response:**

```json
{
  "id": 1,
  "username": "user",
  "role": "admin",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

---

### GET `/api/auth/users`

**Protected** - Get all users (admin only)

**Response:**

```json
{
  "users": [
    {
      "id": 1,
      "username": "user1",
      "role": "admin",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### GET `/api/auth/users/:userId/stats`

**Protected** - Get user statistics (admin only)

**Response:**

```json
{
  "userId": 1,
  "containerCount": 10,
  "portainerInstanceCount": 2,
  "trackedAppCount": 5
}
```

---

### GET `/api/auth/export-users`

**Protected** - Export all users as JSON (admin only)

**Response:**

```json
{
  "users": [
    {
      "username": "user1",
      "password": "hashed_password",
      "role": "admin"
    }
  ]
}
```

---

### POST `/api/auth/update-password`

**Protected** - Update current user's password

**Request Body:**

```json
{
  "currentPassword": "old_password",
  "newPassword": "new_password"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

---

### POST `/api/auth/update-username`

**Protected** - Update current user's username

**Request Body:**

```json
{
  "newUsername": "new_username"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Username updated successfully"
}
```

---

### POST `/api/auth/users/:userId/password`

**Protected** - Update user password (admin only)

**Request Body:**

```json
{
  "newPassword": "new_password"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

---

### PUT `/api/auth/users/:userId/role`

**Protected** - Update user role (admin only)

**Request Body:**

```json
{
  "role": "admin"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Role updated successfully"
}
```

---

### GET `/api/user/export-config`

**Protected** - Export current user's configuration

**Response:**

```json
{
  "username": "user",
  "portainerInstances": [...],
  "discordWebhooks": [...],
  "trackedApps": [...],
  "batchConfig": {...}
}
```

---

### POST `/api/user/import-config`

**Protected** - Import user configuration

**Request Body:**

```json
{
  "portainerInstances": [...],
  "discordWebhooks": [...],
  "trackedApps": [...],
  "batchConfig": {...}
}
```

**Response:**

```json
{
  "success": true,
  "message": "Configuration imported successfully"
}
```

---

## Container Management

### GET `/api/containers`

**Protected** - Get all containers with update status

**Query Parameters:**

- `portainerOnly` (boolean, optional) - If true, fetch from Portainer only without registry checks

**Response:**

```json
{
  "grouped": true,
  "stacks": [
    {
      "name": "stack-name",
      "containers": [
        {
          "id": "container_id",
          "name": "container_name",
          "image": "nginx:latest",
          "status": "running",
          "hasUpdate": true,
          "currentDigest": "abc123...",
          "latestDigest": "def456...",
          "portainerUrl": "http://portainer:9000",
          "portainerName": "portainer"
        }
      ]
    }
  ],
  "containers": [...],
  "portainerInstances": [...],
  "unusedImagesCount": 5
}
```

---

### POST `/api/containers/pull`

**Protected** - Pull fresh container data from registries

**Request Body:**

```json
{
  "portainerUrl": "http://portainer:9000" // Optional, null for all instances
}
```

**Response:**

```json
{
  "success": true,
  "message": "Container data pulled successfully",
  "containers": [...],
  "stats": {
    "total": 10,
    "withUpdates": 3
  }
}
```

**Note:** This is the ONLY endpoint that checks registries for updates. It uses crane/skopeo to query registries via OCI Distribution Spec protocol (not Docker Hub REST API).

---

### GET `/api/containers/data`

**Protected** - Get container data with correlation

**Response:**

```json
{
  "containers": [...],
  "portainerInstances": [...],
  "unusedImagesCount": 5
}
```

---

### DELETE `/api/containers/data`

**Protected** - Clear cached container data

**Response:**

```json
{
  "success": true,
  "message": "Container data cleared"
}
```

---

### POST `/api/containers/batch-upgrade`

**Protected** - Batch upgrade multiple containers

**Request Body:**

```json
{
  "containers": [
    {
      "containerId": "container_id",
      "portainerUrl": "http://portainer:9000",
      "endpointId": 1,
      "imageName": "nginx:latest"
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "upgraded": 5,
  "failed": 0,
  "results": [...]
}
```

---

### POST `/api/containers/:containerId/upgrade`

**Protected** - Upgrade a single container

**Request Body:**

```json
{
  "portainerUrl": "http://portainer:9000",
  "endpointId": 1,
  "imageName": "nginx:latest"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Container upgraded successfully",
  "containerId": "container_id"
}
```

---

## Image Management

### GET `/api/images/unused`

**Protected** - Get unused Docker images

**Response:**

```json
{
  "unusedImages": [
    {
      "id": "image_id",
      "repoTags": ["nginx:latest"],
      "size": 1000000,
      "created": "2024-01-01T00:00:00Z",
      "portainerUrl": "http://portainer:9000",
      "endpointId": 1
    }
  ]
}
```

---

### POST `/api/images/delete`

**Protected** - Delete selected images

**Request Body:**

```json
{
  "images": [
    {
      "imageId": "image_id",
      "portainerUrl": "http://portainer:9000",
      "endpointId": 1
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "deleted": 3,
  "failed": 0
}
```

---

## Portainer Instances

### POST `/api/portainer/instances/validate`

**Public** - Validate Portainer instance credentials (without creating)

**Request Body:**

```json
{
  "url": "http://portainer:9000",
  "apiKey": "api_key_here",
  "authType": "apikey" // or "password"
}
```

**Response:**

```json
{
  "valid": true,
  "message": "Credentials are valid"
}
```

---

### GET `/api/portainer/instances`

**Protected** - Get all Portainer instances

**Response:**

```json
{
  "instances": [
    {
      "id": 1,
      "url": "http://portainer:9000",
      "name": "Portainer",
      "order": 0
    }
  ]
}
```

---

### GET `/api/portainer/instances/:id`

**Protected** - Get a specific Portainer instance

**Response:**

```json
{
  "id": 1,
  "url": "http://portainer:9000",
  "name": "Portainer",
  "order": 0
}
```

---

### POST `/api/portainer/instances`

**Protected** - Create a new Portainer instance

**Request Body:**

```json
{
  "url": "http://portainer:9000",
  "apiKey": "api_key_here",
  "authType": "apikey",
  "name": "My Portainer"
}
```

**Response:**

```json
{
  "success": true,
  "instance": {
    "id": 1,
    "url": "http://portainer:9000",
    "name": "My Portainer"
  }
}
```

---

### PUT `/api/portainer/instances/:id`

**Protected** - Update a Portainer instance

**Request Body:**

```json
{
  "url": "http://portainer:9000",
  "apiKey": "new_api_key",
  "name": "Updated Name"
}
```

**Response:**

```json
{
  "success": true,
  "instance": {...}
}
```

---

### POST `/api/portainer/instances/reorder`

**Protected** - Update Portainer instance order

**Request Body:**

```json
{
  "instances": [
    { "id": 1, "order": 0 },
    { "id": 2, "order": 1 }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Order updated successfully"
}
```

---

### DELETE `/api/portainer/instances/:id`

**Protected** - Delete a Portainer instance

**Response:**

```json
{
  "success": true,
  "message": "Instance deleted successfully"
}
```

---

## Tracked Apps

### GET `/api/tracked-apps`

**Protected** - Get all tracked apps

**Response:**

```json
{
  "apps": [
    {
      "id": 1,
      "imageName": "nginx",
      "sourceType": "github",
      "githubRepo": "nginx/nginx",
      "currentVersion": "1.0.0",
      "latestVersion": "1.1.0",
      "hasUpdate": true
    }
  ]
}
```

---

### POST `/api/tracked-apps`

**Protected** - Create a new tracked app

**Request Body:**

```json
{
  "imageName": "nginx",
  "sourceType": "github",
  "githubRepo": "nginx/nginx"
}
```

**Response:**

```json
{
  "success": true,
  "app": {
    "id": 1,
    "imageName": "nginx",
    "sourceType": "github"
  }
}
```

---

### GET `/api/tracked-apps/:id`

**Protected** - Get a specific tracked app

**Response:**

```json
{
  "id": 1,
  "imageName": "nginx",
  "sourceType": "github",
  "githubRepo": "nginx/nginx"
}
```

---

### PUT `/api/tracked-apps/:id`

**Protected** - Update a tracked app

**Request Body:**

```json
{
  "githubRepo": "nginx/nginx-updated"
}
```

**Response:**

```json
{
  "success": true,
  "app": {...}
}
```

---

### DELETE `/api/tracked-apps/:id`

**Protected** - Delete a tracked app

**Response:**

```json
{
  "success": true,
  "message": "Tracked app deleted successfully"
}
```

---

### POST `/api/tracked-apps/check-updates`

**Protected** - Check for updates for all tracked apps

**Response:**

```json
{
  "success": true,
  "checked": 10,
  "updated": 3
}
```

---

### POST `/api/tracked-apps/:id/check-update`

**Protected** - Check for update for a specific tracked app

**Response:**

```json
{
  "success": true,
  "hasUpdate": true,
  "currentVersion": "1.0.0",
  "latestVersion": "1.1.0"
}
```

---

### DELETE `/api/tracked-apps/cache`

**Protected** - Clear GitHub cache for tracked apps

**Response:**

```json
{
  "success": true,
  "message": "Cache cleared"
}
```

---

## Discord Notifications

### GET `/api/discord/webhooks`

**Protected** - Get all Discord webhooks

**Response:**

```json
{
  "webhooks": [
    {
      "id": 1,
      "name": "My Webhook",
      "url": "https://discord.com/api/webhooks/...",
      "enabled": true
    }
  ]
}
```

---

### GET `/api/discord/webhooks/:id`

**Protected** - Get a specific Discord webhook

**Response:**

```json
{
  "id": 1,
  "name": "My Webhook",
  "url": "https://discord.com/api/webhooks/...",
  "enabled": true
}
```

---

### POST `/api/discord/webhooks`

**Protected** - Create a new Discord webhook

**Request Body:**

```json
{
  "name": "My Webhook",
  "url": "https://discord.com/api/webhooks/...",
  "enabled": true
}
```

**Response:**

```json
{
  "success": true,
  "webhook": {
    "id": 1,
    "name": "My Webhook"
  }
}
```

---

### PUT `/api/discord/webhooks/:id`

**Protected** - Update a Discord webhook

**Request Body:**

```json
{
  "name": "Updated Name",
  "enabled": false
}
```

**Response:**

```json
{
  "success": true,
  "webhook": {...}
}
```

---

### DELETE `/api/discord/webhooks/:id`

**Protected** - Delete a Discord webhook

**Response:**

```json
{
  "success": true,
  "message": "Webhook deleted successfully"
}
```

---

### POST `/api/discord/webhooks/:id/test`

**Protected** - Test a Discord webhook

**Response:**

```json
{
  "success": true,
  "message": "Test message sent"
}
```

---

### POST `/api/discord/test`

**Public** - Test Discord webhook (public endpoint for validation)

**Request Body:**

```json
{
  "url": "https://discord.com/api/webhooks/..."
}
```

**Response:**

```json
{
  "success": true,
  "message": "Test message sent"
}
```

---

### GET `/api/discord/webhooks/info`

**Protected** - Get Discord webhook information

**Response:**

```json
{
  "webhookInfo": {
    "name": "Webhook Name",
    "avatarUrl": "https://..."
  }
}
```

---

### GET `/api/discord/invite`

**Protected** - Get Discord bot invite URL

**Response:**

```json
{
  "inviteUrl": "https://discord.com/api/oauth2/authorize?..."
}
```

---

## Batch System

### GET `/api/batch/config`

**Protected** - Get batch configuration

**Response:**

```json
{
  "success": true,
  "config": {
    "enabled": true,
    "schedule": "0 0 * * *",
    "upgradeContainers": true,
    "checkTrackedApps": true
  }
}
```

---

### POST `/api/batch/config`

**Protected** - Update batch configuration

**Request Body:**

```json
{
  "enabled": true,
  "schedule": "0 0 * * *",
  "upgradeContainers": true,
  "checkTrackedApps": true
}
```

**Response:**

```json
{
  "success": true,
  "message": "Configuration updated"
}
```

---

### GET `/api/batch/status`

**Protected** - Get batch system status

**Response:**

```json
{
  "running": true,
  "lastRun": "2024-01-01T00:00:00Z",
  "nextRun": "2024-01-02T00:00:00Z"
}
```

---

### POST `/api/batch/trigger`

**Protected** - Manually trigger a batch job

**Request Body:**

```json
{
  "jobType": "upgrade-containers" // Optional, triggers all if not specified
}
```

**Response:**

```json
{
  "success": true,
  "message": "Batch job triggered",
  "runId": 1
}
```

---

### GET `/api/batch/log-level`

**Protected** - Get batch log level

**Response:**

```json
{
  "logLevel": "info"
}
```

---

### POST `/api/batch/log-level`

**Protected** - Set batch log level

**Request Body:**

```json
{
  "logLevel": "debug"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Log level updated"
}
```

---

### POST `/api/batch/runs`

**Protected** - Create a batch run record

**Request Body:**

```json
{
  "jobType": "upgrade-containers",
  "status": "running"
}
```

**Response:**

```json
{
  "success": true,
  "run": {
    "id": 1,
    "jobType": "upgrade-containers",
    "status": "running"
  }
}
```

---

### PUT `/api/batch/runs/:id`

**Protected** - Update a batch run

**Request Body:**

```json
{
  "status": "completed",
  "result": {...}
}
```

**Response:**

```json
{
  "success": true,
  "run": {...}
}
```

---

### GET `/api/batch/runs/latest`

**Protected** - Get latest batch run

**Query Parameters:**

- `jobType` (string, optional) - Filter by job type

**Response:**

```json
{
  "run": {
    "id": 1,
    "jobType": "upgrade-containers",
    "status": "completed",
    "startedAt": "2024-01-01T00:00:00Z"
  }
}
```

---

### GET `/api/batch/runs`

**Protected** - Get recent batch runs

**Query Parameters:**

- `limit` (number, optional) - Number of runs to return (default: 10)
- `jobType` (string, optional) - Filter by job type

**Response:**

```json
{
  "runs": [
    {
      "id": 1,
      "jobType": "upgrade-containers",
      "status": "completed",
      "startedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### GET `/api/batch/runs/:id`

**Protected** - Get a specific batch run

**Response:**

```json
{
  "id": 1,
  "jobType": "upgrade-containers",
  "status": "completed",
  "result": {...},
  "startedAt": "2024-01-01T00:00:00Z",
  "completedAt": "2024-01-01T00:05:00Z"
}
```

---

## Settings

### GET `/api/settings/color-scheme`

**Protected** - Get color scheme preference

**Response:**

```json
{
  "success": true,
  "colorScheme": "dark" // "light", "dark", or "system"
}
```

---

### POST `/api/settings/color-scheme`

**Protected** - Set color scheme preference

**Request Body:**

```json
{
  "colorScheme": "dark"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Color scheme updated"
}
```

---

### GET `/api/settings/disable-portainer-page`

**Protected** - Get Portainer page disable setting

**Response:**

```json
{
  "success": true,
  "disabled": false
}
```

---

### POST `/api/settings/disable-portainer-page`

**Protected** - Set Portainer page disable setting

**Request Body:**

```json
{
  "disabled": true
}
```

**Response:**

```json
{
  "success": true,
  "message": "Setting updated"
}
```

---

### GET `/api/settings/disable-tracked-apps-page`

**Protected** - Get Tracked Apps page disable setting

**Response:**

```json
{
  "success": true,
  "disabled": false
}
```

---

### POST `/api/settings/disable-tracked-apps-page`

**Protected** - Set Tracked Apps page disable setting

**Request Body:**

```json
{
  "disabled": true
}
```

**Response:**

```json
{
  "success": true,
  "message": "Setting updated"
}
```

---

### GET `/api/settings/refreshing-toggles-enabled`

**Protected** - Get refreshing toggles enabled setting

**Response:**

```json
{
  "success": true,
  "enabled": false
}
```

---

### POST `/api/settings/refreshing-toggles-enabled`

**Protected** - Set refreshing toggles enabled setting

**Request Body:**

```json
{
  "enabled": true
}
```

**Response:**

```json
{
  "success": true,
  "message": "Setting updated"
}
```

---

## Avatars

### GET `/api/avatars`

**Protected** - Get current user's avatar

**Response:** Image file (JPEG)

---

### GET `/api/avatars/user/:userId`

**Protected** - Get avatar by user ID

**Response:** Image file (JPEG)

---

### GET `/api/avatars/recent`

**Protected** - Get recent avatars list

**Response:**

```json
{
  "avatars": [
    {
      "filename": "avatar_1234567890.jpg",
      "uploadedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### GET `/api/avatars/recent/:filename`

**Protected** - Get a specific recent avatar file

**Response:** Image file (JPEG)

---

### POST `/api/avatars`

**Protected** - Upload avatar

**Request:** Multipart form data with `avatar` file

**Response:**

```json
{
  "success": true,
  "message": "Avatar uploaded successfully",
  "filename": "avatar_1234567890.jpg"
}
```

---

### POST `/api/avatars/set-current`

**Protected** - Set current avatar from recent avatars

**Request Body:**

```json
{
  "filename": "avatar_1234567890.jpg"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Avatar set as current"
}
```

---

### DELETE `/api/avatars`

**Protected** - Delete current user's avatar

**Response:**

```json
{
  "success": true,
  "message": "Avatar deleted successfully"
}
```

---

## Repository Access Tokens

### GET `/api/repository-access-tokens`

**Protected** - Get all repository access tokens

**Response:**

```json
{
  "success": true,
  "tokens": [
    {
      "id": 1,
      "provider": "github",
      "token": "ghp_...",
      "maskedToken": "ghp_****"
    }
  ]
}
```

---

### GET `/api/repository-access-tokens/:provider`

**Protected** - Get token by provider (github/gitlab)

**Response:**

```json
{
  "success": true,
  "token": {
    "id": 1,
    "provider": "github",
    "maskedToken": "ghp_****"
  }
}
```

---

### POST `/api/repository-access-tokens`

**Protected** - Create or update repository access token

**Request Body:**

```json
{
  "provider": "github",
  "token": "ghp_token_here"
}
```

**Response:**

```json
{
  "success": true,
  "token": {
    "id": 1,
    "provider": "github",
    "maskedToken": "ghp_****"
  }
}
```

---

### DELETE `/api/repository-access-tokens/:id`

**Protected** - Delete repository access token

**Response:**

```json
{
  "success": true,
  "message": "Token deleted successfully"
}
```

---

### GET `/api/repository-access-tokens/:id/associated-images`

**Protected** - Get images associated with a token

**Response:**

```json
{
  "success": true,
  "images": [
    {
      "imageRepo": "owner/repo",
      "associated": true
    }
  ]
}
```

---

### POST `/api/repository-access-tokens/:id/associate-images`

**Protected** - Associate images with a token

**Request Body:**

```json
{
  "imageRepos": ["owner/repo1", "owner/repo2"]
}
```

**Response:**

```json
{
  "success": true,
  "associated": 2,
  "message": "Images associated successfully"
}
```

---

## Logs

### GET `/api/logs`

**Protected** - Get application logs

**Query Parameters:**

- `lines` (number, optional) - Number of lines to return (default: 500)
- `since` (number, optional) - Line count to fetch after (for incremental updates)
- `file` (string, optional) - Log file name (default: "combined.log")

**Response:**

```json
{
  "success": true,
  "logs": "log content here...",
  "totalLines": 1000,
  "returnedLines": 500,
  "newLines": 500
}
```

---

## Registry Credentials

### GET `/api/docker-hub/credentials`

**Protected** - Get registry credentials (docker.io)

**Response:**

```json
{
  "success": true,
  "credentials": {
    "username": "user",
    "hasToken": true
  }
}
```

---

### POST `/api/docker-hub/credentials`

**Protected** - Update registry credentials

**Request Body:**

```json
{
  "username": "dockerhub_user",
  "token": "dockerhub_token"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Credentials updated successfully"
}
```

---

### DELETE `/api/docker-hub/credentials`

**Protected** - Delete registry credentials

**Response:**

```json
{
  "success": true,
  "message": "Credentials deleted successfully"
}
```

---

### POST `/api/docker-hub/credentials/validate`

**Public** - Validate registry credentials (without saving)

**Request Body:**

```json
{
  "username": "dockerhub_user",
  "token": "dockerhub_token"
}
```

**Response:**

```json
{
  "valid": true,
  "message": "Credentials are valid"
}
```

---

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request

```json
{
  "success": false,
  "error": "Validation error message"
}
```

### 401 Unauthorized

```json
{
  "success": false,
  "error": "Authentication required"
}
```

### 403 Forbidden

```json
{
  "success": false,
  "error": "Insufficient permissions"
}
```

### 404 Not Found

```json
{
  "success": false,
  "error": "Resource not found"
}
```

### 429 Too Many Requests

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "rateLimitExceeded": true,
  "message": "Registry rate limit exceeded. Please wait a few minutes before trying again."
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Internal server error message"
}
```

---

## Rate Limiting

- **Avatar endpoints**: 100 requests per 15 minutes per IP
- **Repository access token endpoints**: 100 requests per 15 minutes per IP
- **Associate images endpoint**: 10 requests per minute per IP
- **All other endpoints**: No rate limiting (rate limiting is only applied to external registry requests)

---

## Notes

1. **Container Update Detection**: The system uses crane/skopeo to query registries via OCI Distribution Spec protocol. This avoids direct Docker Hub REST API calls and provides better rate limits.

2. **Registry Checks**: Registry update checks are ONLY performed via `/api/containers/pull`. The `/api/containers` endpoint returns cached data or Portainer-only data.

3. **Authentication**: Most endpoints require a valid JWT token. Tokens are obtained via `/api/auth/login` or `/api/auth/register`.

4. **User Roles**: Some endpoints are restricted to admin users only (e.g., user management, instance admin tokens).

5. **Batch System**: The batch system runs scheduled jobs in the background. Jobs can be manually triggered via `/api/batch/trigger`.

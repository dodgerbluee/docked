# Database Schema Documentation

Generated on: 2025-11-18T19:37:52.400Z (manually updated to include new normalized tables)
Database: \data\users.db

## Overview

This document describes the database schema for the Docked application.
The database uses SQLite and contains user-specific configurations for Portainer instances, tracked images, Docker Hub credentials, Discord webhooks, and application settings.
Most data is isolated per user via a `user_id` foreign key.

The database uses a normalized schema with separate tables for:

- **Portainer container state** (`portainer_containers`) - Stores container information from Portainer instances
- **Docker Hub image versions** (`docker_hub_image_versions`) - Tracks Docker Hub image version information per user

This normalized design ensures data persistence across logouts and reduces Docker Hub API calls through intelligent caching.

## Tables

### `batch_config`

**SQL Definition:**

```sql
CREATE TABLE batch_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL UNIQUE,
        enabled INTEGER DEFAULT 0,
        interval_minutes INTEGER DEFAULT 60,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
```

#### Columns

| Column           | Type     | Constraints               | Description |
| ---------------- | -------- | ------------------------- | ----------- |
| id               | INTEGER  | PRIMARY KEY               | -           |
| job_type         | TEXT     | NOT NULL                  | -           |
| enabled          | INTEGER  | DEFAULT 0                 | -           |
| interval_minutes | INTEGER  | DEFAULT 60                | -           |
| created_at       | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| updated_at       | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |

---

### `batch_runs`

**SQL Definition:**

```sql
CREATE TABLE batch_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        job_type TEXT DEFAULT 'docker-hub-pull',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        duration_ms INTEGER,
        containers_checked INTEGER DEFAULT 0,
        containers_updated INTEGER DEFAULT 0,
        error_message TEXT,
        logs TEXT
      , is_manual INTEGER DEFAULT 0)
```

#### Columns

| Column             | Type     | Constraints               | Description |
| ------------------ | -------- | ------------------------- | ----------- |
| id                 | INTEGER  | PRIMARY KEY               | -           |
| status             | TEXT     | NOT NULL                  | -           |
| job_type           | TEXT     | DEFAULT docker-hub-pull   | -           |
| started_at         | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| completed_at       | DATETIME | -                         | -           |
| duration_ms        | INTEGER  | -                         | -           |
| containers_checked | INTEGER  | DEFAULT 0                 | -           |
| containers_updated | INTEGER  | DEFAULT 0                 | -           |
| error_message      | TEXT     | -                         | -           |
| logs               | TEXT     | -                         | -           |
| is_manual          | INTEGER  | DEFAULT 0                 | -           |

#### Indexes

- **idx_batch_runs_started_at**: `CREATE INDEX idx_batch_runs_started_at ON batch_runs(started_at DESC)`
- **idx_batch_runs_status**: `CREATE INDEX idx_batch_runs_status ON batch_runs(status)`

---

### `docker_hub_image_versions`

**SQL Definition:**

```sql
CREATE TABLE IF NOT EXISTS docker_hub_image_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  image_name TEXT NOT NULL,
  image_repo TEXT NOT NULL,
  registry TEXT DEFAULT 'docker.io',
  namespace TEXT,
  repository TEXT NOT NULL,
  current_tag TEXT,
  current_version TEXT,
  current_digest TEXT,
  latest_tag TEXT,
  latest_version TEXT,
  latest_digest TEXT,
  has_update INTEGER DEFAULT 0,
  latest_publish_date TEXT,
  current_version_publish_date TEXT,
  exists_in_docker_hub INTEGER DEFAULT 0,
  last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, image_repo),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
```

#### Columns

| Column                       | Type     | Constraints               | Description                                     |
| ---------------------------- | -------- | ------------------------- | ----------------------------------------------- |
| id                           | INTEGER  | PRIMARY KEY               | -                                               |
| user_id                      | INTEGER  | NOT NULL                  | Foreign key to users table                      |
| image_name                   | TEXT     | NOT NULL                  | Full image name (e.g., "nginx:latest")          |
| image_repo                   | TEXT     | NOT NULL                  | Image repository without tag (e.g., "nginx")    |
| registry                     | TEXT     | DEFAULT 'docker.io'       | Registry (docker.io, ghcr.io, etc.)             |
| namespace                    | TEXT     | -                         | Namespace (e.g., "library" for official images) |
| repository                   | TEXT     | NOT NULL                  | Repository name                                 |
| current_tag                  | TEXT     | -                         | Current tag being used                          |
| current_version              | TEXT     | -                         | Current version                                 |
| current_digest               | TEXT     | -                         | Current image digest                            |
| latest_tag                   | TEXT     | -                         | Latest available tag                            |
| latest_version               | TEXT     | -                         | Latest available version                        |
| latest_digest                | TEXT     | -                         | Latest image digest                             |
| has_update                   | INTEGER  | DEFAULT 0                 | Whether an update is available (0 or 1)         |
| latest_publish_date          | TEXT     | -                         | Publish date of latest version                  |
| current_version_publish_date | TEXT     | -                         | Publish date of current version                 |
| exists_in_docker_hub         | INTEGER  | DEFAULT 0                 | Whether image exists in Docker Hub (0 or 1)     |
| last_checked                 | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last time Docker Hub was checked                |
| created_at                   | DATETIME | DEFAULT CURRENT_TIMESTAMP | -                                               |
| updated_at                   | DATETIME | DEFAULT CURRENT_TIMESTAMP | -                                               |

#### Indexes

- **idx_docker_hub_image_versions_user_id**: `CREATE INDEX idx_docker_hub_image_versions_user_id ON docker_hub_image_versions(user_id)`
- **idx_docker_hub_image_versions_user_has_update**: `CREATE INDEX idx_docker_hub_image_versions_user_has_update ON docker_hub_image_versions(user_id, has_update)`
- **idx_docker_hub_image_versions_image_repo**: `CREATE INDEX idx_docker_hub_image_versions_image_repo ON docker_hub_image_versions(image_repo)`
- **idx_docker_hub_image_versions_last_checked**: `CREATE INDEX idx_docker_hub_image_versions_last_checked ON docker_hub_image_versions(last_checked)`

#### Foreign Keys

- `user_id` REFERENCES `users`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE

---

### `portainer_containers`

**SQL Definition:**

```sql
CREATE TABLE IF NOT EXISTS portainer_containers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  portainer_instance_id INTEGER NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  image_name TEXT NOT NULL,
  image_repo TEXT NOT NULL,
  status TEXT,
  state TEXT,
  stack_name TEXT,
  current_digest TEXT,
  image_created_date TEXT,
  uses_network_mode INTEGER DEFAULT 0,
  provides_network INTEGER DEFAULT 0,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, container_id, portainer_instance_id, endpoint_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE CASCADE
)
```

#### Columns

| Column                | Type     | Constraints               | Description                                            |
| --------------------- | -------- | ------------------------- | ------------------------------------------------------ |
| id                    | INTEGER  | PRIMARY KEY               | -                                                      |
| user_id               | INTEGER  | NOT NULL                  | Foreign key to users table                             |
| portainer_instance_id | INTEGER  | NOT NULL                  | Foreign key to portainer_instances table               |
| container_id          | TEXT     | NOT NULL                  | Docker container ID                                    |
| container_name        | TEXT     | NOT NULL                  | Container name                                         |
| endpoint_id           | TEXT     | NOT NULL                  | Portainer endpoint ID                                  |
| image_name            | TEXT     | NOT NULL                  | Full image name (e.g., "nginx:latest")                 |
| image_repo            | TEXT     | NOT NULL                  | Image repository without tag                           |
| status                | TEXT     | -                         | Container status                                       |
| state                 | TEXT     | -                         | Container state                                        |
| stack_name            | TEXT     | -                         | Docker stack name (if part of a stack)                 |
| current_digest        | TEXT     | -                         | Current image digest                                   |
| image_created_date    | TEXT     | -                         | Image creation date                                    |
| uses_network_mode     | INTEGER  | DEFAULT 0                 | Whether container uses network_mode (0 or 1)           |
| provides_network      | INTEGER  | DEFAULT 0                 | Whether container provides network for others (0 or 1) |
| last_seen             | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last time container was seen                           |
| created_at            | DATETIME | DEFAULT CURRENT_TIMESTAMP | -                                                      |
| updated_at            | DATETIME | DEFAULT CURRENT_TIMESTAMP | -                                                      |

#### Indexes

- **idx_portainer_containers_user_id**: `CREATE INDEX idx_portainer_containers_user_id ON portainer_containers(user_id)`
- **idx_portainer_containers_instance**: `CREATE INDEX idx_portainer_containers_instance ON portainer_containers(portainer_instance_id)`
- **idx_portainer_containers_image_repo**: `CREATE INDEX idx_portainer_containers_image_repo ON portainer_containers(image_repo)`
- **idx_portainer_containers_last_seen**: `CREATE INDEX idx_portainer_containers_last_seen ON portainer_containers(last_seen)`

#### Foreign Keys

- `user_id` REFERENCES `users`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
- `portainer_instance_id` REFERENCES `portainer_instances`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE

---

### `discord_webhooks`

**SQL Definition:**

```sql
CREATE TABLE discord_webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_url TEXT NOT NULL,
        server_name TEXT,
        channel_name TEXT,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      , avatar_url TEXT, guild_id TEXT, channel_id TEXT)
```

#### Columns

| Column       | Type     | Constraints               | Description |
| ------------ | -------- | ------------------------- | ----------- |
| id           | INTEGER  | PRIMARY KEY               | -           |
| webhook_url  | TEXT     | NOT NULL                  | -           |
| server_name  | TEXT     | -                         | -           |
| channel_name | TEXT     | -                         | -           |
| enabled      | INTEGER  | DEFAULT 1                 | -           |
| created_at   | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| updated_at   | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| avatar_url   | TEXT     | -                         | -           |
| guild_id     | TEXT     | -                         | -           |
| channel_id   | TEXT     | -                         | -           |

#### Indexes

- **idx_discord_webhooks_enabled**: `CREATE INDEX idx_discord_webhooks_enabled ON discord_webhooks(enabled)`

---

### `docker_hub_credentials`

**SQL Definition:**

```sql
CREATE TABLE docker_hub_credentials (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT,
        token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
```

#### Columns

| Column     | Type     | Constraints               | Description |
| ---------- | -------- | ------------------------- | ----------- |
| id         | INTEGER  | PRIMARY KEY               | -           |
| username   | TEXT     | -                         | -           |
| token      | TEXT     | -                         | -           |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |

---

### `portainer_instances`

**SQL Definition:**

```sql
CREATE TABLE portainer_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      , auth_type TEXT DEFAULT 'password', api_key TEXT, ip_address TEXT)
```

#### Columns

| Column        | Type     | Constraints               | Description |
| ------------- | -------- | ------------------------- | ----------- |
| id            | INTEGER  | PRIMARY KEY               | -           |
| name          | TEXT     | NOT NULL                  | -           |
| url           | TEXT     | NOT NULL                  | -           |
| username      | TEXT     | NOT NULL                  | -           |
| password      | TEXT     | NOT NULL                  | -           |
| display_order | INTEGER  | DEFAULT 0                 | -           |
| created_at    | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| updated_at    | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| auth_type     | TEXT     | DEFAULT password          | -           |
| api_key       | TEXT     | -                         | -           |
| ip_address    | TEXT     | -                         | -           |

#### Indexes

- **idx_portainer_display_order**: `CREATE INDEX idx_portainer_display_order ON portainer_instances(display_order)`
- **idx_portainer_url**: `CREATE INDEX idx_portainer_url ON portainer_instances(url)`

---

### `settings`

**SQL Definition:**

```sql
CREATE TABLE settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
```

#### Columns

| Column     | Type     | Constraints               | Description |
| ---------- | -------- | ------------------------- | ----------- |
| id         | INTEGER  | PRIMARY KEY               | -           |
| key        | TEXT     | NOT NULL                  | -           |
| value      | TEXT     | -                         | -           |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |

#### Indexes

- **idx_settings_key**: `CREATE INDEX idx_settings_key ON settings(key)`

---

### `tracked_images`

**SQL Definition:**

```sql
CREATE TABLE tracked_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_name TEXT,
        github_repo TEXT,
        source_type TEXT DEFAULT 'docker', -- 'docker' or 'github'
        current_version TEXT,
        current_digest TEXT,
        latest_version TEXT,
        latest_digest TEXT,
        has_update INTEGER DEFAULT 0,
        current_version_publish_date TEXT,
        last_checked DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, gitlab_token TEXT, latest_version_publish_date TEXT,
        UNIQUE(image_name, github_repo)
      )
```

#### Columns

| Column                       | Type     | Constraints               | Description |
| ---------------------------- | -------- | ------------------------- | ----------- |
| id                           | INTEGER  | PRIMARY KEY               | -           |
| name                         | TEXT     | NOT NULL                  | -           |
| image_name                   | TEXT     | -                         | -           |
| github_repo                  | TEXT     | -                         | -           |
| source_type                  | TEXT     | DEFAULT docker            | -           |
| current_version              | TEXT     | -                         | -           |
| current_digest               | TEXT     | -                         | -           |
| latest_version               | TEXT     | -                         | -           |
| latest_digest                | TEXT     | -                         | -           |
| has_update                   | INTEGER  | DEFAULT 0                 | -           |
| current_version_publish_date | TEXT     | -                         | -           |
| last_checked                 | DATETIME | -                         | -           |
| created_at                   | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| updated_at                   | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| gitlab_token                 | TEXT     | -                         | -           |
| latest_version_publish_date  | TEXT     | -                         | -           |

#### Indexes

- **idx_tracked_images_github_repo**: `CREATE INDEX idx_tracked_images_github_repo ON tracked_images(github_repo)`
- **idx_tracked_images_image_name**: `CREATE INDEX idx_tracked_images_image_name ON tracked_images(image_name)`
- **idx_tracked_images_name**: `CREATE INDEX idx_tracked_images_name ON tracked_images(name)`

---

### `users`

**SQL Definition:**

```sql
CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'Administrator',
        password_changed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
```

#### Columns

| Column           | Type     | Constraints               | Description |
| ---------------- | -------- | ------------------------- | ----------- |
| id               | INTEGER  | PRIMARY KEY               | -           |
| username         | TEXT     | NOT NULL                  | -           |
| password_hash    | TEXT     | NOT NULL                  | -           |
| role             | TEXT     | DEFAULT Administrator     | -           |
| password_changed | INTEGER  | DEFAULT 0                 | -           |
| created_at       | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |
| updated_at       | DATETIME | DEFAULT CURRENT_TIMESTAMP | -           |

#### Indexes

- **idx_users_username**: `CREATE INDEX idx_users_username ON users(username)`

---

## Relationships

### User-Centric Design

The database follows a user-centric design where most tables are scoped to individual users:

- `users` - Core user accounts
- `portainer_instances` - Portainer instances per user (via `user_id`)
- `portainer_containers` - Container state from Portainer instances per user (via `user_id`)
- `docker_hub_image_versions` - Docker Hub image version tracking per user (via `user_id`)
- `tracked_images` - Tracked Docker images per user (via `user_id`)
- `settings` - User-specific settings (via `user_id`)
- `discord_webhooks` - Discord webhook configurations per user (via `user_id`)
- `docker_hub_credentials` - Docker Hub credentials per user (via `user_id`)
- `batch_config` - Batch job configurations per user (via `user_id`)
- `batch_runs` - Batch job execution history per user (via `user_id`)

### Normalized Container Data

The application uses a normalized schema for container and Docker Hub data:

- **`portainer_containers`** - Stores container state from Portainer instances, including container ID, name, image, status, stack information, and network mode flags. Linked to `portainer_instances` via `portainer_instance_id`.

- **`docker_hub_image_versions`** - Central table for Docker Hub image version information. Tracks current and latest versions, digests, update status, and publish dates. Shared across containers and tracked images that use the same image repository.

- **Relationship**: `portainer_containers.image_repo` can be joined with `docker_hub_image_versions.image_repo` (both filtered by `user_id`) to get update information for containers.

### Special Cases

- `settings` table uses `user_id = 0` for system-wide settings (e.g., log level)

# Database Schema Diagram

This document contains a Mermaid ER diagram visualizing the database structure and relationships.

## Entity Relationship Diagram

```mermaid
erDiagram
    users ||--o{ portainer_instances : "has"
    users ||--o{ portainer_containers : "owns"
    users ||--o{ docker_hub_image_versions : "tracks"
    users ||--o{ docker_hub_credentials : "has"
    users ||--o{ tracked_images : "tracks"
    users ||--o{ discord_webhooks : "configures"
    users ||--o{ settings : "has"
    users ||--o{ batch_config : "configures"
    users ||--o{ batch_runs : "executes"
    
    portainer_instances ||--o{ portainer_containers : "contains"
    portainer_containers }o--o{ docker_hub_image_versions : "joins by image_repo (logical)"
    
    users {
        INTEGER id PK
        TEXT username UK "UNIQUE"
        TEXT password_hash
        TEXT email
        TEXT role "DEFAULT 'Administrator'"
        INTEGER password_changed "DEFAULT 0"
        INTEGER instance_admin "DEFAULT 0"
        TEXT verification_token
        DATETIME last_login
        DATETIME created_at
        DATETIME updated_at
    }
    
    portainer_instances {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL"
        TEXT name "NOT NULL"
        TEXT url "NOT NULL, UNIQUE(user_id, url)"
        TEXT username
        TEXT password
        TEXT api_key
        TEXT auth_type "DEFAULT 'password'"
        TEXT ip_address
        INTEGER display_order "DEFAULT 0"
        DATETIME created_at
        DATETIME updated_at
    }
    
    portainer_containers {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL"
        INTEGER portainer_instance_id FK "NOT NULL"
        TEXT container_id "NOT NULL"
        TEXT container_name "NOT NULL"
        TEXT endpoint_id "NOT NULL"
        TEXT image_name "NOT NULL"
        TEXT image_repo "NOT NULL"
        TEXT status
        TEXT state
        TEXT stack_name
        TEXT current_digest
        TEXT image_created_date
        INTEGER uses_network_mode "DEFAULT 0"
        INTEGER provides_network "DEFAULT 0"
        DATETIME last_seen
        DATETIME created_at
        DATETIME updated_at
        UNIQUE "user_id, container_id, portainer_instance_id, endpoint_id"
    }
    
    docker_hub_image_versions {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL"
        TEXT image_name "NOT NULL"
        TEXT image_repo "NOT NULL, UNIQUE(user_id, image_repo)"
        TEXT registry "DEFAULT 'docker.io'"
        TEXT namespace
        TEXT repository "NOT NULL"
        TEXT current_tag
        TEXT current_version
        TEXT current_digest
        TEXT latest_tag
        TEXT latest_version
        TEXT latest_digest
        INTEGER has_update "DEFAULT 0"
        TEXT latest_publish_date
        TEXT current_version_publish_date
        INTEGER exists_in_docker_hub "DEFAULT 0"
        DATETIME last_checked
        DATETIME created_at
        DATETIME updated_at
    }
    
    docker_hub_credentials {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL, UNIQUE"
        TEXT username
        TEXT token
        DATETIME created_at
        DATETIME updated_at
    }
    
    tracked_images {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL"
        TEXT name "NOT NULL"
        TEXT image_name
        TEXT github_repo
        TEXT source_type "DEFAULT 'docker'"
        TEXT gitlab_token
        TEXT current_version
        TEXT current_digest
        TEXT latest_version
        TEXT latest_digest
        INTEGER has_update "DEFAULT 0"
        TEXT current_version_publish_date
        TEXT latest_version_publish_date
        DATETIME last_checked
        DATETIME created_at
        DATETIME updated_at
        UNIQUE "user_id, image_name, github_repo"
    }
    
    discord_webhooks {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL"
        TEXT webhook_url "NOT NULL"
        TEXT server_name
        TEXT channel_name
        TEXT name
        TEXT avatar_url
        TEXT guild_id
        TEXT channel_id
        INTEGER enabled "DEFAULT 1"
        DATETIME created_at
        DATETIME updated_at
    }
    
    settings {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL, UNIQUE(user_id, key)"
        TEXT key "NOT NULL"
        TEXT value
        DATETIME created_at
        DATETIME updated_at
        NOTE "user_id = 0 for system-wide settings"
    }
    
    batch_config {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL"
        TEXT job_type "NOT NULL"
        INTEGER enabled "DEFAULT 0"
        INTEGER interval_minutes "DEFAULT 60"
        DATETIME created_at
        DATETIME updated_at
        UNIQUE "user_id, job_type"
    }
    
    batch_runs {
        INTEGER id PK
        INTEGER user_id FK "NOT NULL"
        TEXT job_type "DEFAULT 'docker-hub-pull'"
        TEXT status "NOT NULL"
        INTEGER is_manual "DEFAULT 0"
        DATETIME started_at
        DATETIME completed_at
        INTEGER duration_ms
        INTEGER containers_checked "DEFAULT 0"
        INTEGER containers_updated "DEFAULT 0"
        TEXT error_message
        TEXT logs
    }
```

## Key Relationships

### User-Centric Design
All major tables are scoped to individual users via `user_id` foreign keys:
- **One-to-Many**: One user can have many Portainer instances, containers, tracked images, webhooks, etc.
- **Cascade Delete**: When a user is deleted, all related data is automatically removed (ON DELETE CASCADE)

### Normalized Container Data
- **`portainer_containers`** stores container state from Portainer instances
- **`docker_hub_image_versions`** stores Docker Hub version information
- **Relationship**: Containers reference Docker Hub versions by `image_repo` (logical join, not a foreign key)
- This design allows multiple containers using the same image to share version information

### Special Relationships
- **`portainer_instances` → `portainer_containers`**: One instance contains many containers
- **`settings`**: Uses `user_id = 0` for system-wide settings
- **`docker_hub_credentials`**: One credential set per user (UNIQUE constraint)
- **`batch_config`**: One configuration per user per job type (UNIQUE constraint)

## Indexes

The following indexes are created for performance:

- **users**: `idx_users_username`
- **portainer_instances**: `idx_portainer_user_id`, `idx_portainer_url`, `idx_portainer_display_order`
- **portainer_containers**: `idx_portainer_containers_user_id`, `idx_portainer_containers_instance`, `idx_portainer_containers_image_repo`, `idx_portainer_containers_last_seen`
- **docker_hub_image_versions**: `idx_docker_hub_image_versions_user_id`, `idx_docker_hub_image_versions_user_has_update`, `idx_docker_hub_image_versions_image_repo`, `idx_docker_hub_image_versions_last_checked`
- **tracked_images**: `idx_tracked_images_user_id`, `idx_tracked_images_name`, `idx_tracked_images_image_name`, `idx_tracked_images_github_repo`
- **discord_webhooks**: `idx_discord_webhooks_user_id`, `idx_discord_webhooks_enabled`
- **settings**: `idx_settings_user_id`, `idx_settings_key`
- **batch_runs**: `idx_batch_runs_started_at`, `idx_batch_runs_status`

## Data Flow

1. **User** creates **Portainer Instances**
2. **Portainer Instances** are queried to discover **Containers**
3. **Containers** are stored in **portainer_containers** with their `image_repo`
4. **Docker Hub** is queried for each unique `image_repo` and stored in **docker_hub_image_versions**
5. Containers and Docker Hub versions are joined by `image_repo` (filtered by `user_id`) to show update status
6. **Batch Jobs** run periodically to refresh Docker Hub data
7. **Discord Webhooks** send notifications when updates are detected
8. **Tracked Images** (GitHub/GitLab repos) are checked separately and stored independently


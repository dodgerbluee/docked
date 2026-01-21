# Registry Authentication

## Overview

This application uses `crane` and `skopeo` CLI tools to interact with container registries. These tools use the **Docker Registry Protocol (OCI Distribution Spec)** which is more efficient and reliable than REST APIs.

## Authentication

### System Docker Credentials

Both `crane` and `skopeo` automatically use Docker credentials stored in `~/.docker/config.json`. This file is created when you run `docker login`.

**To authenticate with registries:**

```bash
# Docker Hub
docker login

# GitHub Container Registry (GHCR)
docker login ghcr.io

# GitLab Container Registry
docker login registry.gitlab.com

# Google Container Registry (GCR)
docker login gcr.io
```

### Rate Limits

Different registries have different rate limits based on authentication status:

#### Docker Hub
- **Unauthenticated:** 100 pulls per 6 hours (per IP address)
- **Authenticated (Free):** 200 pulls per 6 hours
- **Authenticated (Pro/Team/Business):** Unlimited pulls

#### Other Registries
- **GHCR:** Higher limits for authenticated users
- **GitLab:** Based on your GitLab plan
- **GCR:** Based on your Google Cloud quota

### When Do You Need Authentication?

You **do NOT** need authentication if:
- ✅ You're checking for updates every 15 minutes or less frequently
- ✅ You only use public images
- ✅ You're under 100 checks per 6 hours from your IP address

You **DO** need authentication if:
- ❌ You use private/internal images
- ❌ You're in a shared IP environment (cloud, CI/CD)
- ❌ You exceed 100 registry checks per 6 hours
- ❌ You want higher rate limits for faster checking

## How It Works

### crane and skopeo

Both tools interact with registries using the OCI Distribution Specification:

1. **crane** (Google go-containerregistry):
   ```bash
   crane digest nginx:latest
   # Output: sha256:abc123...
   ```

2. **skopeo** (Red Hat/Containers):
   ```bash
   skopeo inspect --no-tags docker://nginx:latest
   # Output: JSON with digest and metadata
   ```

### Authentication Flow

1. Tool attempts to access registry
2. Registry responds with 401 Unauthorized and auth challenge
3. Tool reads credentials from `~/.docker/config.json`
4. Tool authenticates and receives token
5. Tool accesses registry with token

This is handled automatically - you don't need to pass credentials explicitly.

## Troubleshooting

### "Rate limit exceeded" errors

**Solution:** Run `docker login` on your server

```bash
docker login
# Enter your Docker Hub username and personal access token
```

### Private images not accessible

**Solution:** Authenticate with the registry

```bash
# For GHCR private images
docker login ghcr.io -u YOUR_USERNAME -p YOUR_PAT

# For GitLab private images
docker login registry.gitlab.com -u YOUR_USERNAME -p YOUR_ACCESS_TOKEN
```

### Multiple accounts

If you need different credentials for different registries, you can configure them separately:

```bash
docker login                          # Docker Hub
docker login ghcr.io                  # GitHub
docker login registry.gitlab.com     # GitLab
```

All credentials are stored in `~/.docker/config.json` and are automatically used by crane/skopeo.

## Creating Docker Hub Personal Access Tokens

1. Go to [Docker Hub Security Settings](https://hub.docker.com/settings/security)
2. Click "New Access Token"
3. Give it a description (e.g., "Docked App")
4. Select "Read-only" permissions
5. Copy the token (you won't see it again!)
6. Use it with `docker login`:
   ```bash
   docker login -u YOUR_USERNAME -p YOUR_TOKEN
   ```

## Migration from Old Implementation

Previously, the application stored Docker Hub credentials in its own database and used the Docker Hub REST API. This has been removed because:

1. **crane/skopeo are superior:** More reliable, better maintained, registry-agnostic
2. **System credentials work better:** One login works for all tools
3. **Simpler architecture:** Less code, fewer moving parts
4. **No rate limit differences:** Registry protocol has same/better limits than REST API

**If you previously configured credentials in the app:** They are no longer used. Run `docker login` on your server instead.

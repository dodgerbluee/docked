/**
 * Runner Controller
 * Handles CRUD operations for dockhand instances, automated
 * enrollment/registration, and proxies upgrade/log SSE streams.
 */

const os = require("os");

const {
  getAllRunners,
  getRunnerById,
  getRunnerByName,
  getRunnerByNameAndUser,
  getRunnerByApiKey,
  createRunner,
  updateRunner,
  updateRunnerUrl,
  updateRunnerApiKey,
  deleteRunner,
  updateRunnerVersion,
} = require("../db/runners");
const {
  createEnrollmentToken,
  consumeEnrollmentToken,
  cleanupExpiredTokens,
} = require("../db/enrollmentTokens");
const {
  pingRunner,
  proxyUpgradeStream,
  proxyLogsStream,
  fetchRunnerOperations,
  fetchRunnerOperationHistory,
  proxyOperationRunStream,
  enrichOperationsWithVersions,
  fetchRunnerApps,
  fetchRunnerAppOperationHistory,
  fetchRunnerAppsAllHistory,
  enrichAppsWithVersions,
  proxyAppOperationRunStream,
  triggerRunnerUpdate,
  triggerRunnerUninstall,
} = require("../services/runnerService");
const githubService = require("../services/githubService");
const { resetRunnerBackoff } = require("../services/runnerVersionPoller");
const logger = require("../utils/logger");

const DOCKHAND_GITHUB_REPO = "dockedapp/dockhand";

/**
 * Build the externally-reachable URL for this Docked server.
 *
 * Priority:
 *  1. DOCKED_URL env var (explicit override)
 *  2. x-forwarded-host / x-forwarded-proto headers (reverse proxy)
 *  3. req.get("host") — but if it resolves to localhost/127.0.0.1,
 *     replace the hostname with the first non-internal IPv4 address
 *     so that remote runners (LXC, etc.) can actually reach us.
 */
function getDockedUrl(req) {
  // 1. Explicit override
  if (process.env.DOCKED_URL) {
    return process.env.DOCKED_URL.replace(/\/+$/, "");
  }

  // 2. Build from request headers
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");

  // 3. If host is localhost, try to find a LAN IP
  const hostname = host.split(":")[0];
  const port = host.split(":")[1]; // may be undefined
  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(hostname);

  if (isLocalhost) {
    const lanIp = detectLanIp();
    if (lanIp) {
      const resolved = `${proto}://${lanIp}${port ? ":" + port : ""}`;
      logger.info(
        `Enrollment URL: host was ${hostname}, resolved to LAN IP ${lanIp} → ${resolved}`
      );
      return resolved;
    }
    logger.warn(
      `Enrollment URL: host is ${hostname} but no LAN IP found. ` +
        `Runners on remote machines won't be able to reach this server. ` +
        `Set the DOCKED_URL environment variable to the externally-reachable URL.`
    );
  }

  return `${proto}://${host}`;
}

/**
 * Find the first non-internal IPv4 address on this machine.
 * Skips Docker/container virtual interfaces (docker0, br-*, veth*)
 * and common Docker bridge subnet IPs (172.16-31.x.x).
 * Returns the IP string or null if none found.
 */
function detectLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    // Skip Docker virtual interfaces on the host
    if (/^(docker|br-|veth)/.test(name)) continue;
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        // Skip Docker bridge subnet (172.16.0.0/12 — 172.16.x.x to 172.31.x.x)
        const octets = iface.address.split(".");
        const first = parseInt(octets[0], 10);
        const second = parseInt(octets[1], 10);
        if (first === 172 && second >= 16 && second <= 31) continue;
        return iface.address;
      }
    }
  }
  return null;
}

// In-memory map from enrollment token → runnerId, set when runner registers.
// Ephemeral (lost on server restart), but that's fine — the polling window is short.
const enrollmentResults = new Map(); // token → { runnerId, ts }
setInterval(
  () => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [t, entry] of enrollmentResults) {
      if (entry.ts < cutoff) enrollmentResults.delete(t);
    }
    // Also clean up expired/used DB tokens
    cleanupExpiredTokens().catch((err) => {
      logger.warn(`Failed to clean up expired enrollment tokens: ${err.message}`);
    });
  },
  30 * 60 * 1000
).unref();

// Clean up stale tokens on startup
cleanupExpiredTokens()
  .then((n) => {
    if (n > 0) logger.info(`Cleaned up ${n} expired enrollment token(s)`);
  })
  .catch((err) => {
    logger.warn(`Failed to clean up expired enrollment tokens on startup: ${err.message}`);
  });

/**
 * GET /api/runners
 */
async function getRunners(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runners = await getAllRunners(userId);
    // Never expose api_key in list response
    return res.json({ success: true, runners });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:id
 */
async function getRunner(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runner = await getRunnerById(parseInt(req.params.id, 10), userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    const { api_key: _apiKey, ...safe } = runner;
    return res.json({ success: true, runner: safe });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners
 */
async function createRunnerHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const { name, url, apiKey } = req.body;

    if (!name || !url || !apiKey) {
      return res.status(400).json({ success: false, error: "name, url, and apiKey are required" });
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ success: false, error: "URL must use http:// or https://" });
      }
    } catch {
      return res.status(400).json({ success: false, error: "Invalid URL format" });
    }

    const existing = await getRunnerByNameAndUser(name.trim(), userId);
    if (existing) {
      return res
        .status(409)
        .json({ success: false, error: "A runner with that name already exists" });
    }

    const id = await createRunner({ userId, name: name.trim(), url: url.trim(), apiKey });
    return res.status(201).json({ success: true, id, message: "Runner created successfully" });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/runners/:id
 */
async function updateRunnerHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const id = parseInt(req.params.id, 10);
    const existing = await getRunnerById(id, userId);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    const { name, url, apiKey, enabled } = req.body;

    if (!name || !url) {
      return res.status(400).json({ success: false, error: "name and url are required" });
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ success: false, error: "URL must use http:// or https://" });
      }
    } catch {
      return res.status(400).json({ success: false, error: "Invalid URL format" });
    }

    await updateRunner({
      id,
      userId,
      name: name.trim(),
      url: url.trim(),
      apiKey: apiKey || null, // null = keep existing
      enabled: enabled !== false,
    });

    return res.json({ success: true, message: "Runner updated successfully" });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/runners/:id
 */
async function deleteRunnerHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const id = parseInt(req.params.id, 10);
    const existing = await getRunnerById(id, userId);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    await deleteRunner(id, userId);
    return res.json({ success: true, message: "Runner deleted successfully" });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/:id/health
 * Checks connectivity to the runner and returns its health payload.
 */
async function healthCheckRunner(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runner = await getRunnerById(parseInt(req.params.id, 10), userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    try {
      const health = await pingRunner(runner.url, runner.api_key);

      // Fire-and-forget: persist version info without blocking the health response.
      // The GitHub release lookup (500-1500ms) is unnecessary for online/offline status.
      githubService
        .getLatestRelease(DOCKHAND_GITHUB_REPO)
        .then((latestRelease) =>
          updateRunnerVersion(
            runner.id,
            userId,
            health.version ?? null,
            latestRelease?.tag_name ?? null
          )
        )
        .catch((err) => logger.warn(`background version persist failed: ${err.message}`));

      return res.json({ success: true, online: true, health });
    } catch (err) {
      logger.warn(`Runner "${runner.name}" health check failed: ${err.message}`);
      return res.json({ success: true, online: false, error: err.message });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/:runnerId/containers/:containerId/upgrade  (SSE)
 * Proxies the runner's upgrade SSE stream to the browser.
 */
async function upgradeRunnerContainer(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { containerId } = req.params;

    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }

    await proxyUpgradeStream(runner, containerId, req, res);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:runnerId/containers/:containerId/logs  (SSE)
 * Proxies the runner's log SSE stream to the browser.
 */
async function streamRunnerContainerLogs(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { containerId } = req.params;

    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }

    const opts = {
      tail: req.query.tail || "",
      follow: req.query.follow === "true",
    };

    await proxyLogsStream(runner, containerId, opts, req, res);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/enrollment  (authenticated)
 * Generates a short-lived enrollment token and returns install commands.
 */
async function createEnrollment(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    // Fetch latest dockhand release version from GitHub (bypass cache to
    // ensure new installations always pull the most recent release)
    let dockhandVersion = "latest";
    try {
      const release = await githubService.getLatestRelease(DOCKHAND_GITHUB_REPO, {
        skipCache: true,
      });
      if (release?.tag_name) {
        // tag_name is like "v0.1.3" — strip leading "v" for the version
        dockhandVersion = release.tag_name.replace(/^v/, "");
      }
    } catch (err) {
      logger.warn(`Failed to fetch latest dockhand release: ${err.message}`);
    }

    const { token, expiresAt } = await createEnrollmentToken(userId);

    // Build the Docked server's external URL
    const dockedUrl = getDockedUrl(req);

    const installUrl = `${dockedUrl}/api/runners/install/${token}`;

    const dockerRunCmd = [
      "docker run -d",
      "  --name dockhand",
      "  --restart unless-stopped",
      "  --network host",
      "  -v /var/run/docker.sock:/var/run/docker.sock",
      "  -v dockhand_data:/var/lib/dockhand",
      `  -e DOCKHAND_ENROLLMENT_TOKEN='${token}'`,
      `  -e DOCKHAND_DOCKED_URL='${dockedUrl}'`,
      `  ghcr.io/dockedapp/dockhand:${dockhandVersion}`,
    ].join(" \\\n");

    const dockerComposeSnippet = [
      "services:",
      "  dockhand:",
      `    image: ghcr.io/dockedapp/dockhand:${dockhandVersion}`,
      "    container_name: dockhand",
      "    restart: unless-stopped",
      "    network_mode: host",
      "    volumes:",
      "      - /var/run/docker.sock:/var/run/docker.sock",
      "      - dockhand_data:/var/lib/dockhand",
      "    environment:",
      `      - DOCKHAND_ENROLLMENT_TOKEN=${token}`,
      `      - DOCKHAND_DOCKED_URL=${dockedUrl}`,
      "",
      "volumes:",
      "  dockhand_data:",
    ].join("\n");

    return res.status(201).json({
      success: true,
      token,
      expiresAt,
      dockhandVersion,
      installCommands: {
        linux: `curl -fsSL '${installUrl}' | sudo bash`,
        docker: dockerRunCmd,
        compose: dockerComposeSnippet,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/install/:token  (unauthenticated)
 * Serves a bash install script with the enrollment token baked in.
 * The script installs dockhand as a systemd service on Linux.
 */
async function serveInstallScript(req, res, next) {
  try {
    const { token } = req.params;

    if (!token || token.length < 32) {
      return res.status(400).type("text/plain").send("Invalid token");
    }

    // Build the Docked server's external URL
    const dockedUrl = getDockedUrl(req);

    // Fetch latest dockhand release version (bypass cache so the install
    // script always downloads the most recent binary)
    let dockhandVersion = "latest";
    try {
      const release = await githubService.getLatestRelease(DOCKHAND_GITHUB_REPO, {
        skipCache: true,
      });
      if (release?.tag_name) {
        dockhandVersion = release.tag_name.replace(/^v/, "");
      }
    } catch (err) {
      logger.warn(`Failed to fetch latest dockhand release for install script: ${err.message}`);
    }

    const script = generateInstallScript({
      token,
      dockedUrl,
      dockhandVersion,
      port: 7777,
    });

    res.setHeader("Content-Type", "text/x-shellscript");
    res.setHeader("Content-Disposition", "inline");
    return res.send(script);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/register  (unauthenticated)
 * Called by dockhand on first boot to register itself.
 * Validates the enrollment token, creates the runner entry.
 */
async function registerRunner(req, res, next) {
  try {
    const { token, name, url, apiKey } = req.body;

    if (!token || !name || !url || !apiKey) {
      return res.status(400).json({
        success: false,
        error: "token, name, url, and apiKey are required",
      });
    }

    // Validate URL format
    let canonicalUrl;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ success: false, error: "URL must use http:// or https://" });
      }
      canonicalUrl = parsed.toString();
    } catch {
      return res.status(400).json({ success: false, error: "Invalid URL format" });
    }

    // Consume the enrollment token
    const result = await consumeEnrollmentToken(token);
    if (!result) {
      return res.status(401).json({
        success: false,
        error: "Invalid, expired, or already used enrollment token",
      });
    }

    let runnerId;
    try {
      runnerId = await createRunner({
        userId: result.userId,
        name: name.trim(),
        url: canonicalUrl.endsWith("/") ? canonicalUrl.slice(0, -1) : canonicalUrl,
        apiKey,
      });
    } catch (createErr) {
      logger.error("Runner enrollment token consumed but runner creation failed", {
        module: "runnerController",
        userId: result.userId,
        name,
        token,
        error: createErr.message,
      });
      return res.status(500).json({
        success: false,
        error:
          "Runner enrollment token was consumed but runner creation failed. Please generate a new enrollment token and try again.",
      });
    }

    // Allow the client's polling to resolve this specific token to a runner
    enrollmentResults.set(token, { runnerId, ts: Date.now() });

    logger.info(`Runner "${name}" registered via enrollment (id=${runnerId})`, {
      module: "runnerController",
      runnerId,
    });

    return res.status(201).json({
      success: true,
      runnerId,
      message: "Runner registered successfully",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Generate the bash install script for a Linux machine.
 * @param {Object} opts
 * @param {string} opts.token - Enrollment token
 * @param {string} opts.dockedUrl - Docked server URL
 * @param {string} opts.dockhandVersion - Version to install
 * @param {number} opts.port - Port for dockhand to listen on
 * @returns {string} bash script
 */
function generateInstallScript({ token, dockedUrl, dockhandVersion, port }) {
  return `#!/usr/bin/env bash
set -euo pipefail

# Docked Runner (dockhand) installer
# Generated by Docked — this script is single-use.

DOCKED_URL="${dockedUrl}"
ENROLLMENT_TOKEN="${token}"
DOCKHAND_VERSION="${dockhandVersion}"
PORT=${port}
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/dockhand"
DATA_DIR="/var/lib/dockhand"
SERVICE_USER="$(whoami)"
SERVICE_HOME="$(eval echo ~$SERVICE_USER)"

echo "==> Installing dockhand v$DOCKHAND_VERSION for user $SERVICE_USER"

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  armv7l)  ARCH="arm" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

echo "==> Detected architecture: $ARCH"

# Download binary
DOWNLOAD_URL="https://github.com/dockedapp/dockhand/releases/download/v$DOCKHAND_VERSION/dockhand-linux-$ARCH"
echo "==> Downloading from $DOWNLOAD_URL"
mkdir -p "$INSTALL_DIR"
curl -fsSL -o "$INSTALL_DIR/dockhand" "$DOWNLOAD_URL"
chmod +x "$INSTALL_DIR/dockhand"

echo "==> Installed binary to $INSTALL_DIR/dockhand"

# Create config directory
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR"

# Check for Docker
DOCKER_ENABLED=true
if ! command -v docker &>/dev/null; then
  DOCKER_ENABLED=false
  echo "==> Docker not found — container management will be disabled"
fi

# Write config
cat > "$CONFIG_DIR/config.yaml" <<CONF
server:
  port: $PORT

runner:
  name: "$(hostname)"
  docked_url: "$DOCKED_URL"
  enrollment_token: "$ENROLLMENT_TOKEN"

docker:
  enabled: $DOCKER_ENABLED
CONF

echo "==> Wrote config to $CONFIG_DIR/config.yaml"

# Build PATH — include common binary locations
SANE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Create systemd unit
cat > /etc/systemd/system/dockhand.service <<UNIT
[Unit]
Description=Docked Runner Agent (dockhand)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Environment=HOME=$SERVICE_HOME
Environment=PATH=$SANE_PATH
ExecStart=$INSTALL_DIR/dockhand -config $CONFIG_DIR/config.yaml
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

# Fix ownership
chown -R "$SERVICE_USER" "$CONFIG_DIR" "$DATA_DIR"

# Enable and start
systemctl daemon-reload
systemctl enable dockhand
systemctl start dockhand

echo "==> dockhand service started"
echo "==> Waiting for registration with Docked server..."

# Wait briefly for dockhand to register
for i in $(seq 1 10); do
  if journalctl -u dockhand --no-pager -n 5 2>/dev/null | grep -q "registered"; then
    echo "==> Registration successful!"
    break
  fi
  sleep 2
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  dockhand v$DOCKHAND_VERSION installed successfully"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Config file:   $CONFIG_DIR/config.yaml"
echo "  Data / DB:     $DATA_DIR/"
echo "  Binary:        $INSTALL_DIR/dockhand"
echo "  Service:       dockhand (systemd)"
echo ""
echo "  Useful commands:"
echo "    systemctl status dockhand          — check service status"
echo "    journalctl -u dockhand -f          — follow live logs"
echo "    systemctl restart dockhand         — restart after config changes"
echo "    systemctl stop dockhand            — stop the service"
echo ""
echo "  Adding operations (edit the config file, then restart):"
echo "    sudo nano $CONFIG_DIR/config.yaml"
echo ""
echo "  Example operations block:"
echo "    operations:"
echo "      pull-and-restart:"
echo "        description: Pull latest images and restart compose stack"
echo "        command: docker compose -f /opt/myapp/docker-compose.yml pull && docker compose -f /opt/myapp/docker-compose.yml up -d"
echo "        working_dir: /opt/myapp"
echo "        timeout: 300"
echo ""
echo "  After editing the config, restart the service:"
echo "    sudo systemctl restart dockhand"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
`;
}

/**
 * GET /api/runners/:runnerId/operations
 * Returns the list of named operations configured on the runner.
 */
async function getRunnerOperations(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    const data = await fetchRunnerOperations(runner.url, runner.api_key);
    const enriched = await enrichOperationsWithVersions(data.operations ?? [], githubService);
    res.json({ success: true, operations: enriched });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:runnerId/operations/:name/history
 * Returns execution history for a named operation.
 */
async function getRunnerOperationHistory(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { name } = req.params;
    const limit = parseInt(req.query.limit, 10) || 20;
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    const data = await fetchRunnerOperationHistory(runner.url, runner.api_key, name, limit);
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/:runnerId/operations/:name/run  (SSE)
 * Proxies a live operation run stream from the runner to the browser.
 */
async function runRunnerOperation(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { name } = req.params;
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    await proxyOperationRunStream(runner, name, req, res);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:runnerId/apps
 * Returns the list of named apps configured on the runner.
 */
async function getRunnerApps(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    const data = await fetchRunnerApps(runner.url, runner.api_key);
    const enriched = await enrichAppsWithVersions(data.apps ?? [], githubService);
    res.json({ success: true, apps: enriched });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/:runnerId/apps/:appName/operations/:opName/run  (SSE)
 * Proxies a live app operation run stream from the runner to the browser.
 */
async function runRunnerAppOperation(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { appName, opName } = req.params;
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    await proxyAppOperationRunStream(runner, appName, opName, req, res);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:runnerId/apps/:appName/operations/:opName/history
 * Returns execution history for a named app operation.
 */
async function getRunnerAppOperationHistory(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const { appName, opName } = req.params;
    const limit = parseInt(req.query.limit, 10) || 20;
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    const data = await fetchRunnerAppOperationHistory(
      runner.url,
      runner.api_key,
      appName,
      opName,
      limit
    );
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/:runnerId/apps/history
 * Returns all app operation run history from the runner.
 */
async function getRunnerAppsHistory(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runnerId = parseInt(req.params.runnerId, 10);
    const limit = parseInt(req.query.limit, 10) || 100;
    const runner = await getRunnerById(runnerId, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }
    if (!runner.enabled) {
      return res.status(400).json({ success: false, error: "Runner is disabled" });
    }
    const data = await fetchRunnerAppsAllHistory(runner.url, runner.api_key, limit);
    // Attach runnerId/runnerName to each record for the client to group/label
    const history = (data.history || []).map((r) => ({
      ...r,
      runnerId: runner.id,
      runnerName: runner.name,
    }));
    res.json({ success: true, history });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/:id/update
 * Tells the runner to download and apply a new binary, then restart.
 */
async function updateRunnerBinary(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const runner = await getRunnerById(parseInt(req.params.id, 10), userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    // Use runner's stored latest_version, or let caller supply one
    const version = req.body?.version || runner.latest_version;
    if (!version) {
      return res.status(400).json({ success: false, error: "No target version available" });
    }

    try {
      const result = await triggerRunnerUpdate(runner, version);
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.warn(`Runner "${runner.name}" update trigger failed: ${err.message}`);
      return res.status(502).json({ success: false, error: err.message });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/:id/uninstall
 * Tells the runner to uninstall itself, then removes it from the DB.
 */
async function uninstallRunnerHandler(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const id = parseInt(req.params.id, 10);
    const runner = await getRunnerById(id, userId);
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    // 1. Send uninstall signal — fail immediately if runner is unreachable
    try {
      await triggerRunnerUninstall(runner);
    } catch (err) {
      return res
        .status(502)
        .json({ success: false, error: `Could not reach runner: ${err.message}` });
    }

    // 2. Poll health until runner goes offline (up to 30s)
    const MAX_POLLS = 15;
    let offline = false;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        await pingRunner(runner.url, runner.api_key);
        // still online — keep polling
      } catch {
        offline = true;
        break;
      }
    }

    if (!offline) {
      return res.status(408).json({
        success: false,
        error: "Runner did not go offline after 30 seconds. Uninstall may have failed.",
      });
    }

    // 3. Confirmed offline — remove from DB
    await deleteRunner(id, userId);
    return res.json({ success: true, message: "Runner uninstalled and removed" });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runners/enrollment-status?token=...  (authenticated)
 * Returns { status: 'pending' } or { status: 'registered', runner } for the given token.
 */
async function getEnrollmentStatus(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ success: false, error: "token is required" });
    }

    const entry = enrollmentResults.get(token);
    if (!entry) {
      return res.json({ success: true, status: "pending" });
    }

    const runner = await getRunnerById(entry.runnerId, userId);
    if (!runner) {
      // Registered but not visible to this user (shouldn't happen)
      return res.json({ success: true, status: "pending" });
    }

    return res.json({ success: true, status: "registered", runner });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/heartbeat  (unauthenticated)
 * Called periodically by dockhand to report its current URL, version, and
 * docker status. Authenticates via the runner's API key in the request body.
 * If the runner's URL has changed (e.g. after a container restart that
 * assigned a new IP), the stored URL is updated automatically.
 */
async function heartbeatRunner(req, res, next) {
  try {
    const { apiKey, url, version, name, dockerOk } = req.body;

    if (!apiKey || !url) {
      return res.status(400).json({
        success: false,
        error: "apiKey and url are required",
      });
    }

    // Look up the runner by its API key
    const runner = await getRunnerByApiKey(apiKey);
    if (!runner) {
      return res.status(401).json({
        success: false,
        error: "unknown",
      });
    }

    let canonicalUrl = String(url);
    while (canonicalUrl.endsWith("/")) {
      canonicalUrl = canonicalUrl.slice(0, -1);
    }
    const urlChanged = runner.url !== canonicalUrl;

    // Update URL if it changed
    if (urlChanged) {
      logger.info(
        `Runner "${runner.name}" (id=${runner.id}) URL changed: ${runner.url} → ${canonicalUrl}`,
        { module: "runnerController" }
      );
      await updateRunnerUrl(runner.id, canonicalUrl);
      // Reset version poller backoff so it immediately retries with the new URL
      resetRunnerBackoff(runner.id);
    }

    // Fire-and-forget: update version info if provided
    if (version) {
      githubService
        .getLatestRelease(DOCKHAND_GITHUB_REPO)
        .then((latestRelease) =>
          updateRunnerVersion(
            runner.id,
            runner.user_id,
            version,
            latestRelease?.tag_name ?? null,
            dockerOk !== undefined ? dockerOk : null
          )
        )
        .catch((err) => logger.warn(`heartbeat version persist failed: ${err.message}`));
    }

    return res.json({
      success: true,
      runnerId: runner.id,
      urlUpdated: urlChanged,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/runners/re-enroll  (unauthenticated, rate-limited)
 *
 * Allows a dockhand runner to re-register itself when its API key has become
 * stale (e.g. the Docked DB was rebuilt but the runner still has its old key).
 *
 * The runner identifies itself by name. If a runner with that name exists,
 * its API key and URL are updated. No enrollment token is required — the
 * rationale is that re-enrollment only updates an *existing* runner record
 * (it cannot create new ones) and the endpoint is rate-limited.
 *
 * Request body: { name, url, apiKey }
 * Response:     { success, runnerId }
 */
async function reEnrollRunner(req, res, next) {
  try {
    const { name, url, apiKey } = req.body;

    if (!name || !url || !apiKey) {
      return res.status(400).json({
        success: false,
        error: "name, url, and apiKey are required",
      });
    }

    // Validate URL format
    let canonicalUrl;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ success: false, error: "URL must use http:// or https://" });
      }
      canonicalUrl = parsed.toString();
      while (canonicalUrl.endsWith("/")) {
        canonicalUrl = canonicalUrl.slice(0, -1);
      }
    } catch {
      return res.status(400).json({ success: false, error: "Invalid URL format" });
    }

    // Find existing runner by name
    const runner = await getRunnerByName(name);
    if (!runner) {
      return res.status(404).json({
        success: false,
        error: "No runner with that name exists. Use the enrollment flow to register a new runner.",
      });
    }

    // Update the runner's API key and URL
    await updateRunnerApiKey(runner.id, apiKey, canonicalUrl);

    logger.info(`Runner "${name}" (id=${runner.id}) re-enrolled with new API key`, {
      module: "runnerController",
    });

    return res.status(200).json({
      success: true,
      runnerId: runner.id,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getRunners,
  getRunner,
  createRunnerHandler,
  updateRunnerHandler,
  deleteRunnerHandler,
  healthCheckRunner,
  upgradeRunnerContainer,
  streamRunnerContainerLogs,
  getRunnerOperations,
  getRunnerOperationHistory,
  runRunnerOperation,
  getRunnerApps,
  runRunnerAppOperation,
  getRunnerAppOperationHistory,
  getRunnerAppsHistory,
  createEnrollment,
  getEnrollmentStatus,
  serveInstallScript,
  registerRunner,
  heartbeatRunner,
  reEnrollRunner,
  updateRunnerBinary,
  uninstallRunnerHandler,
};

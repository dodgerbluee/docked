/**
 * Container Tools Utility
 *
 * Provides functions to interact with container registries using
 * command-line tools like crane and skopeo.
 *
 * These tools avoid the need for:
 * - GitHub tokens/PATs
 * - GitHub Apps
 * - API rate limits
 * - Complex authentication flows
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const logger = require("./logger");

const execFileAsync = promisify(execFile);

const IMAGE_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]+$/;
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.CONTAINER_TOOL_TIMEOUT_MS || "30000", 10);
const DEFAULT_MAX_BUFFER = 1024 * 1024;
const DEFAULT_MAX_ATTEMPTS = Number.parseInt(process.env.CONTAINER_TOOL_MAX_ATTEMPTS || "3", 10);
const AUTH_FAILURE_COOLDOWN_MS = Number.parseInt(
  process.env.CONTAINER_TOOL_AUTH_BACKOFF_MS || `${60 * 1000}`,
  10
);
const COMMAND_CACHE_TTL_MS = 5 * 60 * 1000;
const CREDENTIAL_CACHE_TTL_MS = 60 * 1000;
const DOCKER_CONFIG_FILE =
  process.env.CONTAINER_TOOLS_DOCKER_CONFIG || path.join(os.homedir(), ".docker", "config.json");
const DOCKER_CONFIG_DIR = process.env.DOCKER_CONFIG || path.dirname(DOCKER_CONFIG_FILE);
const DOCKER_CONFIG_TTL_MS = 60 * 1000;

const TRANSIENT_ERROR_PATTERNS = [
  "deadline exceeded",
  "context deadline",
  "i/o timeout",
  "connection reset",
  "connection refused",
  "temporary failure",
  "tls handshake",
  "no such host",
  "server misbehaving",
  "timeout awaiting",
  "timed out",
  "too many requests",
  "rate limit",
  "503",
  "connection closed",
  "eof",
  "broken pipe",
];

const AUTH_ERROR_PATTERNS = [
  "unauthorized",
  "authentication required",
  "no basic auth credentials",
  "requested access to the resource is denied",
  "pull access denied",
];

const NOT_FOUND_PATTERNS = [
  "manifest unknown",
  "name unknown",
  "repository does not exist",
  "not found",
];

const INVALID_REF_PATTERNS = ["invalid reference", "invalid image name", "invalid format"];

const commandAvailabilityCache = new Map();
const authFailureCache = new Map();
const credentialCache = new Map();
// Track tools that consistently fail (e.g. crane timing out) so we skip them
// for subsequent calls instead of wasting 30s+ per image on retries.
const toolFailureCache = new Map(); // tool name -> { lastFailure, failureType, count }
const TOOL_FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // Skip failing tool for 5 minutes

let cachedDockerConfig = null;
let cachedDockerConfigMtime = 0;
let cachedDockerConfigLoadedAt = 0;

function isValidImageRef(imageRef) {
  if (!imageRef || typeof imageRef !== "string") {
    return false;
  }
  if (imageRef.length > 512) {
    return false;
  }
  return IMAGE_REF_PATTERN.test(imageRef);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function combineErrorOutput(error) {
  return [error.stderr, error.stdout, error.message].filter(Boolean).join("\n").trim();
}

function sanitizeErrorSnippet(error) {
  const snippet = combineErrorOutput(error);
  if (!snippet) {
    return "";
  }
  return snippet.length > 400 ? `${snippet.slice(0, 400)}…` : snippet;
}

function extractRegistryHost(imageRef) {
  if (!imageRef || typeof imageRef !== "string") {
    return "docker.io";
  }
  const [firstSegment] = imageRef.split("/");
  if (!firstSegment) {
    return "docker.io";
  }
  if (
    firstSegment.includes(".") ||
    firstSegment.includes(":") ||
    firstSegment === "localhost" ||
    firstSegment === "127.0.0.1"
  ) {
    return firstSegment.toLowerCase();
  }
  return "docker.io";
}

function getsPossibleAuthKeys(host) {
  const normalized = host.toLowerCase();
  const keys = new Set([normalized, `https://${normalized}`, `http://${normalized}`, host]);
  if (normalized === "docker.io" || normalized === "registry-1.docker.io") {
    keys.add("https://index.docker.io/v1/");
    keys.add("index.docker.io");
    keys.add("registry-1.docker.io");
  }
  return Array.from(keys);
}

async function loadDockerConfig() {
  const now = Date.now();
  if (cachedDockerConfig && now - cachedDockerConfigLoadedAt < DOCKER_CONFIG_TTL_MS) {
    return cachedDockerConfig;
  }
  try {
    const stats = await fs.stat(DOCKER_CONFIG_FILE);
    if (!stats.isFile()) {
      cachedDockerConfig = null;
      cachedDockerConfigLoadedAt = now;
      cachedDockerConfigMtime = 0;
      return null;
    }
    if (cachedDockerConfig && stats.mtimeMs === cachedDockerConfigMtime) {
      cachedDockerConfigLoadedAt = now;
      return cachedDockerConfig;
    }
    const raw = await fs.readFile(DOCKER_CONFIG_FILE, "utf8");
    cachedDockerConfig = JSON.parse(raw);
    cachedDockerConfigMtime = stats.mtimeMs;
    cachedDockerConfigLoadedAt = now;
    return cachedDockerConfig;
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger.debug(`[containerTools] Unable to read docker config: ${error.message}`);
    }
    cachedDockerConfig = null;
    cachedDockerConfigLoadedAt = now;
    cachedDockerConfigMtime = 0;
    return null;
  }
}

async function getCredentialStatus(host) {
  const now = Date.now();
  const cached = credentialCache.get(host);
  if (cached && now - cached.checkedAt < CREDENTIAL_CACHE_TTL_MS) {
    return cached;
  }

  const dockerConfig = await loadDockerConfig();
  if (!dockerConfig) {
    const status = { hasCredentials: false, source: "missing-config", checkedAt: now };
    credentialCache.set(host, status);
    return status;
  }

  if (dockerConfig.credsStore || dockerConfig.credStore) {
    const status = { hasCredentials: true, source: "credsStore", checkedAt: now };
    credentialCache.set(host, status);
    return status;
  }

  const authKeys = getsPossibleAuthKeys(host);
  const authEntry = authKeys.find((key) => dockerConfig.auths && dockerConfig.auths[key]);
  if (authEntry) {
    const status = { hasCredentials: true, source: authEntry, checkedAt: now };
    credentialCache.set(host, status);
    return status;
  }

  if (dockerConfig.credHelpers) {
    const helperEntry = authKeys.find((key) => dockerConfig.credHelpers[key]);
    if (helperEntry) {
      const status = {
        hasCredentials: true,
        source: `credHelper:${dockerConfig.credHelpers[helperEntry]}`,
        checkedAt: now,
      };
      credentialCache.set(host, status);
      return status;
    }
  }

  const status = { hasCredentials: false, source: "none", checkedAt: now };
  credentialCache.set(host, status);
  return status;
}

function shouldSkipAuthAttempt(host, force) {
  if (force) {
    return false;
  }
  const entry = authFailureCache.get(host);
  if (!entry) {
    return false;
  }
  if (Date.now() - entry.lastFailure > AUTH_FAILURE_COOLDOWN_MS) {
    authFailureCache.delete(host);
    return false;
  }
  return true;
}

function recordAuthFailure(host, metadata) {
  authFailureCache.set(host, {
    lastFailure: Date.now(),
    metadata,
  });
}

function clearAuthFailure(host) {
  authFailureCache.delete(host);
}

function shouldSkipTool(toolName) {
  const entry = toolFailureCache.get(toolName);
  if (!entry) return false;
  if (Date.now() - entry.lastFailure > TOOL_FAILURE_COOLDOWN_MS) {
    toolFailureCache.delete(toolName);
    return false;
  }
  return true;
}

function recordToolFailure(toolName, failureType) {
  const entry = toolFailureCache.get(toolName) || { count: 0 };
  toolFailureCache.set(toolName, {
    lastFailure: Date.now(),
    failureType,
    count: entry.count + 1,
  });
}

function clearToolFailure(toolName) {
  toolFailureCache.delete(toolName);
}

function buildExecEnv() {
  const env = { ...process.env };
  if (!env.DOCKER_CONFIG && DOCKER_CONFIG_DIR) {
    env.DOCKER_CONFIG = DOCKER_CONFIG_DIR;
  }
  return env;
}

function buildPlatformArgsForCrane(platform) {
  if (!platform) {
    return [];
  }
  return ["--platform", platform];
}

function buildPlatformArgsForSkopeo(platform) {
  if (!platform) {
    return [];
  }
  const [osName, arch, variant] = platform.split("/");
  const args = [];
  if (osName) {
    args.push("--override-os", osName);
  }
  if (arch) {
    args.push("--override-arch", arch);
  }
  if (variant) {
    args.push("--override-variant", variant);
  }
  return args;
}

function isTransientExecError(error) {
  if (!error) {
    return false;
  }
  if (error.killed || error.signal) {
    return true;
  }
  if (error.code && typeof error.code === "number" && (error.code === 128 || error.code === 137)) {
    return true;
  }
  const normalized = combineErrorOutput(error).toLowerCase();
  if (!normalized) {
    return false;
  }
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function classifyToolError(error) {
  if (!error) {
    return { type: "unknown", message: "" };
  }
  if (error.code === "ENOENT") {
    return { type: "missing_binary", message: "binary not found" };
  }
  const combinedLower = combineErrorOutput(error).toLowerCase();
  if (AUTH_ERROR_PATTERNS.some((pattern) => combinedLower.includes(pattern))) {
    return { type: "auth", message: sanitizeErrorSnippet(error) };
  }
  if (NOT_FOUND_PATTERNS.some((pattern) => combinedLower.includes(pattern))) {
    return { type: "not_found", message: sanitizeErrorSnippet(error) };
  }
  if (INVALID_REF_PATTERNS.some((pattern) => combinedLower.includes(pattern))) {
    return { type: "invalid_ref", message: sanitizeErrorSnippet(error) };
  }
  if (isTransientExecError(error)) {
    return { type: "transient", message: sanitizeErrorSnippet(error) };
  }
  return { type: "unknown", message: sanitizeErrorSnippet(error) };
}

async function runCommandWithRetries(
  command,
  args,
  execOptions,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
) {
  let attempt = 0;
  let lastError;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await execFileAsync(command, args, execOptions);
    } catch (error) {
      lastError = error;
      if (!isTransientExecError(error) || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = Math.min(5000, 250 * 2 ** (attempt - 1));
      logger.debug(`[containerTools] ${command} attempt ${attempt} failed, retrying`, {
        delayMs,
        error: sanitizeErrorSnippet(error),
      });
      await delay(delayMs);
    }
  }
  throw lastError;
}

async function checkCommandAvailability(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(checker, [command], { timeout: 5000 });
    return Boolean(stdout.trim());
  } catch (_error) {
    return false;
  }
}

async function isCommandAvailable(command) {
  const now = Date.now();
  const cached = commandAvailabilityCache.get(command);
  if (cached && now - cached.checkedAt < COMMAND_CACHE_TTL_MS) {
    return cached.available;
  }
  const available = await checkCommandAvailability(command);
  commandAvailabilityCache.set(command, { available, checkedAt: now });
  return available;
}

async function getDigestWithCrane(imageRef, options = {}) {
  if (!isValidImageRef(imageRef)) {
    logger.warn(`[crane] Invalid image reference rejected: ${imageRef}`);
    return { digest: null, failure: { type: "invalid_ref", message: "invalid reference" } };
  }

  const args = ["digest", ...buildPlatformArgsForCrane(options.platform), imageRef];
  const execOptions = {
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    maxBuffer: DEFAULT_MAX_BUFFER,
    env: buildExecEnv(),
  };

  try {
    const { stdout, stderr } = await runCommandWithRetries(
      process.env.CRANE_BINARY || "crane",
      args,
      execOptions,
      options.maxAttempts || DEFAULT_MAX_ATTEMPTS
    );
    if (stderr && !stderr.includes("Pulling")) {
      logger.debug(`[crane] stderr for ${imageRef}:`, stderr);
    }
    const digest = stdout.trim();
    if (digest && digest.startsWith("sha256:")) {
      logger.debug(`[crane] Retrieved digest for ${imageRef}`, {
        digest: `${digest.substring(0, 12)}…`,
        platform: options.platform || null,
      });
      return { digest };
    }
    logger.warn(`[crane] Unexpected output for ${imageRef}`, { output: digest });
    return {
      digest: null,
      failure: { type: "invalid_output", message: "unexpected output" },
    };
  } catch (error) {
    const failure = classifyToolError(error);
    logger.debug(`[crane] Failed to get digest for ${imageRef}`, {
      failure: failure.type,
      message: failure.message,
    });
    return { digest: null, failure };
  }
}

async function getDigestWithSkopeo(imageRef, options = {}) {
  if (!isValidImageRef(imageRef)) {
    logger.warn(`[skopeo] Invalid image reference rejected: ${imageRef}`);
    return { digest: null, failure: { type: "invalid_ref", message: "invalid reference" } };
  }

  const args = [
    "inspect",
    "--no-tags",
    ...buildPlatformArgsForSkopeo(options.platform),
    `docker://${imageRef}`,
  ];
  const execOptions = {
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    maxBuffer: DEFAULT_MAX_BUFFER,
    env: buildExecEnv(),
  };

  try {
    const { stdout, stderr } = await runCommandWithRetries(
      process.env.SKOPEO_BINARY || "skopeo",
      args,
      execOptions,
      options.maxAttempts || DEFAULT_MAX_ATTEMPTS
    );
    if (stderr && !stderr.includes("Getting image source")) {
      logger.debug(`[skopeo] stderr for ${imageRef}:`, stderr);
    }
    try {
      const manifest = JSON.parse(stdout);
      const digest = manifest.Digest || manifest.digest;
      if (digest && digest.startsWith("sha256:")) {
        logger.debug(`[skopeo] Retrieved digest for ${imageRef}`, {
          digest: `${digest.substring(0, 12)}…`,
          platform: options.platform || null,
        });
        return { digest };
      }
      logger.warn(`[skopeo] Digest missing in manifest for ${imageRef}`);
      return {
        digest: null,
        failure: { type: "invalid_output", message: "digest missing" },
      };
    } catch (parseError) {
      logger.warn(`[skopeo] Failed to parse JSON for ${imageRef}: ${parseError.message}`);
      return {
        digest: null,
        failure: { type: "invalid_output", message: parseError.message },
      };
    }
  } catch (error) {
    const failure = classifyToolError(error);
    logger.debug(`[skopeo] Failed to get digest for ${imageRef}`, {
      failure: failure.type,
      message: failure.message,
    });
    return { digest: null, failure };
  }
}

async function getImageDigest(imageRef, options = {}) {
  const { platform = null, force = false } = options;
  const registryHost = options.registryHost || extractRegistryHost(imageRef);
  const execOptions = {
    platform,
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    maxAttempts: options.maxAttempts || DEFAULT_MAX_ATTEMPTS,
  };

  if (!isValidImageRef(imageRef)) {
    logger.warn(`[containerTools] Invalid image reference rejected: ${imageRef}`);
    return null;
  }

  if (shouldSkipAuthAttempt(registryHost, force)) {
    logger.debug(`[containerTools] Skipping digest lookup due to recent auth failure`, {
      registry: registryHost,
      imageRef,
    });
    return null;
  }

  const credentialStatus = await getCredentialStatus(registryHost);
  if (!credentialStatus.hasCredentials) {
    logger.debug(`[containerTools] No cached docker credentials for ${registryHost}`, {
      imageRef,
      source: credentialStatus.source,
    });
  }

  let failure = null;

  const craneBin = process.env.CRANE_BINARY || "crane";
  if (!shouldSkipTool(craneBin) && (await isCommandAvailable(craneBin))) {
    // Use maxAttempts=1 for crane so a single timeout (~30s) triggers the
    // cooldown immediately instead of retrying 3 times (wasting ~90s).
    const craneResult = await getDigestWithCrane(imageRef, { ...execOptions, maxAttempts: 1 });
    if (craneResult.digest) {
      clearAuthFailure(registryHost);
      clearToolFailure(craneBin);
      return craneResult.digest;
    }
    failure = craneResult.failure || failure;
    // If crane timed out or had a transient failure, remember it so subsequent
    // calls skip crane and go straight to skopeo (saves ~30s per image).
    if (failure?.type === "transient") {
      recordToolFailure(craneBin, failure.type);
      logger.info(`[containerTools] crane transient failure for ${imageRef}, will skip crane for ${TOOL_FAILURE_COOLDOWN_MS / 1000}s`, {
        reason: failure?.message,
      });
    } else {
      logger.debug(`[containerTools] crane did not return digest for ${imageRef}`, {
        reason: failure?.type,
      });
    }
  } else if (shouldSkipTool(craneBin)) {
    logger.debug(`[containerTools] Skipping crane (recent transient failures), going to skopeo`);
  } else {
    logger.warn("[containerTools] crane not found in PATH, skipping");
  }

  const skopeoBin = process.env.SKOPEO_BINARY || "skopeo";
  if (!shouldSkipTool(skopeoBin) && (await isCommandAvailable(skopeoBin))) {
    const skopeoResult = await getDigestWithSkopeo(imageRef, execOptions);
    if (skopeoResult.digest) {
      clearAuthFailure(registryHost);
      clearToolFailure(skopeoBin);
      return skopeoResult.digest;
    }
    failure = skopeoResult.failure || failure;
    if (failure?.type === "transient") {
      recordToolFailure(skopeoBin, failure.type);
    }
  } else if (shouldSkipTool(skopeoBin)) {
    logger.debug(`[containerTools] Skipping skopeo (recent transient failures)`);
  } else {
    logger.warn("[containerTools] skopeo not found in PATH, skipping");
  }

  if (!failure && !credentialStatus.hasCredentials) {
    failure = { type: "auth", message: "credentials missing" };
  }

  if (failure?.type === "auth") {
    recordAuthFailure(registryHost, failure);
    logger.warn(
      `[containerTools] Authentication failed for ${registryHost}. Run 'docker login ${registryHost}' on the host to provide credentials.`,
      {
        imageRef,
        failure: failure.message,
      }
    );
  }

  if (
    !failure &&
    !(await isCommandAvailable(craneBin)) &&
    !(await isCommandAvailable(skopeoBin))
  ) {
    logger.warn(
      `[containerTools] Neither crane nor skopeo is available. Please install one of them.`
    );
  }

  return null;
}

module.exports = {
  getImageDigest,
  getDigestWithCrane,
  getDigestWithSkopeo,
  isCommandAvailable,
};

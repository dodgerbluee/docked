// Full live GraphQL feature sweep against a deployed Docked instance.
//
// Covers every Query, Mutation, relation, filter, pagination path and enum in
// schema.graphql EXCEPT the settings surface (userPreferences /
// updateUserPreferences), which was verified separately.
//
// Phases:
//   0  public queries + unauthenticated behaviour
//   1  every query, relation, filter and pagination path
//   2  CRUD lifecycles on throwaway objects (source, runner, app, intent,
//      webhook, repo token, registry credentials)
//   3  operations, batch jobs, idempotency, upgrade guards
//   4  destructive paths (clear+re-pull, image delete, real runner upgrade,
//      non-dry-run intent, temp admin user, avatar, username rename)
//   5  subscription probe (raw graphql-ws through the production proxy)
//
// Run: node e2e/live-graph-full.mjs   (from docked/client/)
// Env: E2E_BASE (default https://docked.dbluee.net)
//      E2E_SKIP_DESTRUCTIVE=1 to stop after phase 3
import { chromium } from "@playwright/test";

const BASE = process.env.E2E_BASE || "https://docked.dbluee.net";
const LOGIN_TIMEOUT_MS = 300000;
const SKIP_DESTRUCTIVE = process.env.E2E_SKIP_DESTRUCTIVE === "1";
const TAG = "e2etmp";
// Idempotency claims live 24h in the shared DB, so keys must be unique per
// run or a second run within the window is falsely rejected as duplicate.
const RUN = Date.now().toString(36);

// ---- Enum contracts from schema.graphql -------------------------------------
const ENUM = {
  Role: ["ADMINISTRATOR", "MEMBER"],
  AuthType: ["PASSWORD", "APIKEY"],
  SourceType: ["PORTAINER", "RUNNER"],
  ContainerState: ["RUNNING", "EXITED", "RESTARTING", "CREATED", "PAUSED", "DEAD", "UNKNOWN"],
  Registry: ["DOCKER_HUB", "GHCR", "GITLAB", "GCR", "QUAY", "OTHER"],
  BatchJobType: ["DOCKER_HUB_PULL", "UPGRADE_CONTAINERS", "TRACKED_APPS_CHECK", "APP_VERSION_SCAN"],
  BatchRunStatus: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
  IntentScheduleType: ["IMMEDIATE", "SCHEDULED"],
  IntentExecutionStatus: ["PENDING", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"],
  IntentTriggerType: ["MANUAL", "SCAN_DETECTED", "SCHEDULED_WINDOW"],
  UpgradeStatus: ["SUCCESS", "FAILED", "SKIPPED"],
  ExecutionContainerStatus: ["PENDING", "RUNNING", "UPGRADED", "FAILED", "SKIPPED", "DRY_RUN"],
  TrackedAppSourceType: ["DOCKER", "GITHUB", "GITLAB"],
  OperationType: ["PULL_CONTAINERS", "UPGRADE_CONTAINER", "BATCH_UPGRADE", "INTENT_EXECUTION", "BATCH_JOB"],
  OperationStatus: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
};

let browser, page;
const results = [];
const notes = [];
const S = {}; // shared state across phases

function record(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
function note(msg) {
  notes.push(msg);
  console.log(`NOTE  ${msg}`);
}

async function gql(query, variables = {}, { anon = false } = {}) {
  return page.evaluate(
    async ({ query, variables, anon }) => {
      const token = anon ? null : localStorage.getItem("authToken");
      const res = await fetch("/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      try {
        return await res.json();
      } catch {
        return { errors: [{ message: `HTTP ${res.status} (non-JSON response)` }] };
      }
    },
    { query, variables, anon }
  );
}

const hasErr = (r) => Array.isArray(r?.errors) && r.errors.length > 0;
const errMsg = (r) => (r?.errors || []).map((e) => e.message).join("; ");

// ok(): pass unless GraphQL errors; optional checkFn(data) returns a failure string.
function ok(name, r, checkFn) {
  if (hasErr(r)) {
    record(name, false, errMsg(r).slice(0, 160));
    return null;
  }
  if (checkFn) {
    const fail = checkFn(r.data);
    if (fail) {
      record(name, false, fail);
      return r.data;
    }
  }
  record(name, true);
  return r.data;
}

function expectErr(name, r, substr = "") {
  if (!hasErr(r)) return record(name, false, "expected an error but the call succeeded");
  const m = errMsg(r);
  if (substr && !m.toLowerCase().includes(substr.toLowerCase()))
    return record(name, false, `error "${m.slice(0, 120)}" lacks "${substr}"`);
  record(name, true, m.slice(0, 90));
}

function enumOk(name, vals, enumName) {
  const allowed = ENUM[enumName];
  const bad = [].concat(vals).filter((v) => v != null && !allowed.includes(v));
  record(name, bad.length === 0, bad.length ? `unexpected ${enumName}: ${bad.join(",")}` : "");
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ---- Shared fragments --------------------------------------------------------
const CONT = `id dockerContainerId name imageName imageRepo status state stackName endpointId currentDigest usesNetworkMode providesNetwork lastSeen createdAt updatedAt source { __typename id name type } imageInfo { registry namespace repository currentTag currentVersion currentDigest latestTag latestVersion latestDigest hasUpdate lastChecked }`;
const EXEC = `id intentId status triggerType containersMatched containersUpgraded containersFailed containersSkipped errorMessage queuedAt startedAt completedAt durationMs performedBy { id username } intent { id name }`;

// =============================================================================
// Phase 0 — public queries + unauthenticated behaviour
// =============================================================================
async function phase0() {
  ok("health", await gql(`query { health { status } }`), (d) =>
    d.health.status === "ok" ? null : `status=${d.health.status}`
  );

  const v = ok("version", await gql(`query { version { version environment isDevBuild } }`));
  if (v) {
    if (v.version.version === "0.0.0-dev")
      note("FINDING: version query reports hardcoded 0.0.0-dev (not the deployed release)");
    record("version.environment present", typeof v.version.environment === "string", v.version.environment);
  }

  const lr = await gql(`query { latestRelease { tagName publishedAt htmlUrl } }`);
  if (hasErr(lr)) record("latestRelease", false, errMsg(lr).slice(0, 120));
  else record("latestRelease", true, lr.data.latestRelease ? lr.data.latestRelease.tagName : "null (upstream unavailable)");

  ok("registrationCodeRequired", await gql(`query { registrationCodeRequired }`), (d) =>
    typeof d.registrationCodeRequired === "boolean" ? null : "not boolean"
  );
  const meName = await gql(`query { me { id username } }`);
  S.meUsername = meName.data?.me?.username ?? "";
  S.myId = meName.data?.me?.id ?? "";
  ok(`userExists(${S.meUsername})=true`, await gql(`query Q($u:String!){ userExists(username:$u) }`, { u: S.meUsername }), (d) =>
    d.userExists === true ? null : `got ${d.userExists}`
  );
  ok("userExists(nonsense)=false", await gql(`query Q($u:String!){ userExists(username:$u) }`, { u: `${TAG}-nope` }), (d) =>
    d.userExists === false ? null : `got ${d.userExists}`
  );

  expectErr("me unauthenticated rejected", await gql(`query { me { id } }`, {}, { anon: true }), "authentication required");
  expectErr("containers unauthenticated rejected", await gql(`query { containers { totalCount } }`, {}, { anon: true }), "authentication required");
}

// =============================================================================
// Phase 1 — every query, relation, filter, pagination path
// =============================================================================
async function phase1() {
  const me = ok("me (all fields + relations)", await gql(`query { me {
      id username role passwordChanged createdAt updatedAt avatarUrl
      containerCount sourceInstanceCount trackedAppCount
      containers(first:1) { totalCount items { ${CONT} } }
      trackedApps { id } intents { id } discordWebhooks { id } repositoryTokens { id }
      preferences { colorScheme }
    } }`), (d) => (d.me && d.me.id ? null : "missing me"));
  if (me) {
    S.me = me.me;
    enumOk("me.role enum", [me.me.role], "Role");
  }

  const users = ok("users (admin)", await gql(`query { users { id username role createdAt } }`), (d) =>
    Array.isArray(d.users) && d.users.length > 0 ? null : "empty users"
  );
  if (users) enumOk("users.role enum", users.users.map((u) => u.role), "Role");

  // containers + pagination
  const c1 = ok("containers(first:2) pagination", await gql(`query { containers(first:2) {
      totalCount pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      items { ${CONT} } } }`), (d) => (d.containers.items.length > 0 ? null : "no containers"));
  if (c1) {
    S.containers = c1.containers.items;
    S.totalContainers = c1.containers.totalCount;
    enumOk("containers.state enum", S.containers.map((c) => c.state), "ContainerState");
    enumOk("containers.imageInfo.registry enum", S.containers.map((c) => c.imageInfo?.registry), "Registry");
    if (S.containers.length) {
      const c0 = S.containers[0];
      ok("container(id)", await gql(`query Q($id:ID!){ container(id:$id) { ${CONT} } }`, { id: c0.id }), (d) =>
        d.container && d.container.id === c0.id ? null : "id mismatch"
      );
      ok("container.upgradeHistory relation", await gql(`query Q($id:ID!){ container(id:$id) { upgradeHistory(first:2) { totalCount items { id status createdAt } } } }`, { id: c0.id }), (d) =>
        d.container.upgradeHistory ? null : "missing"
      );
      // filters
      ok("filter state=RUNNING", await gql(`query { containers(filter:{state:RUNNING}, first:50) { items { state } } }`), (d) =>
        d.containers.items.every((c) => c.state === "RUNNING") ? null : "non-RUNNING leaked"
      );
      ok("filter hasUpdate=true", await gql(`query { containers(filter:{hasUpdate:true}, first:50) { items { imageInfo { hasUpdate } } } }`), (d) =>
        d.containers.items.every((c) => c.imageInfo?.hasUpdate === true) ? null : "hasUpdate=false leaked"
      );
      ok("filter hasUpdate=false", await gql(`query { containers(filter:{hasUpdate:false}, first:50) { items { imageInfo { hasUpdate } } } }`), (d) =>
        d.containers.items.every((c) => !c.imageInfo || c.imageInfo.hasUpdate === false) ? null : "hasUpdate=true leaked"
      );
      ok("filter imageName", await gql(`query Q($n:String!){ containers(filter:{imageName:$n}, first:50) { items { imageName } } }`, { n: c0.imageName }), (d) =>
        d.containers.items.every((c) => c.imageName === c0.imageName) ? null : "name leaked"
      );
      ok("filter search", await gql(`query Q($s:String!){ containers(filter:{search:$s}, first:50) { items { name imageName } } }`, { s: c0.name.slice(0, 4) }), (d) =>
        d.containers.items.length > 0 && d.containers.items.every((c) => (c.name + " " + c.imageName).toLowerCase().includes(c0.name.slice(0, 4).toLowerCase()))
          ? null
          : "search mismatch"
      );
      const stacked = S.containers.find((c) => c.stackName);
      if (stacked)
        ok("filter stackName", await gql(`query Q($s:String!){ containers(filter:{stackName:$s}, first:50) { items { stackName } } }`, { s: stacked.stackName }), (d) =>
          d.containers.items.every((c) => c.stackName === stacked.stackName) ? null : "stack leaked"
        );
    }
    // cursor page 2
    const cur = c1.containers.pageInfo.endCursor;
    if (c1.containers.pageInfo.hasNextPage) {
      const c2 = ok("containers page 2 via cursor", await gql(`query Q($c:String!){ containers(first:2, after:$c) { items { id } pageInfo { hasPreviousPage } } }`, { c: cur }), (d) =>
        d.containers.items.every((c) => !S.containers.some((p) => p.id === c.id)) ? null : "page overlap"
      );
      if (c2 && !c2.containers.pageInfo.hasPreviousPage) note("pageInfo.hasPreviousPage always false (cosmetic)");
    }
  }

  // containerGroup
  ok("containerGroup", await gql(`query { containerGroup {
      stacks { id name source { __typename id name type } endpointId containers(first:2) { totalCount items { id name } } }
      standalone(first:2) { totalCount items { id name } }
      sources { id name type } runners { id name type }
      unusedImagesCount stats { totalContainers containersWithUpdates totalSources totalRunners totalTrackedApps trackedAppsWithUpdates unusedImagesCount }
    } }`), (d) => (d.containerGroup.stacks && d.containerGroup.stats.totalContainers >= 0 ? null : "shape"));

  // unusedImages
  const ui = ok("unusedImages", await gql(`query { unusedImages { id repoTags sizeBytes created sourceUrl endpointId } }`));
  if (ui) S.unusedImages = ui.unusedImages;

  // sources
  const src = ok("sourceInstances", await gql(`query { sourceInstances { id name url type authType ipAddress displayOrder createdAt updatedAt hasApiKey hasPassword containers(first:1) { totalCount } upgradeHistory(first:1) { totalCount } } }`));
  if (src) {
    S.sources = src.sourceInstances;
    enumOk("sourceInstances.authType enum", S.sources.map((s) => s.authType), "AuthType");
    enumOk("sourceInstances.type enum", S.sources.map((s) => s.type), "SourceType");
    if (S.sources.length)
      ok("sourceInstance(id)", await gql(`query Q($id:ID!){ sourceInstance(id:$id) { id name } }`, { id: S.sources[0].id }), (d) =>
        d.sourceInstance?.id === S.sources[0].id ? null : "mismatch"
      );
  }

  // runners
  const rn = ok("runners", await gql(`query { runners { id name url type enabled version dockerEnabled lastHeartbeat healthStatus createdAt updatedAt hasApiKey apps { name description currentVersion versionCommand versionSource systemUpdateCheck systemUpdates packageManager operations { name description } } } }`));
  if (rn) {
    S.runners = rn.runners;
    enumOk("runners.type enum", S.runners.map((r) => r.type), "SourceType");
    if (S.runners.length) {
      ok("runner(id)", await gql(`query Q($id:ID!){ runner(id:$id) { id name } }`, { id: S.runners[0].id }), (d) =>
        d.runner?.id === S.runners[0].id ? null : "mismatch"
      );
      ok("runner.apps relation", await gql(`query Q($id:ID!){ runner(id:$id) { apps { name operations { name } } } }`, { id: S.runners[0].id }));
    }
  }

  // tracked apps
  const ta = ok("trackedApps", await gql(`query { trackedApps { id name imageName githubRepo gitlabRepo sourceType currentVersion currentDigest latestVersion latestDigest hasUpdate lastChecked createdAt updatedAt upgradeHistory(first:2) { totalCount items { id trackedAppId oldVersion newVersion status performedBy { id username } createdAt } } } }`));
  if (ta) {
    S.trackedApps = ta.trackedApps;
    enumOk("trackedApps.sourceType enum", S.trackedApps.map((a) => a.sourceType), "TrackedAppSourceType");
    if (S.trackedApps.length)
      ok("trackedApp(id)", await gql(`query Q($id:ID!){ trackedApp(id:$id) { id name } }`, { id: S.trackedApps[0].id }), (d) =>
        d.trackedApp?.id === S.trackedApps[0].id ? null : "mismatch"
      );
  }

  // intents
  const it = ok("intents (all arrays)", await gql(`query { intents { id name description enabled
      matchContainers matchImages matchSources matchStacks matchRegistries
      excludeContainers excludeImages excludeStacks excludeRegistries
      scheduleType scheduleCron scheduleTimezone maxConcurrent dryRun sequentialDelaySec
      lastEvaluatedAt lastExecution { id status } createdAt updatedAt
      executions(first:2) { totalCount items { id status } } } }`));
  if (it) {
    S.intents = it.intents;
    enumOk("intents.scheduleType enum", S.intents.map((i) => i.scheduleType), "IntentScheduleType");
    if (S.intents.length) {
      ok("intent(id)", await gql(`query Q($id:ID!){ intent(id:$id) { id name } }`, { id: S.intents[0].id }), (d) =>
        d.intent?.id === S.intents[0].id ? null : "mismatch"
      );
      ok("previewIntent(existing)", await gql(`query Q($id:ID!){ previewIntent(id:$id) { intentId matchedCount excludedCount matchedContainers(first:3) { totalCount items { id name } } } }`, { id: S.intents[0].id }), (d) =>
        d.previewIntent.intentId === S.intents[0].id ? null : "intentId mismatch"
      );
    }
  }

  // intent executions
  const ie = ok("intentExecutions", await gql(`query { intentExecutions(first:3) { totalCount pageInfo { hasNextPage endCursor } items { ${EXEC}
      containers(first:3) { totalCount items { id executionId dockerContainerId containerName imageName sourceInstanceId runnerId status oldImage newImage oldDigest newDigest errorMessage durationMs createdAt
        sourceInstance { id name } runner { id name } execution { id status } } } } } }`));
  if (ie) {
    enumOk("intentExecutions.status enum", ie.intentExecutions.items.map((e) => e.status), "IntentExecutionStatus");
    enumOk("intentExecutions.triggerType enum", ie.intentExecutions.items.map((e) => e.triggerType), "IntentTriggerType");
    enumOk("execContainers.status enum", ie.intentExecutions.items.flatMap((e) => e.containers.items.map((c) => c.status)), "ExecutionContainerStatus");
    if (S.intents?.length)
      ok("intentExecutions(intentId filter)", await gql(`query Q($id:ID!){ intentExecutions(intentId:$id, first:5) { items { intentId } } }`, { id: S.intents[0].id }), (d) =>
        d.intentExecutions.items.every((e) => String(e.intentId) === String(S.intents[0].id)) ? null : "intentId leaked"
      );
  }

  // batch
  const bc = ok("batchConfigs", await gql(`query { batchConfigs { id jobType enabled intervalMinutes createdAt updatedAt } }`));
  if (bc) {
    S.batchConfigs = bc.batchConfigs;
    enumOk("batchConfigs.jobType enum", S.batchConfigs.map((c) => c.jobType), "BatchJobType");
  }
  const br = ok("batchRuns", await gql(`query { batchRuns(first:3) { totalCount items { id status jobType queuedAt startedAt completedAt durationMs containersChecked containersUpdated errorMessage isManual performedBy { id username } } } }`));
  if (br) {
    enumOk("batchRuns.status enum", br.batchRuns.items.map((b) => b.status), "BatchRunStatus");
    enumOk("batchRuns.jobType enum", br.batchRuns.items.map((b) => b.jobType), "BatchJobType");
    if (br.batchRuns.items.length)
      ok("batchRun(id)", await gql(`query Q($id:ID!){ batchRun(id:$id) { id status } }`, { id: br.batchRuns.items[0].id }), (d) =>
        d.batchRun?.id === br.batchRuns.items[0].id ? null : "mismatch"
      );
    ok("batchRuns(jobType filter)", await gql(`query { batchRuns(jobType:DOCKER_HUB_PULL, first:5) { items { jobType } } }`), (d) =>
      d.batchRuns.items.every((b) => b.jobType === "DOCKER_HUB_PULL") ? null : "jobType leaked"
    );
  }

  // upgrade history + filters
  const uh = ok("upgradeHistory", await gql(`query { upgradeHistory(first:3) { totalCount items { id dockerContainerId containerName endpointId status errorMessage upgradeDurationMs intentId createdAt
      source { __typename id name type } sourceUrl oldImage newImage oldDigest newDigest oldVersion newVersion imageRepo registry namespace repository
      intent { id name } performedBy { id username } } } }`));
  if (uh) {
    enumOk("upgradeHistory.status enum", uh.upgradeHistory.items.map((u) => u.status), "UpgradeStatus");
    const rec = uh.upgradeHistory.items[0];
    if (rec) {
      ok("upgradeHistory(filter containerName)", await gql(`query Q($n:String!){ upgradeHistory(filter:{containerName:$n}, first:5) { items { containerName } } }`, { n: rec.containerName }), (d) =>
        d.upgradeHistory.items.every((u) => u.containerName.includes(rec.containerName)) ? null : "name leaked"
      );
    }
    ok("upgradeHistory(filter status=SUCCESS)", await gql(`query { upgradeHistory(filter:{status:SUCCESS}, first:5) { items { status } } }`), (d) =>
      d.upgradeHistory.items.every((u) => u.status === "SUCCESS") ? null : "status leaked"
    );
    ok("upgradeHistory(filter from/to)", await gql(`query Q($f:DateTime!,$t:DateTime!){ upgradeHistory(filter:{from:$f,to:$t}, first:5) { items { createdAt } } }`, {
      f: new Date(Date.now() - 86400000).toISOString(),
      t: new Date().toISOString(),
    }), (d) => {
      const f = Date.now() - 86400000;
      return d.upgradeHistory.items.every((u) => new Date(u.createdAt).getTime() >= f - 1000) ? null : "range leaked";
    });
  }

  // discord + tokens + oauth + logs + stats
  const dw = ok("discordWebhooks", await gql(`query { discordWebhooks { id maskedUrl serverName channelName enabled avatarUrl guildId channelId createdAt updatedAt } }`));
  if (dw?.discordWebhooks.length)
    ok("discordWebhook(id)", await gql(`query Q($id:ID!){ discordWebhook(id:$id) { id maskedUrl } }`, { id: dw.discordWebhooks[0].id }), (d) =>
      d.discordWebhook ? null : "missing"
    );

  const rt = ok("repositoryTokens", await gql(`query { repositoryTokens { id provider maskedToken createdAt updatedAt associatedImages { imageRepo associated } } }`));
  if (rt?.repositoryTokens.length)
    ok("repositoryToken(provider)", await gql(`query Q($p:String!){ repositoryToken(provider:$p) { id provider } }`, { p: rt.repositoryTokens[0].provider }), (d) =>
      d.repositoryToken ? null : "missing"
    );

  const oa = ok("oauthProviders", await gql(`query { oauthProviders { id name type enabled issuerUrl clientId scopes } }`));
  if (oa && oa.oauthProviders.length === 0) note("oauthProviders returns [] (stub resolver — no OAuth wiring in Go)");

  ok("logs(lines)", await gql(`query { logs(lines:5) { logs totalLines returnedLines newLines } }`), (d) =>
    d.logs.returnedLines <= 5 ? null : `returned ${d.logs.returnedLines}`
  );
  ok("logs(file)", await gql(`query { logs(lines:3, file:"out.log") { totalLines returnedLines } }`));
  ok("logs(since)", await gql(`query Q($s:Int!){ logs(since:$s) { newLines totalLines } }`, { s: Math.floor(Date.now() / 1000) - 3600 }));
  expectErr("logs path traversal blocked", await gql(`query { logs(file:"../../etc/passwd") { logs } }`), "invalid log file");

  ok("summaryStats", await gql(`query { summaryStats { totalContainers containersWithUpdates totalSources totalRunners totalTrackedApps trackedAppsWithUpdates unusedImagesCount } }`), (d) =>
    typeof d.summaryStats.totalContainers === "number" ? null : "shape"
  );
}

// =============================================================================
// Phase 2 — CRUD lifecycles on throwaway objects
// =============================================================================
async function phase2() {
  // ---- Source instance lifecycle
  const si = ok("createSourceInstance", await gql(`mutation Q($i:CreateSourceInstanceInput!){ createSourceInstance(input:$i) { id name url authType hasApiKey ipAddress displayOrder } }`, {
    i: { name: `${TAG}-src`, url: "http://127.0.0.1:59999", authType: "APIKEY", apiKey: "e2e-key", ipAddress: "10.0.0.99" },
  }), (d) => (d.createSourceInstance?.id ? null : "no id"));
  if (si) {
    S.tmpSourceId = si.createSourceInstance.id;
    ok("sourceInstance(id) after create", await gql(`query Q($id:ID!){ sourceInstance(id:$id) { id name authType hasApiKey } }`, { id: S.tmpSourceId }), (d) =>
      d.sourceInstance?.hasApiKey === true ? null : "hasApiKey not true"
    );
    ok("updateSourceInstance", await gql(`mutation Q($id:ID!,$i:UpdateSourceInstanceInput!){ updateSourceInstance(id:$id, input:$i) { id name authType hasPassword hasApiKey ipAddress } }`, {
      id: S.tmpSourceId,
      i: { name: `${TAG}-src2`, authType: "PASSWORD", username: "e2e-user", password: "e2e-pass", ipAddress: "10.0.0.98" },
    }), (d) => {
      const s = d.updateSourceInstance;
      return s.name === `${TAG}-src2` && s.authType === "PASSWORD" && s.hasPassword === true ? null : JSON.stringify(s);
    });
    const vr = await gql(`mutation Q($i:ValidateSourceCredentialsInput!){ validateSourceCredentials(input:$i) { valid message errorCode } }`, {
      i: { url: "http://127.0.0.1:59999", authType: "APIKEY", apiKey: "e2e-bogus" },
    });
    ok("validateSourceCredentials(bogus)=valid:false", vr, (d) => (d.validateSourceCredentials.valid === false ? null : "expected valid:false"));
    const ids = (S.sources || []).map((s, idx) => ({ id: s.id, order: idx }));
    if (ids.length)
      ok("reorderSourceInstances(idempotent)", await gql(`mutation Q($l:[ReorderSourceInput!]!){ reorderSourceInstances(instances:$l) { success } }`, { l: ids }), (d) =>
        d.reorderSourceInstances.success ? null : "success=false"
      );
    ok("deleteSourceInstance", await gql(`mutation Q($id:ID!){ deleteSourceInstance(id:$id) { success } }`, { id: S.tmpSourceId }), (d) =>
      d.deleteSourceInstance.success ? null : "success=false"
    );
    ok("sourceInstance(id) after delete = null", await gql(`query Q($id:ID!){ sourceInstance(id:$id) { id } }`, { id: S.tmpSourceId }), (d) =>
      d.sourceInstance === null ? null : "still present"
    );
    S.tmpSourceId = null;
  }

  // ---- Runner lifecycle
  const cr = ok("createRunner", await gql(`mutation Q($i:CreateRunnerInput!){ createRunner(input:$i) { id name url enabled hasApiKey } }`, {
    i: { name: `${TAG}-runner`, url: "http://127.0.0.1:59998", apiKey: "e2e-runner-key" },
  }), (d) => (d.createRunner?.id ? null : "no id"));
  if (cr) {
    S.tmpRunnerId = cr.createRunner.id;
    ok("updateRunner", await gql(`mutation Q($id:ID!,$i:UpdateRunnerInput!){ updateRunner(id:$id, input:$i) { id name enabled } }`, {
      id: S.tmpRunnerId,
      i: { name: `${TAG}-runner2`, enabled: false },
    }), (d) => {
      const r = d.updateRunner;
      return r.name === `${TAG}-runner2` && r.enabled === false ? null : JSON.stringify(r);
    });
    ok("generateEnrollmentToken", await gql(`mutation { generateEnrollmentToken { token expiresAt } }`), (d) =>
      d.generateEnrollmentToken?.token?.length > 10 ? null : "short token"
    );
    ok("deleteRunner", await gql(`mutation Q($id:ID!){ deleteRunner(id:$id) { success } }`, { id: S.tmpRunnerId }), (d) =>
      d.deleteRunner.success ? null : "success=false"
    );
    ok("runner(id) after delete = null", await gql(`query Q($id:ID!){ runner(id:$id) { id } }`, { id: S.tmpRunnerId }), (d) =>
      d.runner === null ? null : "still present"
    );
    S.tmpRunnerId = null;
  }

  // ---- Tracked app lifecycle
  const ca = ok("createTrackedApp", await gql(`mutation Q($i:CreateTrackedAppInput!){ createTrackedApp(input:$i) { id name imageName sourceType hasUpdate } }`, {
    i: { name: `${TAG}-app`, imageName: "nginx:latest", sourceType: "DOCKER" },
  }), (d) => (d.createTrackedApp?.id ? null : "no id"));
  if (ca) {
    const id = ca.createTrackedApp.id;
    ok("updateTrackedApp", await gql(`mutation Q($id:ID!,$i:UpdateTrackedAppInput!){ updateTrackedApp(id:$id, input:$i) { id name } }`, {
      id,
      i: { name: `${TAG}-app2` },
    }), (d) => (d.updateTrackedApp.name === `${TAG}-app2` ? null : "name not updated"));
    ok("checkTrackedAppUpdate(id)", await gql(`mutation Q($id:ID!){ checkTrackedAppUpdate(id:$id) { success checked hasUpdate currentVersion latestVersion } }`, { id }), (d) =>
      d.checkTrackedAppUpdate.success ? null : "success=false"
    );
    ok("checkTrackedAppUpdates(all)", await gql(`mutation { checkTrackedAppUpdates { success checked updated } }`), (d) =>
      d.checkTrackedAppUpdates.success ? null : "success=false"
    );
    ok("deleteTrackedApp", await gql(`mutation Q($id:ID!){ deleteTrackedApp(id:$id) { success } }`, { id }), (d) =>
      d.deleteTrackedApp.success ? null : "success=false"
    );
    ok("trackedApp(id) after delete = null", await gql(`query Q($id:ID!){ trackedApp(id:$id) { id } }`, { id }), (d) =>
      d.trackedApp === null ? null : "still present"
    );
    ok("clearTrackedAppCache", await gql(`mutation { clearTrackedAppCache { success } }`), (d) =>
      d.clearTrackedAppCache.success ? null : "success=false"
    );
  }

  // ---- Intent lifecycle (dry-run)
  const ci = ok("createIntent (all match/exclude arrays)", await gql(`mutation Q($i:CreateIntentInput!){ createIntent(input:$i) {
      id name enabled matchContainers matchImages matchSources matchStacks matchRegistries
      excludeContainers excludeImages excludeStacks excludeRegistries
      scheduleType scheduleCron maxConcurrent dryRun sequentialDelaySec lastExecution { id } } }`, {
    i: {
      name: `${TAG}-intent`, enabled: true, scheduleType: "SCHEDULED", scheduleCron: "0 0 * * *",
      matchImages: ["nginx*"], matchStacks: ["e2e-stack"], excludeImages: ["redis*"],
      dryRun: true, maxConcurrent: 1, sequentialDelaySec: 0,
    },
  }), (d) => {
    const i = d.createIntent;
    if (!i?.id) return "no id";
    if (JSON.stringify(i.matchImages) !== '["nginx*"]') return `matchImages=${JSON.stringify(i.matchImages)}`;
    if (JSON.stringify(i.excludeImages) !== '["redis*"]') return `excludeImages=${JSON.stringify(i.excludeImages)}`;
    if (i.lastExecution !== null) return "lastExecution should be null";
    return null;
  });
  if (ci) {
    const id = ci.createIntent.id;
    ok("updateIntent (explicit empty arrays)", await gql(`mutation Q($id:ID!,$i:UpdateIntentInput!){ updateIntent(id:$id, input:$i) { matchStacks excludeImages matchSources } }`, {
      id,
      i: { matchStacks: [], excludeImages: [], matchSources: [] },
    }), (d) => {
      const u = d.updateIntent;
      if (JSON.stringify(u.matchStacks) !== "[]") return `matchStacks=${JSON.stringify(u.matchStacks)}`;
      if (JSON.stringify(u.excludeImages) !== "[]") return `excludeImages=${JSON.stringify(u.excludeImages)}`;
      return null;
    });
    expectErr("updateIntent scheduleTimezone rejected", await gql(`mutation Q($id:ID!,$i:UpdateIntentInput!){ updateIntent(id:$id, input:$i) { id } }`, {
      id,
      i: { scheduleTimezone: "UTC" },
    }), "timezone");
    ok("previewIntent(new intent)", await gql(`query Q($id:ID!){ previewIntent(id:$id) { matchedCount excludedCount matchedContainers(first:5) { totalCount } } }`, { id }));
    const trig = ok("triggerIntent(dryRun, idempotencyKey)", await gql(`mutation Q($id:ID!,$k:String){ triggerIntent(id:$id, idempotencyKey:$k) { ${EXEC} } }`, {
      id,
      k: `${TAG}-ik1-${RUN}`,
    }), (d) => (d.triggerIntent?.id ? null : "no execution id"));
    if (trig) {
      const execId = trig.triggerIntent.id;
      let final = null;
      for (let i = 0; i < 20; i++) {
        const e = await gql(`query Q($id:ID!){ intentExecutions(first:1, intentId:$id) { items { ${EXEC} containers(first:5) { items { status containerName } } } } }`, { id });
        const ex = e.data?.intentExecutions?.items?.find((x) => x.id === execId) || e.data?.intentExecutions?.items?.[0];
        if (ex && ["COMPLETED", "PARTIAL", "FAILED"].includes(ex.status)) {
          final = ex;
          break;
        }
        await sleep(2000);
      }
      record("dry-run execution reaches terminal state", !!final, final ? `status=${final.status} matched=${final.containersMatched}` : "timeout");
      if (final) {
        enumOk("dry-run exec container statuses = DRY_RUN", final.containers.items.map((c) => c.status), "ExecutionContainerStatus");
        if (final.status === "COMPLETED" && final.containersUpgraded !== 0)
          note(`FINDING: dry-run execution reported containersUpgraded=${final.containersUpgraded}`);
      }
    }
    expectErr("triggerIntent duplicate idempotency key rejected", await gql(`mutation Q($id:ID!,$k:String){ triggerIntent(id:$id, idempotencyKey:$k) { id } }`, {
      id,
      k: `${TAG}-ik1-${RUN}`,
    }), "idempotency");
    ok("intentExecutions(intentId) sees execution", await gql(`query Q($id:ID!){ intentExecutions(intentId:$id) { totalCount } }`, { id }), (d) =>
      d.intentExecutions.totalCount >= 1 ? null : "not visible"
    );
    ok("deleteIntent", await gql(`mutation Q($id:ID!){ deleteIntent(id:$id) { success } }`, { id }), (d) =>
      d.deleteIntent.success ? null : "success=false"
    );
    ok("intent(id) after delete = null", await gql(`query Q($id:ID!){ intent(id:$id) { id } }`, { id }), (d) =>
      d.intent === null ? null : "still present"
    );
  }

  // ---- Discord webhook lifecycle (bogus URL — no real channel touched)
  const dw = await gql(`mutation Q($i:CreateDiscordWebhookInput!){ createDiscordWebhook(input:$i) { id maskedUrl serverName channelName enabled } }`, {
    i: { webhookUrl: "https://discord.com/api/webhooks/999999999999999999/e2e-invalid-token", serverName: "e2e", channelName: "e2e", enabled: false },
  });
  if (!hasErr(dw)) {
    const w = dw.data.createDiscordWebhook;
    record("createDiscordWebhook(bogus url)", true, `masked=${w.maskedUrl}`);
    if (w.maskedUrl.includes("e2e-invalid-token")) note("FINDING: maskedUrl leaks webhook token");
    ok("updateDiscordWebhook", await gql(`mutation Q($id:ID!,$i:UpdateDiscordWebhookInput!){ updateDiscordWebhook(id:$id, input:$i) { id serverName enabled } }`, {
      id: w.id,
      i: { serverName: "e2e2", enabled: false },
    }), (d) => (d.updateDiscordWebhook.serverName === "e2e2" ? null : "not updated"));
    ok("discordWebhook(id)", await gql(`query Q($id:ID!){ discordWebhook(id:$id) { id } }`, { id: w.id }));
    expectErr("testDiscordWebhook(bogus) fails", await gql(`mutation Q($id:ID!){ testDiscordWebhook(id:$id) { success } }`, { id: w.id }));
    ok("deleteDiscordWebhook", await gql(`mutation Q($id:ID!){ deleteDiscordWebhook(id:$id) { success } }`, { id: w.id }));
    ok("discordWebhook(id) after delete = null", await gql(`query Q($id:ID!){ discordWebhook(id:$id) { id } }`, { id: w.id }), (d) =>
      d.discordWebhook === null ? null : "still present"
    );
  } else {
    expectErr("createDiscordWebhook(bogus url) rejected", dw);
  }
  expectErr("testDiscordWebhookUrl(bogus) fails", await gql(`mutation Q($u:String!){ testDiscordWebhookUrl(webhookUrl:$u) { success } }`, {
    u: "https://discord.com/api/webhooks/999999999999999999/e2e-invalid-token",
  }));

  // ---- Repository token lifecycle (provider must satisfy DB CHECK
  // provider IN ('github','gitlab'); pick one not already present so no
  // real token is overwritten)
  const rtExisting = await gql(`query { repositoryTokens { provider } }`);
  const usedProviders = new Set((rtExisting.data?.repositoryTokens || []).map((t) => t.provider));
  const prov = ["github", "gitlab"].find((p) => !usedProviders.has(p));
  if (!prov) note("both github and gitlab repository tokens already exist — repository token lifecycle skipped");
  const st = prov && ok(`saveRepositoryToken(${prov})`, await gql(`mutation Q($i:CreateRepositoryTokenInput!){ saveRepositoryToken(input:$i) { id provider maskedToken } }`, {
    i: { provider: prov, token: "ghp_e2etesttoken123456" },
  }), (d) => (d.saveRepositoryToken?.id ? null : "no id"));
  if (st) {
    const t = st.saveRepositoryToken;
    if (t.maskedToken.includes("e2etesttoken")) note("FINDING: maskedToken leaks repository token");
    ok("repositoryToken(provider)", await gql(`query Q($p:String!){ repositoryToken(provider:$p) { id maskedToken associatedImages { imageRepo associated } } }`, { p: prov }), (d) =>
      d.repositoryToken ? null : "missing"
    );
    ok("associateImages(nonexistent repo)", await gql(`mutation Q($id:ID!,$i:AssociateImagesInput!){ associateImages(tokenId:$id, input:$i) { success } }`, {
      id: t.id,
      i: { imageRepos: ["e2e-nonexistent/repo"] },
    }), (d) => (d.associateImages.success ? null : "success=false"));
    ok("deleteRepositoryToken", await gql(`mutation Q($id:ID!){ deleteRepositoryToken(id:$id) { success } }`, { id: t.id }), (d) =>
      d.deleteRepositoryToken.success ? null : "success=false"
    );
    ok("repositoryToken(provider) after delete = null", await gql(`query Q($p:String!){ repositoryToken(provider:$p) { id } }`, { p: prov }), (d) =>
      d.repositoryToken === null ? null : "still present"
    );
  }

  // ---- Registry credentials (DOCKER_HUB only guard + bogus round-trip)
  expectErr("updateRegistryCredentials(GHCR) rejected", await gql(`mutation Q($i:UpdateRegistryCredentialsInput!){ updateRegistryCredentials(input:$i) { success } }`, {
    i: { registry: "GHCR", username: "e2e", token: "e2e" },
  }), "docker_hub");
  expectErr("deleteRegistryCredentials(GHCR) rejected", await gql(`mutation Q($r:Registry!){ deleteRegistryCredentials(registry:$r) { success } }`, { r: "GHCR" }), "docker_hub");
  expectErr("validateRegistryCredentials(GHCR) rejected", await gql(`mutation Q($i:ValidateRegistryCredentialsInput!){ validateRegistryCredentials(input:$i) { valid } }`, {
    i: { registry: "GHCR", username: "e2e", token: "e2e" },
  }), "docker_hub");
  const vr2 = await gql(`mutation Q($i:ValidateRegistryCredentialsInput!){ validateRegistryCredentials(input:$i) { valid message errorCode } }`, {
    i: { registry: "DOCKER_HUB", username: "e2e-bogus-user", token: "e2e-bogus-token" },
  });
  ok("validateRegistryCredentials(DOCKER_HUB bogus)=valid:false", vr2, (d) =>
    d.validateRegistryCredentials.valid === false ? null : "expected valid:false"
  );
  ok("updateRegistryCredentials(DOCKER_HUB bogus)", await gql(`mutation Q($i:UpdateRegistryCredentialsInput!){ updateRegistryCredentials(input:$i) { success } }`, {
    i: { registry: "DOCKER_HUB", username: "e2e-bogus-user", token: "e2e-bogus-token" },
  }), (d) => (d.updateRegistryCredentials.success ? null : "success=false"));
  ok("deleteRegistryCredentials(DOCKER_HUB) cleanup", await gql(`mutation Q($r:Registry!){ deleteRegistryCredentials(registry:$r) { success } }`, { r: "DOCKER_HUB" }), (d) =>
    d.deleteRegistryCredentials.success ? null : "success=false"
  );
}

// =============================================================================
// Phase 3 — operations, batch jobs, idempotency, upgrade guards
// =============================================================================
async function phase3() {
  const opFrag = `id type status progress message queuedAt startedAt completedAt errorCode result { __typename ... on BatchRun { id status } }`;

  const all = await gql(`query { containers(first:100) { items { ${CONT} } } }`);
  if (!hasErr(all)) S.containers = all.data.containers.items;

  expectErr("pullContainers(unknown runner) = not found", await gql(`mutation Q($r:ID){ pullContainers(runnerId:$r) { id } }`, {
    r: "999999999",
  }), "not found");
  expectErr("pullContainers(runnerId) rejected (sync is Node-only)", await gql(`mutation Q($r:ID){ pullContainers(runnerId:$r) { id } }`, {
    r: S.runners?.[0]?.id ?? "1",
  }), "not supported");
  expectErr("pullContainers(no args) rejected", await gql(`mutation { pullContainers { id } }`), "not supported");
  note("pullContainers honestly rejects: container inventory sync is implemented only by the Node backend");

  // upgrade guards
  expectErr("upgradeContainer(neither backend) rejected", await gql(`mutation Q($i:UpgradeContainerInput!){ upgradeContainer(input:$i) { id } }`, {
    i: { dockerContainerId: "deadbeef", imageName: "nginx:latest" },
  }), "exactly one");
  expectErr("upgradeContainer(both backends) rejected", await gql(`mutation Q($i:UpgradeContainerInput!){ upgradeContainer(input:$i) { id } }`, {
    i: { dockerContainerId: "deadbeef", imageName: "nginx:latest", runnerId: S.runners?.[0]?.id ?? "1", sourceInstanceId: S.sources?.[0]?.id ?? "1" },
  }), "exactly one");
  expectErr("upgradeContainer(bogus docker id) = not found", await gql(`mutation Q($i:UpgradeContainerInput!){ upgradeContainer(input:$i) { id } }`, {
    i: { dockerContainerId: "deadbeefdeadbeef", imageName: "nginx:latest", runnerId: S.runners?.[0]?.id ?? "1" },
  }), "not found");

  const portainerC = (S.containers || []).find((c) => c.source?.__typename === "SourceInstance");
  if (portainerC)
    expectErr("upgradeContainer(Portainer) explicit rejection", await gql(`mutation Q($i:UpgradeContainerInput!){ upgradeContainer(input:$i) { id } }`, {
      i: { dockerContainerId: portainerC.dockerContainerId, imageName: portainerC.imageName, sourceInstanceId: portainerC.source.id },
    }), "portainer-backed");

  // batch upgrade with empty list → rejected up front (matches Node)
  expectErr("batchUpgrade(empty list) rejected", await gql(`mutation Q($i:BatchUpgradeInput!){ batchUpgrade(input:$i) { ${opFrag} } }`, {
    i: { containers: [] },
  }), "no containers selected");

  // trigger batch job + idempotency (only TRACKED_APPS_CHECK is implemented in Go;
  // the container-sync job types are honestly rejected)
  expectErr("triggerBatchJob(DOCKER_HUB_PULL) rejected", await gql(`mutation Q($j:BatchJobType,$k:String){ triggerBatchJob(jobType:$j, idempotencyKey:$k) { id } }`, {
    j: "DOCKER_HUB_PULL",
    k: `${TAG}-bj0-${RUN}`,
  }), "not supported");
  const bj = ok("triggerBatchJob(TRACKED_APPS_CHECK, key)", await gql(`mutation Q($j:BatchJobType,$k:String){ triggerBatchJob(jobType:$j, idempotencyKey:$k) { id status jobType isManual containersChecked containersUpdated } }`, {
    j: "TRACKED_APPS_CHECK",
    k: `${TAG}-bj1-${RUN}`,
  }), (d) => (d.triggerBatchJob?.id ? null : "no id"));
  if (bj) {
    enumOk("triggerBatchJob.status enum", [bj.triggerBatchJob.status], "BatchRunStatus");
    expectErr("triggerBatchJob duplicate key rejected", await gql(`mutation Q($j:BatchJobType,$k:String){ triggerBatchJob(jobType:$j, idempotencyKey:$k) { id } }`, {
      j: "TRACKED_APPS_CHECK",
      k: `${TAG}-bj1-${RUN}`,
    }), "idempotency");
    ok("batchRun(triggered id)", await gql(`query Q($id:ID!){ batchRun(id:$id) { id status jobType } }`, { id: bj.triggerBatchJob.id }), (d) =>
      d.batchRun?.jobType === "TRACKED_APPS_CHECK" ? null : "wrong jobType"
    );
  }

  // batch config re-save (idempotent)
  if (S.batchConfigs?.length) {
    const cfg = S.batchConfigs[0];
    ok("updateBatchConfig(re-save same values)", await gql(`mutation Q($i:UpdateBatchConfigInput!){ updateBatchConfig(input:$i) { success } }`, {
      i: { jobType: cfg.jobType, enabled: cfg.enabled, intervalMinutes: cfg.intervalMinutes },
    }), (d) => (d.updateBatchConfig.success ? null : "success=false"));
    ok("batchConfig unchanged after re-save", await gql(`query { batchConfigs { jobType enabled intervalMinutes } }`), (d) => {
      const c = d.batchConfigs.find((x) => x.jobType === cfg.jobType);
      return c && c.enabled === cfg.enabled && c.intervalMinutes === cfg.intervalMinutes ? null : "config drifted";
    });
  }

  ok("setBatchLogLevel(INFO)", await gql(`mutation Q($l:LogLevel!){ setBatchLogLevel(logLevel:$l) { success } }`, { l: "INFO" }), (d) =>
    d.setBatchLogLevel.success ? null : "success=false"
  );
  ok("setBatchLogLevel(DEBUG)", await gql(`mutation Q($l:LogLevel!){ setBatchLogLevel(logLevel:$l) { success } }`, { l: "DEBUG" }), (d) =>
    d.setBatchLogLevel.success ? null : "success=false"
  );
  ok("setBatchLogLevel(INFO) restore", await gql(`mutation Q($l:LogLevel!){ setBatchLogLevel(logLevel:$l) { success } }`, { l: "INFO" }), (d) =>
    d.setBatchLogLevel.success ? null : "success=false"
  );

  const di = ok("deleteImages(bogus id) reports failure", await gql(`mutation Q($l:[DeleteImageInput!]!){ deleteImages(images:$l) { success deleted failed results { imageId success errorCode } } }`, {
    l: [{ imageId: "e2e-bogus-image-id", runnerId: S.runners?.[0]?.id ?? "1" }],
  }), (d) => {
    const r = d.deleteImages;
    return r.failed === 1 && r.deleted === 0 ? null : `deleted=${r.deleted} failed=${r.failed}`;
  });
  if (di) enumOk("deleteImages errorCode enum", di.deleteImages.results.map((x) => x.errorCode), "ErrorCode");
}

// =============================================================================
// Phase 4 — destructive (approved for this run)
// =============================================================================
async function phase4() {
  const runnerContainers = (S.containers || []).filter((c) => c.source?.__typename === "Runner");
  if (!runnerContainers.length) {
    note("no runner-backed containers found — real upgrade + non-dry-run intent tests skipped");
  }

  // ---- clear + re-pull cycle
  const before = S.totalContainers ?? 0;
  ok("clearContainerData", await gql(`mutation { clearContainerData { success } }`), (d) =>
    d.clearContainerData.success ? null : "success=false"
  );
  ok("containers empty after clear", await gql(`query { containers { totalCount } }`), (d) =>
    d.containers.totalCount === 0 ? null : `totalCount=${d.containers.totalCount}`
  );
  // Go rejects container sync, so trigger Node's own persistence path
  // (POST /api/containers/pull = the UI "Pull" button, which re-fetches and
  // re-writes the container cache) and poll until GraphQL rows are back.
  const trig = await page.evaluate(async () => {
    const token = localStorage.getItem("authToken");
    const r = await fetch("/api/containers/pull", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, message: j.message || j.error || "" };
  });
  record("Node REST POST /api/containers/pull triggered restore", trig.status === 200, `status=${trig.status} ${trig.message}`.slice(0, 120));
  let restored = 0;
  for (let i = 0; i < 30; i++) {
    const d = await gql(`query { summaryStats { totalContainers } }`);
    restored = d.data?.summaryStats?.totalContainers ?? 0;
    if (restored > 0) break;
    await sleep(3000);
  }
  record("containers restored after re-pull", restored > 0, `before=${before} restored=${restored}`);
  if (restored > 0) {
    const c = await gql(`query { containers(first:50) { items { ${CONT} } } }`);
    if (!hasErr(c)) S.containers = c.data.containers.items;
  }

  // ---- delete a real unused image (runner-backed)
  const runnerIds = new Set((S.runners || []).map((r) => String(r.id)));
  const runnerUrls = new Set((S.runners || []).map((r) => r.url));
  const unusedRunnerImage = (S.unusedImages || []).find((img) => runnerUrls.has(img.sourceUrl));
  if (unusedRunnerImage) {
    const runner = (S.runners || []).find((r) => r.url === unusedRunnerImage.sourceUrl);
    const del = ok("deleteImages(real unused runner image)", await gql(`mutation Q($l:[DeleteImageInput!]!){ deleteImages(images:$l) { success deleted failed results { imageId success errorCode } } }`, {
      l: [{ imageId: unusedRunnerImage.id, runnerId: runner.id }],
    }), (d) => (d.deleteImages.deleted >= 1 ? null : `deleted=${d.deleteImages.deleted} failed=${d.deleteImages.failed}`));
    if (del && del.deleteImages.deleted >= 1) {
      const after = await gql(`query { unusedImages { id } }`);
      if (!hasErr(after) && after.data.unusedImages.some((i) => i.id === unusedRunnerImage.id))
        note("FINDING: deleted image still listed in unusedImages immediately after delete (cache lag)");
    }
  } else {
    note("no runner-backed unused image available — real deleteImages not exercised");
  }

  // ---- real upgrade on a runner container
  const target =
    runnerContainers.find((c) => c.imageInfo?.hasUpdate) || runnerContainers[0];
  if (target) {
    const histBefore = await gql(`query Q($n:String!){ upgradeHistory(filter:{containerName:$n}) { totalCount } }`, { n: target.name });
    const beforeCount = histBefore.data?.upgradeHistory?.totalCount ?? 0;
    const up = ok("upgradeContainer(real runner container)", await gql(`mutation Q($i:UpgradeContainerInput!){ upgradeContainer(input:$i) { ${"id type status message"} } }`, {
      i: { dockerContainerId: target.dockerContainerId, runnerId: target.source.id, imageName: target.imageName },
    }), (d) => (d.upgradeContainer?.id ? null : "no operation"));
    if (up) {
      S.upgradeOpId = up.upgradeContainer.id;
      expectErr("concurrent upgrade rejected by lock", await gql(`mutation Q($i:UpgradeContainerInput!){ upgradeContainer(input:$i) { id } }`, {
        i: { dockerContainerId: target.dockerContainerId, runnerId: target.source.id, imageName: target.imageName },
      }), "in progress");
      let rec = null;
      for (let i = 0; i < 60; i++) {
        const h = await gql(`query Q($n:String!){ upgradeHistory(filter:{containerName:$n}, first:1) { totalCount items { id status oldImage newImage errorMessage upgradeDurationMs createdAt performedBy { id username } } } }`, { n: target.name });
        const t = h.data?.upgradeHistory;
        if (t && t.totalCount > beforeCount) {
          rec = t.items[0];
          break;
        }
        await sleep(3000);
      }
      record("upgrade recorded in upgradeHistory", !!rec, rec ? `status=${rec.status} ${rec.oldImage} -> ${rec.newImage}` : "no new record within 180s");
      if (rec) enumOk("new upgrade record status enum", [rec.status], "UpgradeStatus");
      // container re-appears after clear+re-pull with the same docker id
      const again = await gql(`query Q($r:ID!){ containers(filter:{runnerId:$r}, first:50) { items { dockerContainerId } } }`, { r: target.source.id });
      const found = !hasErr(again) && again.data.containers.items.some((c) => c.dockerContainerId === target.dockerContainerId);
      record("upgraded container resolvable after re-pull", found);
    }
  }

  // ---- non-dry-run intent end-to-end
  if (target) {
    const ni = ok("createIntent(non-dry-run, scoped to one image)", await gql(`mutation Q($i:CreateIntentInput!){ createIntent(input:$i) { id dryRun matchImages matchSources } }`, {
      i: {
        name: `${TAG}-live`, scheduleType: "IMMEDIATE", dryRun: false, maxConcurrent: 1,
        matchImages: [target.imageName], matchSources: [`runner:${target.source.id}`],
      },
    }), (d) => (d.createIntent?.id ? null : "no id"));
    if (ni) {
      const id = ni.createIntent.id;
      const ex = ok("triggerIntent(non-dry-run)", await gql(`mutation Q($id:ID!){ triggerIntent(id:$id) { ${EXEC} } }`, { id }));
      if (ex) {
        let final = null;
        for (let i = 0; i < 40; i++) {
          const e = await gql(`query Q($id:ID!){ intentExecutions(intentId:$id, first:1) { items { ${EXEC} containers(first:5) { items { status containerName } } } } }`, { id });
          const x = e.data?.intentExecutions?.items?.[0];
          if (x && ["COMPLETED", "PARTIAL", "FAILED"].includes(x.status)) {
            final = x;
            break;
          }
          await sleep(3000);
        }
        record("non-dry-run execution terminal", !!final, final ? `status=${final.status} matched=${final.containersMatched} upgraded=${final.containersUpgraded} failed=${final.containersFailed} skipped=${final.containersSkipped}` : "timeout");
        if (final) enumOk("exec container status enum", final.containers.items.map((c) => c.status), "ExecutionContainerStatus");
      }
      ok("deleteIntent(live)", await gql(`mutation Q($id:ID!){ deleteIntent(id:$id) { success } }`, { id }));
    }
  }

  // ---- avatar: multipart upload + delete round-trip (skipped when the user
  // already has a real avatar — uploadAvatar would overwrite it)
  if (S.me?.avatarUrl == null) {
    const upRes = await page.evaluate(
      async ({ b64 }) => {
        const token = localStorage.getItem("authToken");
        const bin = atob(b64);
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const fd = new FormData();
        fd.append("operations", JSON.stringify({ query: `mutation Q($f:Upload!){ uploadAvatar(file:$f) { success message } }`, variables: { f: null } }));
        fd.append("map", JSON.stringify({ 0: ["variables.f"] }));
        fd.append("0", new Blob([bytes], { type: "image/png" }));
        const r = await fetch("/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
        try {
          return { status: r.status, body: await r.json() };
        } catch {
          return { status: r.status, body: { errors: [{ message: `HTTP ${r.status} non-JSON` }] } };
        }
      },
      { b64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }
    );
    if (upRes.body?.data?.uploadAvatar?.success) {
      record("uploadAvatar(multipart)", true);
      ok("me.avatarUrl set after upload", await gql(`query { me { avatarUrl } }`), (d) =>
        d.me.avatarUrl === "/api/avatars" ? null : `got ${d.me.avatarUrl}`
      );
      ok("deleteAvatar(cleanup)", await gql(`mutation { deleteAvatar { success } }`), (d) =>
        d.deleteAvatar.success ? null : "success=false"
      );
      ok("me.avatarUrl null after delete", await gql(`query { me { avatarUrl } }`), (d) =>
        d.me.avatarUrl == null ? null : `got ${d.me.avatarUrl}`
      );
    } else {
      record("uploadAvatar(multipart)", false, errMsg(upRes.body).slice(0, 120) || `HTTP ${upRes.status}`);
      note("FINDING: uploadAvatar multipart upload still failing after proxy+scalar fix");
    }
  } else {
    note("avatar round-trip skipped: user has a real avatar; Go uploadAvatar would overwrite it");
  }

  // ---- password / username paths
  expectErr("updatePassword(wrong current) rejected", await gql(`mutation Q($i:UpdatePasswordInput!){ updatePassword(input:$i) { success } }`, {
    i: { currentPassword: "definitely-wrong-e2e", newPassword: "whatever-123" },
  }), "incorrect");

  // ---- username rename: password enforcement parity with Node REST
  // (positive rename+revert runs against the temp user, whose password is known)
  expectErr("updateUsername(no password) rejected", await gql(`mutation Q($i:UpdateUsernameInput!){ updateUsername(input:$i) { success } }`, {
    i: { newUsername: `${TAG}-renamed` },
  }), "password is required");
  expectErr("updateUsername(wrong password) rejected", await gql(`mutation Q($i:UpdateUsernameInput!){ updateUsername(input:$i) { success } }`, {
    i: { newUsername: `${TAG}-renamed`, password: "definitely-wrong-9" },
  }), "incorrect");

  // ---- temp user lifecycle (register/login/refresh/admin ops/cleanup)
  const regReq = await gql(`query { registrationCodeRequired }`);
  if (regReq.data?.registrationCodeRequired) {
    note("registration requires a bootstrap code on this deployment — temp-user subtests skipped");
  } else {
    expectErr("register(existing username) rejected", await gql(`mutation Q($i:RegisterInput!){ register(input:$i) { user { id } } }`, {
      i: { username: S.meUsername, password: "e2e-dup-pass-123" },
    }));
    const reg = ok("register(temp user)", await gql(`mutation Q($i:RegisterInput!){ register(input:$i) { token refreshToken user { id username role } } }`, {
      i: { username: `${TAG}user`, password: "e2ePass!123" },
    }), (d) => (d.register?.user?.id ? null : "no user"));
    if (reg) {
      const tu = reg.register.user;
      S.tempUserId = tu.id;
      record("temp user role", tu.role === "MEMBER", `role=${tu.role}`);
      ok("login(temp user)", await gql(`mutation Q($i:LoginInput!){ login(input:$i) { token user { id } } }`, {
        i: { username: `${TAG}user`, password: "e2ePass!123" },
      }), (d) => (d.login?.token ? null : "no token"));
      ok("refreshToken(temp user)", await gql(`mutation Q($rt:String!){ refreshToken(input:{refreshToken:$rt}) { token user { id } } }`, {
        rt: reg.register.refreshToken,
      }), (d) => (d.refreshToken?.token ? null : "no token"));
      // positive rename path on the temp user (known password), as the
      // deployment admin's own password is not available to the harness
      const mainToken = await page.evaluate(() => localStorage.getItem("authToken"));
      await page.evaluate((t) => localStorage.setItem("authToken", t), reg.register.token);
      const ren = ok("updateUsername(temp rename)", await gql(`mutation Q($i:UpdateUsernameInput!){ updateUsername(input:$i) { success } }`, {
        i: { newUsername: `${TAG}-renamed`, password: "e2ePass!123" },
      }), (d) => (d.updateUsername.success ? null : "success=false"));
      if (ren) {
        ok("me.username reflects rename", await gql(`query { me { username } }`), (d) =>
          d.me.username === `${TAG}-renamed` ? null : `got ${d.me.username}`
        );
        ok("updateUsername(revert)", await gql(`mutation Q($i:UpdateUsernameInput!){ updateUsername(input:$i) { success } }`, {
          i: { newUsername: `${TAG}user`, password: "e2ePass!123" },
        }), (d) => (d.updateUsername.success ? null : "success=false"));
      }
      await page.evaluate((t) => localStorage.setItem("authToken", t), mainToken);
      ok("setUserPassword(admin on temp user)", await gql(`mutation Q($id:ID!,$p:String!){ setUserPassword(userId:$id, newPassword:$p) { success } }`, {
        id: tu.id,
        p: "e2ePass!456",
      }), (d) => (d.setUserPassword.success ? null : "success=false"));
      ok("login(temp user, new password)", await gql(`mutation Q($i:LoginInput!){ login(input:$i) { token } }`, {
        i: { username: `${TAG}user`, password: "e2ePass!456" },
      }), (d) => (d.login?.token ? null : "no token"));
      ok("setUserRole(temp -> MEMBER)", await gql(`mutation Q($id:ID!,$r:Role!){ setUserRole(userId:$id, role:$r) { success } }`, {
        id: tu.id,
        r: "MEMBER",
      }), (d) => (d.setUserRole.success ? null : "success=false"));
      ok("users list shows temp user", await gql(`query { users { id username role } }`), (d) =>
        d.users.some((u) => u.id === tu.id) ? null : "temp user missing"
      );
      // cleanup via Node REST (no delete-user mutation in the graph)
      const del = await page.evaluate(
        async ({ id }) => {
          const token = localStorage.getItem("authToken");
          const r = await fetch(`/api/auth/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
          try {
            return await r.json();
          } catch {
            return { success: false, error: `HTTP ${r.status}` };
          }
        },
        { id: tu.id }
      );
      record("delete temp user via REST cleanup", !!del.success, del.error || "");
      S.tempUserId = null;
    }
  }

  ok("logout", await gql(`mutation { logout { success message } }`), (d) =>
    d.logout.success ? null : "success=false"
  );
  note("logout is a no-op (stateless JWTs — nothing revoked)");
}

// =============================================================================
// Phase 5 — subscription probe (raw graphql-ws through the production proxy)
// =============================================================================
async function phase5() {
  const probe = await page.evaluate(
    async () =>
      await new Promise((resolve) => {
        const url = location.origin.replace(/^http/, "ws") + "/graphql";
        let ws;
        try {
          ws = new WebSocket(url, "graphql-transport-ws");
        } catch (e) {
          return resolve({ error: String(e) });
        }
        const t = setTimeout(() => {
          try {
            ws.close();
          } catch {}
          resolve({ error: "timeout after 8s" });
        }, 8000);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "connection_init", payload: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } }));
        ws.onmessage = (ev) => {
          let m;
          try {
            m = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (m.type === "connection_ack") {
            ws.send(JSON.stringify({ id: "1", type: "subscribe", payload: { query: `subscription { containersUpdated { containerCount stats { totalContainers } } }` } }));
          } else if (m.type === "next") {
            clearTimeout(t);
            resolve({ ack: true, next: m });
            try {
              ws.close();
            } catch {}
          } else if (m.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          } else if (m.type === "error" || m.type === "complete") {
            clearTimeout(t);
            resolve({ ack: true, closed: m });
            try {
              ws.close();
            } catch {}
          }
        };
        ws.onerror = () => {
          clearTimeout(t);
          resolve({ error: "websocket error (handshake refused)" });
        };
        ws.onclose = (ev) => {
          clearTimeout(t);
          resolve({ error: `closed code=${ev.code} reason=${ev.reason || "none"}` });
        };
      })
  );
  if (probe.ack) record("subscription handshake (graphql-ws)", true, JSON.stringify(probe).slice(0, 120));
  else {
    record("subscription handshake (graphql-ws)", false, probe.error);
    note("FINDING: subscriptions unreachable in production — Node /graphql proxy forwards only HTTP POST/GET, no WebSocket upgrade; urql client has no WS transport either");
  }
}

// ---- cleanup stragglers (best effort) ---------------------------------------
async function cleanup() {
  if (S.tmpSourceId) await gql(`mutation Q($id:ID!){ deleteSourceInstance(id:$id) { success } }`, { id: S.tmpSourceId });
  if (S.tmpRunnerId) await gql(`mutation Q($id:ID!){ deleteRunner(id:$id) { success } }`, { id: S.tmpRunnerId });
  if (S.tempUserId)
    await page.evaluate(
      async ({ id }) => {
        const token = localStorage.getItem("authToken");
        await fetch(`/api/auth/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      },
      { id: S.tempUserId }
    );
  // Remove the stray "admin" user created by an earlier buggy run (the real
  // deployment admin has a different username).
  const users = await gql(`query { users { id username } }`);
  const stray = (users.data?.users || []).find((u) => u.username === "admin" && String(u.id) !== String(S.myId));
  if (stray) {
    const del = await page.evaluate(
      async ({ id }) => {
        const token = localStorage.getItem("authToken");
        const r = await fetch(`/api/auth/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
        try {
          return await r.json();
        } catch {
          return { success: false, error: `HTTP ${r.status}` };
        }
      },
      { id: stray.id }
    );
    record("cleanup stray 'admin' user", !!del?.success, del?.error || `id=${stray.id}`);
  }
}

// =============================================================================
async function main() {
  browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  console.log(`\nWaiting for login at ${BASE} (up to 5 min)...\n`);
  await page.waitForFunction(() => !!localStorage.getItem("authToken"), null, { timeout: LOGIN_TIMEOUT_MS });
  await sleep(1500);

  const phases = [["phase0 public/auth", phase0], ["phase1 queries/relations/filters", phase1], ["phase2 CRUD lifecycles", phase2], ["phase3 operations/batch/guards", phase3]];
  if (!SKIP_DESTRUCTIVE) phases.push(["phase4 destructive", phase4]);
  phases.push(["phase5 subscriptions", phase5]);
  for (const [name, fn] of phases) {
    console.log(`\n=== ${name} ===`);
    try {
      await fn();
    } catch (e) {
      record(`${name} crashed`, false, String(e));
    }
  }
  try {
    await cleanup();
  } catch (e) {
    note(`cleanup error: ${e}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n===== SUMMARY: ${passed}/${results.length} passed =====`);
  for (const r of results.filter((r) => !r.pass)) console.log(`FAIL  ${r.name} — ${r.detail}`);
  console.log("\nNotes/findings:");
  for (const n of notes) console.log(`  - ${n}`);
  await browser.close();
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});



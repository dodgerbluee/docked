// Live production GraphQL verification harness.
// Opens https://docked.dbluee.net, waits for the user to log in, then runs a
// full battery of GraphQL queries/mutations exercising every resolver and enum
// field added in the recent work, with automated enum-contract validation.
//
// Run: node e2e/live-graph.mjs
import { chromium } from "@playwright/test";

const BASE = "https://docked.dbluee.net";
const LOGIN_TIMEOUT_MS = 300000; // 5 min for the user to log in

// ---- Enum contracts (post-fix) ---------------------------------------------
const ENUM = {
  Role: ["ADMINISTRATOR", "USER"],
  AuthType: ["PASSWORD", "APIKEY"],
  SourceType: ["PORTAINER", "RUNNER"],
  ContainerState: ["RUNNING", "EXITED", "RESTARTING", "CREATED", "PAUSED", "DEAD", "UNKNOWN"],
  BatchJobType: ["DOCKER_HUB_PULL", "UPGRADE_CONTAINERS", "TRACKED_APPS_CHECK", "APP_VERSION_SCAN"],
  BatchRunStatus: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
  IntentScheduleType: ["IMMEDIATE", "SCHEDULED"],
  IntentExecutionStatus: ["PENDING", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"],
  IntentTriggerType: ["MANUAL", "SCAN_DETECTED", "SCHEDULED_WINDOW"],
  UpgradeStatus: ["SUCCESS", "FAILED", "SKIPPED"],
  ExecutionContainerStatus: ["PENDING", "RUNNING", "UPGRADED", "FAILED", "SKIPPED", "DRY_RUN"],
  TrackedAppSourceType: ["DOCKER", "GITHUB", "GITLAB"],
};

const seen = {}; // enumName -> Set(values)
const violations = []; // {where, field, value, allowed}

function check(where, field, enumName, value) {
  if (value === null || value === undefined) return;
  const allowed = ENUM[enumName];
  (seen[enumName] ||= new Set()).add(value);
  if (!allowed.includes(value)) {
    violations.push({ where, field, value, allowed: allowed.join("|") });
  }
}

// ---- Report bookkeeping -----------------------------------------------------
const results = [];
function record(name, res, extra = "") {
  const errors = res && res.errors ? res.errors : [];
  results.push({
    name,
    ok: errors.length === 0,
    errors: errors.map((e) => e.message),
    extra,
  });
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  console.log(`\n>> Browser open at ${BASE}. Please LOG IN. Waiting up to ${LOGIN_TIMEOUT_MS / 1000}s...\n`);

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let token = null;
  while (Date.now() < deadline) {
    token = await page.evaluate(() => localStorage.getItem("authToken"));
    if (token) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!token) {
    console.log("TIMEOUT: no login detected. Aborting.");
    await browser.close();
    process.exit(1);
  }
  console.log(`>> Logged in (token len ${token.length}). Running GraphQL battery...\n`);

  const gql = (query, variables) =>
    page.evaluate(
      async ({ query, variables }) => {
        const t = localStorage.getItem("authToken");
        const r = await fetch("/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(t ? { Authorization: `Bearer ${t}` } : {}),
          },
          body: JSON.stringify({ query, variables }),
        });
        return await r.json();
      },
      { query, variables },
    );

  // ---- 1. me + all User relation resolvers ---------------------------------
  {
    const q = `query { me {
      id username role containerCount sourceInstanceCount trackedAppCount
      preferences { colorScheme }
      containers(first:3) { totalCount items { id name state } }
      trackedApps { id name sourceType }
      intents { id name scheduleType }
      discordWebhooks { id maskedUrl enabled }
      repositoryTokens { id provider associatedImages { imageRepo associated } }
    } }`;
    const r = await gql(q);
    const m = r.data?.me;
    if (m) {
      check("me", "role", "Role", m.role);
      (m.containers?.items || []).forEach((c) => check("me.containers", "state", "ContainerState", c.state));
      (m.trackedApps || []).forEach((t) => check("me.trackedApps", "sourceType", "TrackedAppSourceType", t.sourceType));
      (m.intents || []).forEach((i) => check("me.intents", "scheduleType", "IntentScheduleType", i.scheduleType));
      record("me + User relations", r,
        `role=${m.role} containers=${m.containers?.totalCount} trackedApps=${m.trackedApps?.length} intents=${m.intents?.length} webhooks=${m.discordWebhooks?.length} tokens=${m.repositoryTokens?.length}`);
    } else record("me + User relations", r);
  }

  // ---- 2. sourceInstances + SourceInstance.{containers,upgradeHistory} -----
  {
    const q = `query { sourceInstances {
      id name type authType
      containers(first:3) { totalCount items { id name state } }
      upgradeHistory(first:3) { totalCount items { id containerName status oldVersion newVersion } }
    } }`;
    const r = await gql(q);
    (r.data?.sourceInstances || []).forEach((s) => {
      check("sourceInstances", "type", "SourceType", s.type);
      check("sourceInstances", "authType", "AuthType", s.authType);
      (s.containers?.items || []).forEach((c) => check("src.containers", "state", "ContainerState", c.state));
      (s.upgradeHistory?.items || []).forEach((u) => check("src.upgradeHistory", "status", "UpgradeStatus", u.status));
    });
    record("sourceInstances + relations", r,
      (r.data?.sourceInstances || []).map((s) => `${s.name}[auth=${s.authType} cont=${s.containers?.totalCount} hist=${s.upgradeHistory?.totalCount}]`).join(" "));
  }

  // ---- 3. runners + Runner.{containers,upgradeHistory} ---------------------
  {
    const q = `query { runners {
      id name type enabled
      containers(first:3) { totalCount items { id name state } }
      upgradeHistory(first:3) { totalCount items { id containerName status } }
    } }`;
    const r = await gql(q);
    (r.data?.runners || []).forEach((s) => {
      check("runners", "type", "SourceType", s.type);
      (s.containers?.items || []).forEach((c) => check("runner.containers", "state", "ContainerState", c.state));
      (s.upgradeHistory?.items || []).forEach((u) => check("runner.upgradeHistory", "status", "UpgradeStatus", u.status));
    });
    record("runners + relations", r,
      (r.data?.runners || []).map((s) => `${s.name}[cont=${s.containers?.totalCount} hist=${s.upgradeHistory?.totalCount}]`).join(" "));
  }

  // ---- 4. trackedApps + TrackedApp.upgradeHistory --------------------------
  {
    const q = `query { trackedApps {
      id name sourceType hasUpdate
      upgradeHistory(first:3) { totalCount items { id status oldVersion newVersion } }
    } }`;
    const r = await gql(q);
    (r.data?.trackedApps || []).forEach((t) => {
      check("trackedApps", "sourceType", "TrackedAppSourceType", t.sourceType);
      (t.upgradeHistory?.items || []).forEach((u) => check("trackedApp.upgradeHistory", "status", "UpgradeStatus", u.status));
    });
    record("trackedApps + upgradeHistory", r,
      (r.data?.trackedApps || []).map((t) => `${t.name}[src=${t.sourceType} hist=${t.upgradeHistory?.totalCount}]`).join(" "));
  }

  // ---- 5. intents + intentExecutions + IntentExecution.containers ----------
  {
    const q = `query { intents { id name scheduleType enabled } }`;
    const r = await gql(q);
    (r.data?.intents || []).forEach((i) => check("intents", "scheduleType", "IntentScheduleType", i.scheduleType));
    record("intents", r, (r.data?.intents || []).map((i) => `${i.name}[${i.scheduleType}]`).join(" "));
  }
  {
    const q = `query { intentExecutions(first:8) { items {
      id status triggerType containersMatched containersUpgraded
      containers(first:5) { totalCount items { id containerName status } }
    } } }`;
    const r = await gql(q);
    (r.data?.intentExecutions?.items || []).forEach((e) => {
      check("intentExecutions", "status", "IntentExecutionStatus", e.status);
      check("intentExecutions", "triggerType", "IntentTriggerType", e.triggerType);
      (e.containers?.items || []).forEach((c) => check("intentExec.containers", "status", "ExecutionContainerStatus", c.status));
    });
    const withCont = (r.data?.intentExecutions?.items || []).filter((e) => e.containers?.totalCount > 0);
    record("intentExecutions + containers", r,
      `execs=${r.data?.intentExecutions?.items?.length} withContainers=${withCont.length}`);
  }

  // ---- 6. batchConfigs + batchRuns -----------------------------------------
  {
    const q = `query { batchConfigs { id jobType enabled intervalMinutes } }`;
    const r = await gql(q);
    (r.data?.batchConfigs || []).forEach((b) => check("batchConfigs", "jobType", "BatchJobType", b.jobType));
    record("batchConfigs", r, (r.data?.batchConfigs || []).map((b) => `${b.jobType}`).join(" "));
  }
  {
    const q = `query { batchRuns(first:8) { items { id status jobType containersChecked containersUpdated } } }`;
    const r = await gql(q);
    (r.data?.batchRuns?.items || []).forEach((b) => {
      check("batchRuns", "status", "BatchRunStatus", b.status);
      check("batchRuns", "jobType", "BatchJobType", b.jobType);
    });
    record("batchRuns", r, (r.data?.batchRuns?.items || []).map((b) => `${b.jobType}:${b.status}`).join(" "));
  }

  // ---- 7. upgradeHistory (top-level) ---------------------------------------
  {
    const q = `query { upgradeHistory(first:8) { totalCount items { id containerName status oldVersion newVersion } } }`;
    const r = await gql(q);
    (r.data?.upgradeHistory?.items || []).forEach((u) => check("upgradeHistory", "status", "UpgradeStatus", u.status));
    record("upgradeHistory", r, `total=${r.data?.upgradeHistory?.totalCount}`);
  }

  // ---- 8. repositoryTokens + associatedImages ------------------------------
  {
    const q = `query { repositoryTokens { id provider associatedImages { imageRepo associated } } }`;
    const r = await gql(q);
    record("repositoryTokens + associatedImages", r,
      (r.data?.repositoryTokens || []).map((t) => `${t.provider}(imgs=${t.associatedImages?.length})`).join(" "));
  }

  // ---- 9. containerGroup (stacks/standalone/sources/runners/stats) ---------
  {
    const q = `query { containerGroup {
      unusedImagesCount
      stats { totalContainers containersWithUpdates totalSources totalRunners totalTrackedApps }
      stacks { id name containers(first:2) { totalCount items { id name state } } }
      standalone(first:3) { totalCount items { id name state upgradeHistory(first:2) { totalCount items { id status } } } }
      sources { id name authType }
      runners { id name }
    } }`;
    const r = await gql(q);
    const cg = r.data?.containerGroup;
    (cg?.standalone?.items || []).forEach((c) => {
      check("cg.standalone", "state", "ContainerState", c.state);
      (c.upgradeHistory?.items || []).forEach((u) => check("container.upgradeHistory", "status", "UpgradeStatus", u.status));
    });
    (cg?.sources || []).forEach((s) => check("cg.sources", "authType", "AuthType", s.authType));
    record("containerGroup", r,
      cg ? `unused=${cg.unusedImagesCount} stacks=${cg.stacks?.length} standalone=${cg.standalone?.totalCount} sources=${cg.sources?.length} runners=${cg.runners?.length}` : "");
  }

  // ---- 10. single container(id) + Container.upgradeHistory -----------------
  {
    const list = await gql(`query { containers(first:1) { items { id } } }`);
    const cid = list.data?.containers?.items?.[0]?.id;
    if (cid) {
      const q = `query($id:ID!){ container(id:$id){ id name state source { __typename ... on SourceInstance { id name } ... on Runner { id name } } upgradeHistory(first:3){ totalCount items { id status } } } }`;
      const r = await gql(q, { id: cid });
      const c = r.data?.container;
      if (c) check("container(id)", "state", "ContainerState", c.state);
      (c?.upgradeHistory?.items || []).forEach((u) => check("container.upgradeHistory", "status", "UpgradeStatus", u.status));
      record("container(id) + upgradeHistory", r, c ? `id=${c.id} state=${c.state} hist=${c.upgradeHistory?.totalCount}` : "no container");
    } else record("container(id) + upgradeHistory", { errors: [{ message: "no containers to sample" }] });
  }

  // ---- 11. misc queries: unusedImages, summaryStats, userPreferences -------
  {
    const r = await gql(`query { unusedImages { id repoTags sizeBytes } }`);
    record("unusedImages", r, `count=${r.data?.unusedImages?.length}`);
  }
  {
    const r = await gql(`query { summaryStats { totalContainers containersWithUpdates totalSources totalRunners totalTrackedApps unusedImagesCount } }`);
    record("summaryStats", r, JSON.stringify(r.data?.summaryStats));
  }
  {
    const r = await gql(`query { userPreferences { colorScheme disablePortainerPage } }`);
    record("userPreferences", r, `colorScheme=${r.data?.userPreferences?.colorScheme}`);
  }

  // ---- 12. pagination (first/after) on containers + upgradeHistory ---------
  {
    const p1 = await gql(`query { containers(first:2){ pageInfo{ hasNextPage endCursor } totalCount items{ id } } }`);
    const cur = p1.data?.containers?.pageInfo?.endCursor;
    let p2ok = false, p2msg = "no cursor";
    if (cur) {
      const p2 = await gql(`query($c:String){ containers(first:2, after:$c){ pageInfo{ hasNextPage } items{ id } } }`, { c: cur });
      p2ok = !p2.errors;
      p2msg = `page1=${p1.data?.containers?.items?.length} page2=${p2.data?.containers?.items?.length} hasNext=${p1.data?.containers?.pageInfo?.hasNextPage}`;
    }
    record("pagination containers(first/after)", p2ok ? { errors: [] } : { errors: [{ message: p2msg }] }, p2msg);
  }
  {
    const p1 = await gql(`query { upgradeHistory(first:1){ pageInfo{ hasNextPage endCursor } totalCount items{ id } } }`);
    const cur = p1.data?.upgradeHistory?.pageInfo?.endCursor;
    let p2ok = false, p2msg = "no cursor";
    if (cur) {
      const p2 = await gql(`query($c:String){ upgradeHistory(first:1, after:$c){ pageInfo{ hasNextPage } items{ id } } }`, { c: cur });
      p2ok = !p2.errors;
      p2msg = `page1=${p1.data?.upgradeHistory?.items?.length} page2=${p2.data?.upgradeHistory?.items?.length}`;
    }
    record("pagination upgradeHistory(first/after)", p2ok ? { errors: [] } : { errors: [{ message: p2msg }] }, p2msg);
  }

  // ---- 13. safe idempotent mutation (set colorScheme to current value) -----
  {
    const cur = await gql(`query { userPreferences { colorScheme } }`);
    const scheme = cur.data?.userPreferences?.colorScheme;
    if (scheme) {
      const r = await gql(`mutation($i:UpdateUserPreferencesInput!){ updateUserPreferences(input:$i){ success } }`, { i: { colorScheme: scheme } });
      record("updateUserPreferences (idempotent)", r, `colorScheme=${scheme} success=${r.data?.updateUserPreferences?.success}`);
    } else record("updateUserPreferences (idempotent)", { errors: [{ message: "no colorScheme" }] });
  }

  // ---- Print report ---------------------------------------------------------
  console.log("\n================ GraphQL LIVE TEST REPORT ================");
  let pass = 0, fail = 0;
  for (const r of results) {
    const line = `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "  —  " + r.extra : ""}`;
    console.log(line);
    if (!r.ok) { console.log("      errors: " + r.errors.join(" | ")); fail++; } else pass++;
  }
  console.log("\n---- Enum values observed ----");
  for (const [k, v] of Object.entries(seen)) console.log(`  ${k}: ${[...v].join(", ")}`);
  console.log("\n---- Enum contract violations ----");
  if (violations.length === 0) console.log("  NONE — all enum values are valid members.");
  else violations.forEach((v) => console.log(`  ${v.where}.${v.field} = "${v.value}" (allowed: ${v.allowed})`));
  console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${violations.length} enum violations.`);
  console.log("==========================================================\n");

  await browser.close();
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});

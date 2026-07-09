/**
 * Acceptance tests for the plan-then-execute upgrade pipeline (PLAN-2 §0.1).
 * The backend is fully mocked through the `ops` adapter — no network.
 */

jest.mock("../utils/logger", () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));

const {
  matchesNetworkMode,
  computeHealthDeadlineMs,
  buildUpgradePlan,
  executeUpgradePlan,
} = require("../services/containerUpgrade/upgradePlanner");

const FAST_TIMING = {
  pollIntervalMs: 1,
  stopPollIntervalMs: 1,
  stopMaxWaitMs: 50,
  runningGraceDeadlineMs: 50,
  verifyDeadlineMs: 30,
};

const TARGET_ID = "a".repeat(64);

function runningState() {
  return { Status: "running", Running: true };
}
function exitedState() {
  return { Status: "exited", Running: false };
}

/**
 * Build an in-memory fake backend that records a timeline of operations.
 * `behavior` may inject { pull, create, inspect } hooks to force failures /
 * custom readiness responses.
 */
function makeOps({ containers = {}, behavior = {} } = {}) {
  const store = new Map(Object.entries(containers).map(([id, c]) => [id, { ...c, Id: id }]));
  const timeline = [];
  let seq = 0;

  const ops = {
    listContainers: jest.fn(async () =>
      [...store.values()].map((c) => ({ Id: c.Id, Names: [c.Name || `/${c.Id}`] }))
    ),
    inspect: jest.fn(async (id) => {
      if (behavior.inspect) {
        const custom = await behavior.inspect(id, store);
        if (custom !== undefined) {
          return custom;
        }
      }
      const found = store.get(id);
      if (!found) {
        const err = new Error("no such container");
        err.response = { status: 404 };
        throw err;
      }
      return found;
    }),
    stop: jest.fn(async (id) => {
      timeline.push({ op: "stop", id });
      const c = store.get(id);
      if (c) {
        c.State = exitedState();
      }
    }),
    start: jest.fn(async (id) => {
      timeline.push({ op: "start", id });
      const c = store.get(id);
      if (c) {
        c.State = runningState();
      }
    }),
    remove: jest.fn(async (id) => {
      timeline.push({ op: "remove", id });
      store.delete(id);
    }),
    create: jest.fn(async (config, name) => {
      const networkMode = config.HostConfig && config.HostConfig.NetworkMode;
      timeline.push({ op: "create", name, image: config.Image, networkMode });
      if (behavior.create) {
        await behavior.create(config, name);
      }
      const id = `new-${++seq}`;
      store.set(id, {
        Id: id,
        Name: `/${name}`,
        Config: { Image: config.Image },
        HostConfig: { NetworkMode: networkMode || "bridge" },
        State: { Status: "running", Running: true, Health: { Status: "healthy" } },
      });
      return { Id: id };
    }),
    pull: jest.fn(async (image) => {
      timeline.push({ op: "pull", image });
      if (behavior.pull) {
        await behavior.pull(image);
      }
    }),
  };

  return { ops, store, timeline };
}

function target(overrides = {}) {
  return {
    Id: TARGET_ID,
    Name: "/tunnel",
    Config: { Image: "gluetun:old", ...(overrides.Config || {}) },
    HostConfig: { NetworkMode: "bridge", ...(overrides.HostConfig || {}) },
    State: runningState(),
    NetworkSettings: { Networks: {} },
  };
}

function dependent(id, networkMode, { running = true } = {}) {
  return {
    Id: id,
    Name: `/${id}`,
    Config: { Image: `${id}:old`, Env: [`NAME=${id}`] },
    HostConfig: { NetworkMode: networkMode, Binds: [`/data/${id}:/data`] },
    State: running ? runningState() : exitedState(),
    NetworkSettings: { Networks: {} },
  };
}

async function planFor(ops, t) {
  return buildUpgradePlan({
    ops,
    upgradeId: "test",
    targetInspect: t,
    targetId: t.Id,
    targetName: t.Name,
  });
}

describe("matchesNetworkMode (unified matcher)", () => {
  const opts = { name: "tunnel", oldFullId: TARGET_ID };
  it("matches service:<name>", () => {
    expect(matchesNetworkMode("service:tunnel", opts)).toBe(true);
  });
  it("matches container:<name>", () => {
    expect(matchesNetworkMode("container:tunnel", opts)).toBe(true);
  });
  it("matches container:<old-full-id>", () => {
    expect(matchesNetworkMode(`container:${TARGET_ID}`, opts)).toBe(true);
  });
  it("matches container:<old-short-id>", () => {
    expect(matchesNetworkMode(`container:${TARGET_ID.substring(0, 12)}`, opts)).toBe(true);
  });
  it("rejects unrelated modes and other names/ids", () => {
    expect(matchesNetworkMode("bridge", opts)).toBe(false);
    expect(matchesNetworkMode("container:someoneelse", opts)).toBe(false);
    expect(matchesNetworkMode("", opts)).toBe(false);
  });
});

describe("computeHealthDeadlineMs", () => {
  it("returns null with no healthcheck", () => {
    expect(computeHealthDeadlineMs(target())).toBeNull();
    expect(computeHealthDeadlineMs({ Config: { Healthcheck: { Test: ["NONE"] } } })).toBeNull();
  });
  it("derives deadline from start_period + interval*retries and caps at 10 min", () => {
    // gluetun-style: start_period 180s, interval 30s, retries 3 => 270s
    const inspect = {
      Config: {
        Healthcheck: {
          Test: ["CMD", "x"],
          StartPeriod: 180 * 1e9,
          Interval: 30 * 1e9,
          Retries: 3,
        },
      },
    };
    expect(computeHealthDeadlineMs(inspect)).toBe(270000);
    // Huge values are capped at 10 minutes.
    const huge = {
      Config: { Healthcheck: { Test: ["CMD", "x"], StartPeriod: 3600 * 1e9, Retries: 3 } },
    };
    expect(computeHealthDeadlineMs(huge)).toBe(10 * 60 * 1000);
  });
});

describe("Case 1: dependents by service:name and container:<old-id> both recreated", () => {
  it("discovers and recreates both against the new target id", async () => {
    const t = target();
    const dep1 = dependent("radarr", "service:tunnel");
    const dep2 = dependent("sonarr", `container:${TARGET_ID}`);
    const { ops, timeline } = makeOps({
      containers: { [TARGET_ID]: t, radarr: dep1, sonarr: dep2 },
    });

    const plan = await planFor(ops, t);
    expect(plan.dependents.map((d) => d.name).sort()).toEqual(["radarr", "sonarr"]);

    const { newContainer } = await executeUpgradePlan({
      ops,
      plan,
      newImage: "gluetun:new",
      upgradeId: "test",
      timing: FAST_TIMING,
    });

    // Target recreated with the new image.
    const targetCreate = timeline.find((e) => e.op === "create" && e.name === "tunnel");
    expect(targetCreate.image).toBe("gluetun:new");
    expect(newContainer.Id).toBe(targetCreate ? "new-1" : null);

    // Both dependents removed and recreated pointing at the new target id.
    for (const name of ["radarr", "sonarr"]) {
      expect(timeline.some((e) => e.op === "remove" && e.id === name)).toBe(true);
      const depCreate = timeline.find((e) => e.op === "create" && e.name === name);
      expect(depCreate).toBeDefined();
      expect(depCreate.networkMode).toBe(`container:${newContainer.Id}`);
    }
  });
});

describe("Case 2: dependent config survives recreation", () => {
  it("keeps Env and Binds; only NetworkMode/image change", async () => {
    const t = target();
    const dep = dependent("prowlarr", "service:tunnel");
    dep.Config.User = "1000:1000";
    dep.Config.Healthcheck = { Test: ["CMD", "true"], Interval: 30 * 1e9, Retries: 3 };
    const { ops } = makeOps({ containers: { [TARGET_ID]: t, prowlarr: dep } });

    const plan = await planFor(ops, t);
    await executeUpgradePlan({
      ops,
      plan,
      newImage: "gluetun:new",
      upgradeId: "test",
      timing: FAST_TIMING,
    });

    const depCreateCall = ops.create.mock.calls.find((c) => c[1] === "prowlarr");
    const cfg = depCreateCall[0];
    expect(cfg.Env).toEqual(["NAME=prowlarr"]);
    expect(cfg.User).toBe("1000:1000");
    expect(cfg.Healthcheck).toEqual({ Test: ["CMD", "true"], Interval: 30 * 1e9, Retries: 3 });
    expect(cfg.HostConfig.Binds).toEqual(["/data/prowlarr:/data"]);
    expect(cfg.HostConfig.NetworkMode).toMatch(/^container:new-/);
    expect(cfg.Image).toBe("prowlarr:old");
  });
});

describe("Case 3: pull failure rolls back with nothing removed", () => {
  it("leaves target and dependents running, removes nothing", async () => {
    const t = target();
    const dep = dependent("radarr", "service:tunnel");
    const { ops, timeline } = makeOps({
      containers: { [TARGET_ID]: t, radarr: dep },
      behavior: {
        pull: () => {
          throw new Error("pull failed: registry unreachable");
        },
      },
    });

    const plan = await planFor(ops, t);
    await expect(
      executeUpgradePlan({
        ops,
        plan,
        newImage: "gluetun:new",
        upgradeId: "test",
        timing: FAST_TIMING,
      })
    ).rejects.toThrow(/pull failed/);

    // Nothing was removed.
    expect(timeline.some((e) => e.op === "remove")).toBe(false);
    // Target and the dependent were restarted by rollback.
    expect(ops.start).toHaveBeenCalledWith(TARGET_ID);
    expect(ops.start).toHaveBeenCalledWith("radarr");
  });
});

describe("Case 4: create-target failure after removal restores old image + dependents", () => {
  it("recreates the target with the old image and restores dependents", async () => {
    const t = target();
    const dep = dependent("radarr", "service:tunnel");
    const { ops, timeline } = makeOps({
      containers: { [TARGET_ID]: t, radarr: dep },
      behavior: {
        create: (config) => {
          // Only the NEW target image create fails.
          if (config.Image === "gluetun:new") {
            throw new Error("create failed: invalid config");
          }
        },
      },
    });

    const plan = await planFor(ops, t);
    await expect(
      executeUpgradePlan({
        ops,
        plan,
        newImage: "gluetun:new",
        upgradeId: "test",
        timing: FAST_TIMING,
      })
    ).rejects.toThrow(/create failed/);

    // Target was removed then recreated from the captured inspect with the OLD image.
    expect(timeline.some((e) => e.op === "remove" && e.id === TARGET_ID)).toBe(true);
    const oldImageRecreate = timeline.find(
      (e) => e.op === "create" && e.name === "tunnel" && e.image === "gluetun:old"
    );
    expect(oldImageRecreate).toBeDefined();
    // Dependent restored (recreated + started).
    const depRestore = timeline.find((e) => e.op === "create" && e.name === "radarr");
    expect(depRestore).toBeDefined();
    expect(ops.start).toHaveBeenCalled();
  });
});

describe("Case 5: upgrading a consumer touches no sibling consumers", () => {
  it("never stops/starts/removes/creates siblings that share the provider", async () => {
    const PROVIDER_ID = "p".repeat(64);
    // qbittorrent is itself a consumer of a VPN provider.
    const qbit = target({ HostConfig: { NetworkMode: `container:${PROVIDER_ID}` } });
    qbit.Id = "q".repeat(64);
    qbit.Name = "/qbittorrent";
    qbit.Config.Image = "qbittorrent:old";
    // nzbget is a *sibling* consumer of the same provider — must be left alone.
    const nzbget = dependent("nzbget", `container:${PROVIDER_ID}`);
    const provider = target();
    provider.Id = PROVIDER_ID;
    provider.Name = "/gluetun";

    const { ops, timeline } = makeOps({
      containers: { [qbit.Id]: qbit, nzbget, [PROVIDER_ID]: provider },
    });

    const plan = await buildUpgradePlan({
      ops,
      upgradeId: "test",
      targetInspect: qbit,
      targetId: qbit.Id,
      targetName: qbit.Name,
    });
    expect(plan.dependents).toHaveLength(0);

    await executeUpgradePlan({
      ops,
      plan,
      newImage: "qbittorrent:new",
      upgradeId: "test",
      timing: FAST_TIMING,
    });

    const touchedNzbget = timeline.some((e) => e.id === "nzbget" || e.name === "nzbget");
    const touchedProvider = timeline.some((e) => e.id === PROVIDER_ID || e.name === "gluetun");
    expect(touchedNzbget).toBe(false);
    expect(touchedProvider).toBe(false);
  });
});

describe("Case 6: dependents not recreated before target is healthy", () => {
  it("waits for health=healthy before recreating dependents", async () => {
    const t = target({
      Config: {
        Image: "gluetun:old",
        Healthcheck: { Test: ["CMD", "healthcheck"], StartPeriod: 0, Interval: 1e9, Retries: 3 },
      },
    });
    const dep = dependent("radarr", "service:tunnel");

    let healthPolls = 0;
    let becameHealthyAt = null;
    const timelineRef = { current: null };

    const fake = makeOps({
      containers: { [TARGET_ID]: t, radarr: dep },
      behavior: {
        inspect: (id, store) => {
          const c = store.get(id);
          // The upgraded target is "new-1"; report starting twice, then healthy.
          if (id === "new-1") {
            healthPolls += 1;
            const healthy = healthPolls >= 3;
            if (healthy && becameHealthyAt === null) {
              becameHealthyAt = timelineRef.current.length;
            }
            return {
              Id: id,
              State: {
                Status: "running",
                Running: true,
                Health: { Status: healthy ? "healthy" : "starting" },
              },
            };
          }
          return c;
        },
      },
    });
    timelineRef.current = fake.timeline;

    const plan = await planFor(fake.ops, t);
    await executeUpgradePlan({
      ops: fake.ops,
      plan,
      newImage: "gluetun:new",
      upgradeId: "test",
      timing: FAST_TIMING,
    });

    // Health check actually polled (waited for "starting" -> "healthy").
    expect(healthPolls).toBeGreaterThanOrEqual(3);
    expect(becameHealthyAt).not.toBeNull();

    // The dependent's recreation (its create) happened only after health=healthy.
    const depCreateIndex = fake.timeline.findIndex((e) => e.op === "create" && e.name === "radarr");
    expect(depCreateIndex).toBeGreaterThanOrEqual(becameHealthyAt);
  });
});

describe("Stopped dependents are recreated but left stopped", () => {
  it("recreates a pre-stopped dependent without starting it", async () => {
    const t = target();
    const dep = dependent("radarr", "service:tunnel", { running: false });
    const { ops, timeline } = makeOps({ containers: { [TARGET_ID]: t, radarr: dep } });

    const plan = await planFor(ops, t);
    expect(plan.dependents[0].wasRunning).toBe(false);

    await executeUpgradePlan({
      ops,
      plan,
      newImage: "gluetun:new",
      upgradeId: "test",
      timing: FAST_TIMING,
    });

    // Dependent recreated (a new-* container created for radarr) ...
    const depCreate = timeline.find((e) => e.op === "create" && e.name === "radarr");
    expect(depCreate).toBeDefined();
    // ... but never started (only the target new-1 is started).
    const startedIds = ops.start.mock.calls.map((c) => c[0]);
    expect(startedIds).toContain("new-1");
    expect(startedIds).not.toContain("new-2");
  });
});

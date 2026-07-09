/**
 * Unit tests for the shared container config builder (PLAN-2 §0.1(c)).
 * No network / backend — pure function tests.
 */

jest.mock("../utils/logger", () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));

const {
  buildCreateConfig,
  buildNetworkingConfig,
  isSharedNetworkMode,
} = require("../services/containerUpgrade/containerConfigBuilder");

const OLD_ID = "a".repeat(64);
const OLD_SHORT = OLD_ID.substring(0, 12);

function makeDependentInspect() {
  return {
    Id: OLD_ID,
    Name: "/tautulli",
    Config: {
      Image: "tautulli:old",
      Env: ["TZ=UTC", "PUID=1000"],
      User: "1000:1000",
      Hostname: OLD_SHORT,
      Healthcheck: {
        Test: ["CMD", "curl", "-f", "http://localhost:8181"],
        Interval: 30 * 1e9,
        Timeout: 10 * 1e9,
        StartPeriod: 5 * 1e9,
        Retries: 3,
      },
      ExposedPorts: { "8181/tcp": {} },
      Labels: { "com.docker.compose.project": "media" },
      StopSignal: "SIGTERM",
      WorkingDir: "/app",
    },
    HostConfig: {
      NetworkMode: `container:${OLD_ID}`,
      Binds: ["/host/config:/config"],
      PortBindings: { "8181/tcp": [{ HostPort: "8181" }] },
      PublishAllPorts: false,
      Sysctls: { "net.ipv4.conf.all.src_valid_mark": "1" },
      Dns: ["1.1.1.1"],
      CapAdd: ["NET_ADMIN"],
      Devices: [{ PathOnHost: "/dev/net/tun" }],
      RestartPolicy: { Name: "unless-stopped" },
      ContainerIDFile: "/var/lib/docker/containers/x/id",
      ResolvConfPath: "/var/lib/docker/containers/x/resolv.conf",
      HostnamePath: "/var/lib/docker/containers/x/hostname",
      HostsPath: "/var/lib/docker/containers/x/hosts",
      RestartCount: 2,
    },
    NetworkSettings: { Networks: {} },
  };
}

describe("isSharedNetworkMode", () => {
  it("detects service: and container: modes", () => {
    expect(isSharedNetworkMode("service:tunnel")).toBe(true);
    expect(isSharedNetworkMode("container:abc")).toBe(true);
    expect(isSharedNetworkMode("bridge")).toBe(false);
    expect(isSharedNetworkMode("")).toBe(false);
    expect(isSharedNetworkMode(undefined)).toBe(false);
  });
});

describe("buildCreateConfig — shared-network dependent", () => {
  const inspect = makeDependentInspect();
  const { containerConfig, isSharedNetworkMode: shared } = buildCreateConfig({
    inspect,
    newImage: "tautulli:old",
    networkMode: "container:newtargetid",
  });

  it("marks it as shared network mode and points at the new target", () => {
    expect(shared).toBe(true);
    expect(containerConfig.HostConfig.NetworkMode).toBe("container:newtargetid");
  });

  it("preserves Healthcheck, User, Env, Binds, Sysctls, Dns, CapAdd, Devices, StopSignal", () => {
    expect(containerConfig.Healthcheck).toEqual(inspect.Config.Healthcheck);
    expect(containerConfig.User).toBe("1000:1000");
    expect(containerConfig.Env).toEqual(["TZ=UTC", "PUID=1000"]);
    expect(containerConfig.StopSignal).toBe("SIGTERM");
    expect(containerConfig.HostConfig.Binds).toEqual(["/host/config:/config"]);
    expect(containerConfig.HostConfig.Sysctls).toEqual({
      "net.ipv4.conf.all.src_valid_mark": "1",
    });
    expect(containerConfig.HostConfig.Dns).toEqual(["1.1.1.1"]);
    expect(containerConfig.HostConfig.CapAdd).toEqual(["NET_ADMIN"]);
    expect(containerConfig.HostConfig.Devices).toEqual([{ PathOnHost: "/dev/net/tun" }]);
  });

  it("strips port/hostname fields forbidden on shared-network consumers", () => {
    expect(containerConfig.ExposedPorts).toBeUndefined();
    expect(containerConfig.Hostname).toBeUndefined();
    expect(containerConfig.HostConfig.PortBindings).toBeUndefined();
    expect(containerConfig.HostConfig.PublishAllPorts).toBeUndefined();
  });

  it("strips runtime-only HostConfig keys", () => {
    expect(containerConfig.HostConfig.ContainerIDFile).toBeUndefined();
    expect(containerConfig.HostConfig.ResolvConfPath).toBeUndefined();
    expect(containerConfig.HostConfig.HostnamePath).toBeUndefined();
    expect(containerConfig.HostConfig.HostsPath).toBeUndefined();
    expect(containerConfig.HostConfig.RestartCount).toBeUndefined();
  });

  it("does not mutate the source inspect", () => {
    expect(inspect.HostConfig.PortBindings).toBeDefined();
    expect(inspect.Config.Hostname).toBe(OLD_SHORT);
  });
});

describe("buildCreateConfig — target (non-shared) keeps ports & networks", () => {
  const inspect = {
    Id: OLD_ID,
    Name: "/web",
    Config: {
      Image: "web:old",
      Hostname: "custom-host",
      ExposedPorts: { "80/tcp": {} },
      Runtime: "nvidia",
    },
    HostConfig: {
      NetworkMode: "bridge",
      PortBindings: { "80/tcp": [{ HostPort: "8080" }] },
      Runtime: "nvidia",
      MacAddress: "02:42:ac:11:00:02",
    },
    NetworkSettings: {
      Networks: {
        appnet: { Aliases: ["web"], IPAMConfig: { IPv4Address: "172.20.0.5" } },
      },
    },
  };
  const { containerConfig, isSharedNetworkMode: shared } = buildCreateConfig({
    inspect,
    newImage: "web:new",
  });

  it("keeps original NetworkMode and sets new image", () => {
    expect(shared).toBe(false);
    expect(containerConfig.HostConfig.NetworkMode).toBe("bridge");
    expect(containerConfig.Image).toBe("web:new");
  });

  it("keeps ExposedPorts and PortBindings", () => {
    expect(containerConfig.ExposedPorts).toEqual({ "80/tcp": {} });
    expect(containerConfig.HostConfig.PortBindings).toEqual({ "80/tcp": [{ HostPort: "8080" }] });
  });

  it("preserves a custom Runtime (e.g. nvidia)", () => {
    expect(containerConfig.HostConfig.Runtime).toBe("nvidia");
  });

  it("preserves a user-defined Hostname (not equal to short id)", () => {
    expect(containerConfig.Hostname).toBe("custom-host");
  });

  it("drops an auto-generated (02:42:*) MAC address", () => {
    expect(containerConfig.HostConfig.MacAddress).toBeUndefined();
  });

  it("builds NetworkingConfig from NetworkSettings", () => {
    expect(containerConfig.NetworkingConfig).toEqual({
      EndpointsConfig: {
        appnet: { Aliases: ["web"], IPAMConfig: { IPv4Address: "172.20.0.5" } },
      },
    });
  });
});

describe("buildCreateConfig — hostname & mac edge cases", () => {
  it("drops Hostname when it equals the old short id", () => {
    const inspect = {
      Id: OLD_ID,
      Config: { Image: "x", Hostname: OLD_SHORT },
      HostConfig: { NetworkMode: "bridge" },
    };
    const { containerConfig } = buildCreateConfig({ inspect, newImage: "x2" });
    expect(containerConfig.Hostname).toBeUndefined();
  });

  it("keeps a user-defined MAC address", () => {
    const inspect = {
      Id: OLD_ID,
      Config: { Image: "x", MacAddress: "aa:bb:cc:dd:ee:ff" },
      HostConfig: { NetworkMode: "bridge" },
    };
    const { containerConfig } = buildCreateConfig({ inspect, newImage: "x2" });
    expect(containerConfig.MacAddress).toBe("aa:bb:cc:dd:ee:ff");
  });
});

describe("buildNetworkingConfig", () => {
  it("returns undefined when there are no networks", () => {
    expect(buildNetworkingConfig({ NetworkSettings: { Networks: {} } })).toBeUndefined();
    expect(buildNetworkingConfig({})).toBeUndefined();
  });
});

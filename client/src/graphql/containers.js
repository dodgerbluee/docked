import { graphqlClient } from "./client";
import { CONTAINERS_QUERY } from "./queries";

const REGISTRY_TO_PROVIDER = {
  DOCKER_HUB: "dockerhub",
  GHCR: "ghcr",
  GITLAB: "gitlab",
  GCR: "gcr",
  QUAY: "quay",
  OTHER: "other",
};

// Tag from "repo/image:tag"; a colon only counts when it appears after the
// last "/" (registry host ports like "host:5000/img" are not tags).
function tagFromImageName(imageName) {
  if (!imageName) return null;
  const colon = imageName.lastIndexOf(":");
  const slash = imageName.lastIndexOf("/");
  if (colon !== -1 && colon > slash) {
    return imageName.slice(colon + 1);
  }
  return "latest";
}

/**
 * Map a GraphQL Container (containerGroup query) onto the legacy REST
 * container shape the UI consumes (see server formatContainerFromDatabase).
 * hasUpdate comes from the server (single source of truth); computeHasUpdate
 * on the client trusts a boolean hasUpdate and never recomputes.
 */
export function mapGqlContainer(c) {
  const info = c.imageInfo || null;
  const src = c.source || {};
  const currentTag = info?.currentTag ?? tagFromImageName(c.imageName);
  const latestTag = info?.latestTag ?? currentTag;

  const container = {
    id: c.dockerContainerId,
    name: c.name,
    image: c.imageName,
    imageRepo: c.imageRepo,
    status: c.status ?? null,
    state: c.state ? c.state.toLowerCase() : null,
    stackName: c.stackName ?? null,
    endpointId: c.endpointId != null && c.endpointId !== "" ? Number(c.endpointId) : null,
    currentDigest: c.currentDigest ?? info?.currentDigest ?? null,
    usesNetworkMode: !!c.usesNetworkMode,
    providesNetwork: !!c.providesNetwork,
    lastSeen: c.lastSeen ?? null,
    createdAt: c.createdAt ?? null,
    currentTag,
    currentVersion: info?.currentVersion ?? currentTag,
    latestTag,
    newVersion: info?.latestVersion ?? latestTag,
    latestDigest: info?.latestDigest ?? null,
    latestDigestFull: info?.latestDigest ?? null,
    latestPublishDate: info?.latestPublishDate ?? null,
    currentVersionPublishDate: null,
    currentImageCreated: c.imageCreatedDate ?? null,
    provider: info?.provider ?? REGISTRY_TO_PROVIDER[info?.registry] ?? null,
    hasUpdate: info ? !!info.hasUpdate : false,
    noDigest: info?.noDigest ?? false,
    lastChecked: info?.lastChecked ?? null,
    existsInDockerHub: Boolean(info?.latestDigest),
  };

  container.source = "runner";
  container.runnerId = Number(src.id);
  container.runnerName = src.name ?? null;
  container.runnerUrl = src.url ?? null;
  container.sourceUrl = src.url ?? null;
  container.sourceName = src.name ?? null;

  return container;
}

// Group flat containers into the legacy REST stacks shape:
// [{ name, containers }] with an "Unstacked" pseudo-stack last. Keyed by
// source + name so identically named stacks on different runners stay apart.
function deriveStacks(containers) {
  const byStack = new Map();
  const unstacked = [];
  for (const container of containers) {
    if (container.stackName) {
      const key = `${container.runnerId ?? ""}|${container.stackName}`;
      if (!byStack.has(key)) byStack.set(key, { name: container.stackName, containers: [] });
      byStack.get(key).containers.push(container);
    } else {
      unstacked.push(container);
    }
  }
  const stacks = Array.from(byStack.values());
  if (unstacked.length > 0) stacks.push({ name: "Unstacked", containers: unstacked });
  return stacks;
}

/**
 * Fetch the full container set via GraphQL containerGroup. The Go backend
 * already merges live runner data (replacing stale DB runner rows), so this
 * replaces the legacy GET /api/containers call including its runner-append
 * middleware. Returns { containers, stacks } in the legacy response shape.
 */
export async function fetchContainersGraphql() {
  const result = await graphqlClient.query(CONTAINERS_QUERY).toPromise();
  if (result.error) throw result.error;
  const group = result.data?.containerGroup;
  if (!group) throw new Error("containerGroup query returned no data");

  const items = [
    ...(group.standalone?.items || []),
    ...(group.stacks || []).flatMap((stack) => stack.containers?.items || []),
  ];
  const containers = items.map(mapGqlContainer);
  // Runner ids are Strings in GraphQL; the UI keys sources as "runner:<numeric id>".
  const runners = (group.runners || []).map((r) => ({
    id: Number(r.id),
    name: r.name ?? null,
    url: r.url ?? null,
    enabled: r.enabled ?? true,
    dockerEnabled: r.dockerEnabled ?? true,
    healthStatus: r.healthStatus ?? null,
  }));
  return { containers, stacks: deriveStacks(containers), runners };
}

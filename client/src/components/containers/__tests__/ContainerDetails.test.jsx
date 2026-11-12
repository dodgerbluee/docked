import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import SourceContainerCard from "../SourceContainerCard";
import ContainersTab from "../ContainersTab";
import ContainerDebugModal from "../ContainerDebugModal";
import TrackedAppCard from "../../TrackedAppCard";
import { graphqlClient } from "../../../graphql/client";

vi.mock("../../../graphql/client", () => ({ graphqlClient: { query: vi.fn() } }));
const container = {
  id: "docker-id",
  runnerId: 7,
  name: "web",
  image: "nginx:latest",
  currentVersion: "latest",
  newVersion: "latest",
};
const cardProps = {
  container,
  isPortainer: false,
  selected: false,
  upgrading: false,
  showUpdates: false,
  onToggleSelect: vi.fn(),
  onUpgrade: vi.fn(),
  onOpenDetails: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("restored Container Details", () => {
  it.each(["all", "updates", "current"])("passes the details action through the %s tab", (view) => {
    const onOpenDetails = vi.fn();
    const item = { ...container, runnerName: "host", hasUpdate: view !== "current" };
    render(
      <ContainersTab
        groupedStacks={[{ stackName: "frontend", groupKey: "7:frontend", containers: [item] }]}
        isLoading={false}
        hasData
        showAll={view === "all"}
        showUpdates={view === "updates"}
        dockerHubDataPulled
        lastPullTime={null}
        collapsedStacks={new Set()}
        selectedContainers={new Set()}
        upgrading={{}}
        isPortainerContainer={() => false}
        onToggleStack={vi.fn()}
        onToggleSelect={vi.fn()}
        onUpgrade={vi.fn()}
        onOpenDetails={onOpenDetails}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Open container details for web" }));
    expect(onOpenDetails).toHaveBeenCalledWith(item);
  });

  it.each([
    { showUpdates: false },
    { showUpdates: true },
    { showUpdates: true, upgrading: true },
    { showUpdates: true, isPortainer: true },
  ])("name opens inspection independently of upgrade eligibility: %j", (overrides) => {
    render(<SourceContainerCard {...cardProps} {...overrides} />);
    fireEvent.click(screen.getByRole("button", { name: "Open container details for web" }));
    expect(cardProps.onOpenDetails).toHaveBeenCalledWith(container);
    expect(cardProps.onUpgrade).not.toHaveBeenCalled();
  });

  it("keyboard name activation opens details, while the card body opens upgrade confirmation", () => {
    render(<SourceContainerCard {...cardProps} showUpdates />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Open container details for web" }), {
      key: "Enter",
    });
    expect(cardProps.onOpenDetails).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("article"));
    expect(cardProps.onUpgrade).toHaveBeenCalledWith(container);
  });

  it("loads full deployed and registry SHAs for the selected runner", async () => {
    const oldSha = `sha256:${"a".repeat(64)}`;
    const newSha = `sha256:${"b".repeat(64)}`;
    graphqlClient.query.mockReturnValue({
      toPromise: async () => ({
        data: {
          containerDetails: {
            container: { container_name: "web" },
            repoDigests: [`nginx@${oldSha}`],
            currentDigest: oldSha,
            latestDigest: newSha,
            upgradeHistory: [],
          },
        },
      }),
    });
    render(<ContainerDebugModal container={container} onClose={vi.fn()} />);
    expect(await screen.findByText(`nginx@${oldSha}`)).toBeInTheDocument();
    expect(screen.getByText(newSha)).toBeInTheDocument();
    expect(graphqlClient.query).toHaveBeenCalledWith(expect.any(String), {
      containerId: "docker-id",
      runnerId: "7",
    });
    expect(screen.getByRole("dialog", { name: "Container Details" })).toBeInTheDocument();
  });

  it("reports failed reads and allows retry instead of showing missing SHA values", async () => {
    graphqlClient.query.mockReturnValueOnce({
      toPromise: async () => ({ error: new Error("Runner unavailable") }),
    });
    graphqlClient.query.mockReturnValueOnce({
      toPromise: async () => ({
        data: { containerDetails: { currentDigest: "sha256:recovered", upgradeHistory: [] } },
      }),
    });
    render(<ContainerDebugModal container={container} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Runner unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    expect(await screen.findByText("sha256:recovered")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

it("tracked apps still open the editor on hold without also upgrading", () => {
  vi.useFakeTimers();
  const onEdit = vi.fn(),
    onUpgrade = vi.fn();
  const image = {
    id: 1,
    name: "app",
    source_type: "docker",
    image_name: "nginx",
    has_update: true,
    latest_version: "2",
  };
  render(<TrackedAppCard image={image} onEdit={onEdit} onUpgrade={onUpgrade} />);
  const card = screen.getByRole("button", { name: "Mark app as upgraded" });
  fireEvent.pointerDown(card, { button: 0 });
  act(() => vi.advanceTimersByTime(500));
  fireEvent.pointerUp(card);
  fireEvent.click(card);
  expect(onEdit).toHaveBeenCalledWith(image);
  expect(onUpgrade).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Edit app" })).toBeInTheDocument();
});

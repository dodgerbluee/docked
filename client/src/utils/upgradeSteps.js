/**
 * Shared upgrade step definitions for Portainer container upgrades.
 * Used by UpgradeProgressModal and PortainerUpgradeProgressBanner.
 */

import { TIMING } from "../constants/timing";

/**
 * Returns the list of step labels and durations for a container upgrade.
 * @param {Object} container - Container object (may have providesNetwork, usesNetworkMode, image, etc.)
 * @returns {Array<{ label: string, duration: number }>}
 */
export function getUpgradeSteps(container) {
  if (!container) {
    return [
      { label: "Stopping container...", duration: TIMING.STEP_DURATION_STOP },
      { label: "Pulling latest image...", duration: TIMING.STEP_DURATION_PULL },
      { label: "Removing old container...", duration: TIMING.STEP_DURATION_REMOVE },
      { label: "Creating new container...", duration: TIMING.STEP_DURATION_CREATE },
      { label: "Starting container...", duration: TIMING.STEP_DURATION_START },
      { label: "Waiting for container to be ready...", duration: TIMING.STEP_DURATION_WAIT_READY },
    ];
  }

  if (container.providesNetwork) {
    return [
      {
        label: "Stopping dependent containers...",
        duration: TIMING.STEP_DURATION_START_DEPENDENTS,
      },
      {
        label: "Removing dependent containers...",
        duration: TIMING.STEP_DURATION_START_DEPENDENTS,
      },
      { label: "Waiting for cleanup...", duration: TIMING.STEP_DURATION_CLEANUP },
      { label: "Stopping tunnel container...", duration: TIMING.STEP_DURATION_STOP },
      { label: "Pulling latest image...", duration: TIMING.STEP_DURATION_PULL },
      { label: "Removing old tunnel container...", duration: TIMING.STEP_DURATION_REMOVE },
      { label: "Creating new tunnel container...", duration: TIMING.STEP_DURATION_CREATE },
      { label: "Starting tunnel container...", duration: TIMING.STEP_DURATION_START },
      { label: "Waiting for tunnel to be ready...", duration: TIMING.STEP_DURATION_WAIT_NETWORK },
      { label: "Recreating dependent containers...", duration: TIMING.STEP_DURATION_RECREATE },
      {
        label: "Starting dependent containers...",
        duration: TIMING.STEP_DURATION_START_DEPENDENTS,
      },
    ];
  }

  if (container.usesNetworkMode) {
    return [
      { label: "Stopping container...", duration: TIMING.STEP_DURATION_STOP },
      { label: "Pulling latest image...", duration: TIMING.STEP_DURATION_PULL },
      { label: "Removing old container...", duration: TIMING.STEP_DURATION_REMOVE },
      {
        label: "Waiting for network container to be ready...",
        duration: TIMING.STEP_DURATION_WAIT_NETWORK,
      },
      { label: "Creating new container...", duration: TIMING.STEP_DURATION_CREATE },
      { label: "Starting container...", duration: TIMING.STEP_DURATION_START },
      {
        label: "Waiting for container to be ready...",
        duration: TIMING.STEP_DURATION_WAIT_READY_SHORT,
      },
    ];
  }

  return [
    { label: "Stopping container...", duration: TIMING.STEP_DURATION_STOP },
    { label: "Pulling latest image...", duration: TIMING.STEP_DURATION_PULL },
    { label: "Removing old container...", duration: TIMING.STEP_DURATION_REMOVE },
    { label: "Creating new container...", duration: TIMING.STEP_DURATION_CREATE },
    { label: "Starting container...", duration: TIMING.STEP_DURATION_START },
    { label: "Waiting for container to be ready...", duration: TIMING.STEP_DURATION_WAIT_READY },
  ];
}

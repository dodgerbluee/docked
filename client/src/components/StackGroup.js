/**
 * Stack Group Component
 * Displays a group of containers organized by stack
 */

import React, { memo } from 'react';
import ContainerCard from './ContainerCard';

const StackGroup = memo(
  ({
    stack,
    containers,
    showUpdates,
    collapsed,
    selectedContainers,
    upgrading,
    isPortainerContainer,
    onToggleStack,
    onToggleSelect,
    onUpgrade,
  }) => {
    const stackContainersWithUpdates = containers.filter((c) => c.hasUpdate);
    const stackContainersUpToDate = containers.filter((c) => !c.hasUpdate);

    // If showing updates section, only show stacks with updates
    if (showUpdates && stackContainersWithUpdates.length === 0) {
      return null;
    }

    // If showing up-to-date section, only show stacks with up-to-date containers
    if (!showUpdates && stackContainersUpToDate.length === 0) {
      return null;
    }

    const stackKey = `${stack.stackName}-${showUpdates ? 'updates' : 'current'}`;
    const isCollapsed = collapsed.has(stackKey);
    const displayName =
      stack.stackName === 'Standalone'
        ? 'Standalone Containers'
        : `Stack: ${stack.stackName}`;

    const containersToShow = showUpdates
      ? stackContainersWithUpdates
      : stackContainersUpToDate;

    return (
      <div className="stack-group">
        <div className="stack-header" onClick={() => onToggleStack(stackKey)}>
          <div className="stack-header-left">
            <button className="stack-toggle" aria-label="Toggle stack">
              {isCollapsed ? '▶' : '▼'}
            </button>
            <h3 className="stack-name">{displayName}</h3>
          </div>
          <span className="stack-count">
            {showUpdates && stackContainersWithUpdates.length > 0 && (
              <span className="update-count">
                {stackContainersWithUpdates.length} update
                {stackContainersWithUpdates.length !== 1 ? 's' : ''} available
              </span>
            )}
            {!showUpdates && (
              <span>
                {stackContainersUpToDate.length} container
                {stackContainersUpToDate.length !== 1 ? 's' : ''}
              </span>
            )}
          </span>
        </div>
        {!isCollapsed && containersToShow.length > 0 && (
          <div className="containers-grid">
            {containersToShow.map((container) => {
              const isPortainer = isPortainerContainer(container);
              return (
                <ContainerCard
                  key={container.id}
                  container={container}
                  isPortainer={isPortainer}
                  selected={selectedContainers.has(container.id)}
                  upgrading={upgrading[container.id]}
                  onToggleSelect={onToggleSelect}
                  onUpgrade={onUpgrade}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }
);

StackGroup.displayName = 'StackGroup';

export default StackGroup;


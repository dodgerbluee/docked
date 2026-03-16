/**
 * Settings Component (Refactored)
 * Uses useSettings hook and individual tab components
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "./Settings.css";
import { useSettings } from "../hooks/useSettings";
import SettingsHeader from "./settings/components/SettingsHeader";
import SettingsTabs from "./settings/components/SettingsTabs";

const Settings = React.memo(
  function Settings({
    username,
    onUsernameUpdate,
    onLogout,
    onPasswordUpdateSuccess,
    onSourceInstancesChange,
    activeSection = "general",
    onSectionChange = null,
    showUserInfoAboveTabs = false,
    onEditInstance = null,
    avatar,
    recentAvatars = [],
    onAvatarChange,
    onRecentAvatarsChange,
    onAvatarUploaded,
    onBatchConfigUpdate = null,
    colorScheme = "system",
    onColorSchemeChange = null,
    refreshInstances = null,
    onClearSourceData = null,
    onClearTrackedAppData = null,
    containers = [],
    sourceInstances = [],
  }) {
    // Memoize callbacks to avoid stale closures and prevent unnecessary re-renders
    const handleBatchConfigUpdate = useCallback(
      (config) => {
        if (onBatchConfigUpdate) {
          onBatchConfigUpdate(config);
        }
      },
      [onBatchConfigUpdate]
    );

    const handleAvatarChange = useCallback(
      (avatar) => {
        if (onAvatarChange) {
          onAvatarChange(avatar);
        }
      },
      [onAvatarChange]
    );

    // Memoize onSourceInstancesChange to prevent re-renders when container state changes
    const handleSourceInstancesChange = useCallback(async () => {
      if (onSourceInstancesChange) {
        await onSourceInstancesChange();
      }
    }, [onSourceInstancesChange]);

    // Memoize onColorSchemeChange to prevent re-renders
    const handleColorSchemeChange = useCallback(
      (scheme) => {
        if (onColorSchemeChange) {
          onColorSchemeChange(scheme);
        }
      },
      [onColorSchemeChange]
    );

    // Memoize useSettings inputs to prevent re-initialization when parent re-renders
    const settingsInputs = useMemo(
      () => ({
        username,
        onUsernameUpdate,
        onPasswordUpdateSuccess,
        onSourceInstancesChange: handleSourceInstancesChange,
        onAvatarChange: handleAvatarChange,
        onBatchConfigUpdate: handleBatchConfigUpdate,
        colorScheme,
        onColorSchemeChange: handleColorSchemeChange,
        refreshInstances,
        activeSection,
      }),
      [
        username,
        onUsernameUpdate,
        onPasswordUpdateSuccess,
        handleSourceInstancesChange,
        handleAvatarChange,
        handleBatchConfigUpdate,
        colorScheme,
        handleColorSchemeChange,
        refreshInstances,
        activeSection,
      ]
    );

    // Use the useSettings hook for all state and API calls
    const settings = useSettings(settingsInputs);

    // Use prop if provided, otherwise use internal state
    const [internalActiveSection, setInternalActiveSection] = useState(activeSection);

    const currentActiveSection = activeSection || internalActiveSection;
    // eslint-disable-next-line no-unused-vars
    const setActiveSection = onSectionChange || setInternalActiveSection;

    // Local state for data clearing operations
    const [clearingSourceData, setClearingSourceData] = useState(false);
    const [clearingTrackedAppData, setClearingTrackedAppData] = useState(false);

    // Store stable references to clear handlers using refs to prevent re-renders
    // when parent component re-renders due to container state changes
    const onClearSourceDataRef = useRef(onClearSourceData);
    const onClearTrackedAppDataRef = useRef(onClearTrackedAppData);

    // Update refs when props change, but don't trigger re-renders
    useEffect(() => {
      onClearSourceDataRef.current = onClearSourceData;
    }, [onClearSourceData]);

    useEffect(() => {
      onClearTrackedAppDataRef.current = onClearTrackedAppData;
    }, [onClearTrackedAppData]);

    // Wrap onClearSourceData to track clearing state locally
    // This prevents flickering by managing state locally instead of relying on parent re-renders
    // Use refs to access the latest handlers without causing re-renders
    const handleClearSourceData = useCallback(async () => {
      if (!onClearSourceDataRef.current) return;

      try {
        setClearingSourceData(true);
        await onClearSourceDataRef.current();
      } catch (error) {
        console.error("Error clearing source data:", error);
      } finally {
        // Use setTimeout to ensure state updates complete before resetting
        setTimeout(() => {
          setClearingSourceData(false);
        }, 100);
      }
    }, []); // Empty deps - use refs instead

    // Wrap onClearTrackedAppData to track clearing state locally
    const handleClearTrackedAppData = useCallback(async () => {
      if (!onClearTrackedAppDataRef.current) return;

      try {
        setClearingTrackedAppData(true);
        await onClearTrackedAppDataRef.current();
      } catch (error) {
        console.error("Error clearing tracked app data:", error);
      } finally {
        // Use setTimeout to ensure state updates complete before resetting
        setTimeout(() => {
          setClearingTrackedAppData(false);
        }, 100);
      }
    }, []); // Empty deps - use refs instead

    // Track previous color scheme to detect user-initiated changes
    const prevColorSchemeRef = useRef(colorScheme);

    // Sync local color scheme changes - only when user actually changes it
    // Don't trigger on initial mount or when settings object changes
    useEffect(() => {
      // Only mark as changed if the user actually changed the color scheme
      // (not on initial mount or when settings object reference changes)
      if (
        prevColorSchemeRef.current !== settings.localColorScheme &&
        prevColorSchemeRef.current !== undefined
      ) {
        settings.setGeneralSettingsChanged(true);
      }
      prevColorSchemeRef.current = settings.localColorScheme;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.localColorScheme, settings.setGeneralSettingsChanged]);

    // Sync activeSection prop to internal state
    useEffect(() => {
      if (activeSection) {
        // Always sync when activeSection prop changes
        setInternalActiveSection(activeSection);
      }
    }, [activeSection]);

    return (
      <>
        <SettingsHeader
          userInfo={settings.userInfo}
          showUserInfoAboveTabs={showUserInfoAboveTabs}
        />

        {!showUserInfoAboveTabs && (
          <SettingsTabs
            currentActiveSection={currentActiveSection}
            settings={settings}
            avatar={avatar}
            recentAvatars={recentAvatars}
            onAvatarChange={onAvatarChange}
            onRecentAvatarsChange={onRecentAvatarsChange}
            onAvatarUploaded={onAvatarUploaded}
            onEditInstance={onEditInstance}
            handleClearSourceData={handleClearSourceData}
            handleClearTrackedAppData={handleClearTrackedAppData}
            clearingSourceData={clearingSourceData}
            clearingTrackedAppData={clearingTrackedAppData}
            containers={containers}
            sourceInstances={sourceInstances}
          />
        )}
      </>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison function to prevent re-renders when container state changes
    // Only re-render if props that Settings actually cares about have changed
    // Note: onClearSourceData and onClearTrackedAppData are intentionally excluded
    // because we use refs to store them, so reference changes don't matter
    return (
      prevProps.username === nextProps.username &&
      prevProps.activeSection === nextProps.activeSection &&
      prevProps.showUserInfoAboveTabs === nextProps.showUserInfoAboveTabs &&
      prevProps.colorScheme === nextProps.colorScheme &&
      prevProps.avatar === nextProps.avatar &&
      JSON.stringify(prevProps.recentAvatars) === JSON.stringify(nextProps.recentAvatars) &&
      // For function props, we compare by reference - they should be stable due to useCallback/useRef
      prevProps.onUsernameUpdate === nextProps.onUsernameUpdate &&
      prevProps.onLogout === nextProps.onLogout &&
      prevProps.onPasswordUpdateSuccess === nextProps.onPasswordUpdateSuccess &&
      prevProps.onSourceInstancesChange === nextProps.onSourceInstancesChange &&
      prevProps.onAvatarChange === nextProps.onAvatarChange &&
      prevProps.onRecentAvatarsChange === nextProps.onRecentAvatarsChange &&
      prevProps.onAvatarUploaded === nextProps.onAvatarUploaded &&
      prevProps.onBatchConfigUpdate === nextProps.onBatchConfigUpdate &&
      prevProps.onColorSchemeChange === nextProps.onColorSchemeChange &&
      // onClearSourceData and onClearTrackedAppData excluded - we use refs, so reference changes don't matter
      prevProps.onEditInstance === nextProps.onEditInstance &&
      prevProps.onSectionChange === nextProps.onSectionChange &&
      prevProps.refreshInstances === nextProps.refreshInstances &&
      prevProps.containers === nextProps.containers &&
      prevProps.sourceInstances === nextProps.sourceInstances
    );
  }
);

export default Settings;

import React from "react";
import { AlertTriangle } from "lucide-react";

function OfflineRunnerBanner({ offlineRunners, onNavigateToSettings }) {
  if (!offlineRunners || offlineRunners.length === 0) return null;

  const names = offlineRunners.map((r) => r.name);
  const label =
    names.length === 1
      ? `Runner "${names[0]}" is offline`
      : `${names.length} runners are offline: ${names.join(", ")}`;

  return (
    <div
      className="offline-runner-banner"
      role="alert"
      onClick={onNavigateToSettings}
      style={{ cursor: onNavigateToSettings ? "pointer" : "default" }}
    >
      <AlertTriangle size={18} />
      <span>{label}</span>
    </div>
  );
}

export default OfflineRunnerBanner;

/**
 * operationLog
 *
 * Shared helpers for dockhand operation output: the task status enum and the
 * ANSI/VT log-line processor. Used by both the single-instance RunOperationModal
 * and the multi-task operation manager (useOperationTasks / OperationTaskModal).
 */

export const STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  DONE: "done",
  ERROR: "error",
};

// Strip ANSI/VT escape sequences (colors, cursor movement, OSC) without literal control chars
const ANSI_CSI_RE = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, "g");
const ANSI_OSC_RE = new RegExp(String.raw`\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)`, "g");
const ANSI_OTHER_RE = new RegExp(String.raw`\u001b.`, "g");
// Detect clear-screen sequences (ESC[2J or ESC[3J) — signal to reset the line buffer
const CLEAR_SCREEN_RE = new RegExp(String.raw`\u001b\[(?:2J|3J)`);

export function processRawLog(raw) {
  const shouldClear = CLEAR_SCREEN_RE.test(raw);
  const stripped = raw.replace(ANSI_OSC_RE, "").replace(ANSI_CSI_RE, "").replace(ANSI_OTHER_RE, "");

  // Split into display lines; handle \r (carriage-return overwrite): last segment wins
  const lines = stripped
    .split("\n")
    .map((seg) => {
      const parts = seg.split("\r");
      return parts[parts.length - 1];
    })
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  return { shouldClear, lines };
}

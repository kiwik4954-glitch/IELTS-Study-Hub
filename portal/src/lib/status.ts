import type { ModuleStatus } from "../services/api";

export type StatusTone = "running" | "busy" | "idle" | "error" | "muted";

export interface StatusDescriptor {
  label: string;
  tone: StatusTone;
  /** Short, honest explanation used in the card footer. */
  description: string;
}

const STATUS: Record<ModuleStatus, StatusDescriptor> = {
  running: {
    label: "Running",
    tone: "running",
    description: "Answering its health check on loopback.",
  },
  starting: {
    label: "Starting…",
    tone: "busy",
    description: "Waiting for the app to answer its health check.",
  },
  stopping: {
    label: "Stopping…",
    tone: "busy",
    description: "Closing only the process the Hub started.",
  },
  stopped: {
    label: "Stopped",
    tone: "idle",
    description: "Not running. Start it when you need it.",
  },
  error: {
    label: "Error",
    tone: "error",
    description: "The last attempt did not succeed. Check the Hub note below.",
  },
  "not-installed": {
    label: "Not installed",
    tone: "muted",
    description: "This module is not present in this checkout.",
  },
  "not-ready": {
    label: "Needs setup",
    tone: "muted",
    description: "Dependencies or configuration are missing. Run setup first.",
  },
  unknown: {
    label: "Status unknown",
    tone: "muted",
    description: "No usable status has arrived from the Hub yet.",
  },
};

export function describeStatus(status: ModuleStatus): StatusDescriptor {
  return STATUS[status];
}

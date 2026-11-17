import { describeStatus } from "../lib/status";
import type { ModuleStatus } from "../services/api";

interface StatusPillProps {
  status: ModuleStatus;
  compact?: boolean;
}

export function StatusPill({ status, compact = false }: StatusPillProps) {
  const { label, tone } = describeStatus(status);

  return (
    <span
      className={`status-pill status-pill--${tone}${compact ? " status-pill--compact" : ""}`}
      data-status={status}
    >
      <span className="status-dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

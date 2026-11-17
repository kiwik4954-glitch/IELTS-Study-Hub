import type { ReactNode } from "react";

interface ApiOfflineNoticeProps {
  message: string;
  onRetry: () => void;
  isChecking: boolean;
}

export function ApiOfflineNotice({
  message,
  onRetry,
  isChecking,
}: ApiOfflineNoticeProps) {
  return (
    <div className="notice notice--offline" role="alert">
      <span className="notice-icon" aria-hidden="true">
        !
      </span>
      <div className="notice-body">
        <strong>Hub API offline</strong>
        <p>
          {message} The portal stays usable. Module status, Open links and
          Start/Stop stay disabled until the Hub answers.
        </p>
      </div>
      <button
        type="button"
        className="button button--small button--secondary"
        onClick={onRetry}
        disabled={isChecking}
      >
        {isChecking ? "Retrying…" : "Retry connection"}
      </button>
    </div>
  );
}

interface LoadingPanelProps {
  label?: string;
}

export function LoadingPanel({
  label = "Talking to the Hub API…",
}: LoadingPanelProps) {
  return (
    <div className="panel loading-panel" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  description?: string;
  id?: string;
  actions?: ReactNode;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  id,
  actions,
}: SectionHeadingProps) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
        {description ? <p className="section-copy">{description}</p> : null}
      </div>
      {actions ? <div className="section-heading-actions">{actions}</div> : null}
    </div>
  );
}

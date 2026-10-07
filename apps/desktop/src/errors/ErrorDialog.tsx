import { useState } from "react";

import type { AppErrorDto } from "../generated/ipc";
import { recoveryChoices, type RecoveryAction } from "./actions";

interface ErrorDialogProps {
  error: AppErrorDto;
  onAction: (action: RecoveryAction) => void;
  onDismiss: () => void;
}

export function ErrorDialog({
  error,
  onAction,
  onDismiss,
}: ErrorDialogProps) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const choices = recoveryChoices(error);

  return (
    <section
      className="error-dialog"
      role="alertdialog"
      aria-label="Operation failed"
      aria-describedby="error-dialog-message"
    >
      <div className="error-dialog-heading">
        <strong>Operation failed</strong>
        <button type="button" aria-label="Dismiss error" onClick={onDismiss}>
          ×
        </button>
      </div>

      <p id="error-dialog-message">{error.message}</p>

      {choices.length > 0 ? (
        <div className="error-dialog-actions">
          {choices.map((choice) => (
            <button
              key={choice.action}
              type="button"
              onClick={() => onAction(choice.action)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="technical-details-toggle"
        aria-expanded={showTechnicalDetails}
        onClick={() => setShowTechnicalDetails((visible) => !visible)}
      >
        Technical details
      </button>

      {showTechnicalDetails ? (
        <div className="technical-details">
          <div>{error.component} · {error.operation}</div>
          <div>{error.category} / {error.code}</div>
          <div>{error.technical_detail}</div>
          {error.request_id ? <div>Request: {error.request_id}</div> : null}
          {error.job_id ? <div>Job: {error.job_id}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

export function JobStatus() {
  return (
    <div className="job-status" role="status" aria-label="Background jobs" data-testid="job-status">
      <span className="status-dot" aria-hidden="true" />
      <span>Background jobs</span>
      <span className="job-state">Idle</span>
    </div>
  );
}
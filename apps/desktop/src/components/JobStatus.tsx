export function JobStatus() {
  return (
    <div className="job-status" role="status" aria-label="Background jobs" data-testid="job-status">
      <span className="status-dot" aria-hidden="true" />
      <span>Фоновые задачи</span>
      <span className="job-state">Ожидание</span>
    </div>
  );
}
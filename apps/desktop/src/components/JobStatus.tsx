export function JobStatus() {
  return (
    <div className="job-status" role="status" aria-label="Фоновые задачи" data-testid="job-status">
      <span className="status-dot" aria-hidden="true" />
      <span>Фоновые задачи</span>
      <span className="job-state">Ожидание</span>
    </div>
  );
}
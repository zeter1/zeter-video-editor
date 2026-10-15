import { useEffect, useState } from "react";

import type { JobEventDto } from "../generated/ipc";
import type { IpcClient } from "../ipc/client";

export interface ExportJobView {
  initial: JobEventDto;
  outputPath: string;
}

interface JobStatusProps {
  job?: ExportJobView | null;
  client?: IpcClient;
  onDismiss?: () => void;
  onOpenQueue?: () => void;
}

const terminal = (state: JobEventDto["state"]) =>
  state === "Completed" || state === "Cancelled" || state === "Failed";

export function JobStatus({ job, client, onDismiss, onOpenQueue }: JobStatusProps) {
  const [snapshot, setSnapshot] = useState<JobEventDto | null>(job?.initial ?? null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!job || !client) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSnapshot(job.initial);
    setPollError(null);
    const poll = async () => {
      try {
        const next = await client.getJobState(job.initial.job_id);
        if (disposed) return;
        setSnapshot((previous) => previous && terminal(previous.state) ? previous : next);
        if (!terminal(next.state)) timer = setTimeout(poll, 500);
      } catch {
        if (!disposed) setPollError("Не удалось получить состояние экспорта. Проверьте диагностику.");
      }
    };
    timer = setTimeout(poll, 400);
    return () => { disposed = true; clearTimeout(timer); };
  }, [client, job?.initial.job_id]);

  async function cancel(): Promise<void> {
    // The button is visible from job.initial immediately, before the effect
    // copies it into local polling state. Cancellation must be just as ready.
    const current = snapshot?.job_id === job?.initial.job_id ? snapshot : job?.initial;
    if (!client || !job || !current || terminal(current.state)) return;
    setCancelling(true);
    try {
      const next = await client.cancelJob(job.initial.job_id);
      setSnapshot(next);
    } catch {
      setPollError("Не удалось отменить экспорт. Проверьте состояние задания.");
    } finally {
      setCancelling(false);
    }
  }

  const state = snapshot?.state ?? job?.initial.state;
  const label = state === "Completed" ? "Готово" :
    state === "Failed" ? "Ошибка" : state === "Cancelled" ? "Отменено" :
    cancelling ? "Отмена…" : state === "Queued" ? "В очереди" : "Кодирование…";
  const filename = job?.outputPath.split(/[\\/]/).pop() ?? "";

  return (
    <div className="job-status" role="status" aria-label="Background jobs" data-testid="job-status"
      aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <button type="button" onClick={onOpenQueue} disabled={!onOpenQueue}>
        Все задачи экспорта
      </button>
      {!job ? <span className="job-state">Ожидание</span> : (
        <>
          <span className="job-state" title={job.outputPath}>MP4: {filename} · {label}</span>
          {state === "Running" || state === "Queued" ? (
            <progress aria-label="Прогресс экспорта" max={1}
              value={snapshot && snapshot.progress > 0 ? snapshot.progress : undefined} />
          ) : null}
          {state === "Failed" ? (
            <span role="alert">{snapshot?.failure?.safe_message ?? "Ошибка экспорта MP4"}</span>
          ) : null}
          {pollError ? <span role="alert">{pollError}</span> : null}
          {!terminal(state ?? "Running") ? (
            <button type="button" onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? "Отмена…" : "Отменить экспорт"}
            </button>
          ) : (
            <button type="button" onClick={onDismiss}>Закрыть</button>
          )}
        </>
      )}
    </div>
  );
}

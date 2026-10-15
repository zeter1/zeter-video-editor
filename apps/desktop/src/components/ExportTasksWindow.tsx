import { useCallback, useEffect, useState } from "react";

import type { ExportTaskDto } from "../generated/ipc";
import { ipcClient, type IpcClient } from "../ipc/client";
import "../styles/app.css";

interface Props { client?: IpcClient; }
const labels = {
  Queued: "Ожидает", Running: "Кодирование", Completed: "Готово",
  Failed: "Ошибка", Cancelled: "Отменено",
} as const;

export function ExportTasksWindow({ client = ipcClient }: Props) {
  const [tasks, setTasks] = useState<ExportTaskDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setTasks(await client.listExportTasks());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка загрузки заданий экспорта.");
    }
  }, [client]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => { if (!disposed) await reload(); };
    void refresh();
    const interval = setInterval(() => void refresh(), 500);
    return () => { disposed = true; clearInterval(interval); };
  }, [reload]);

  async function cancel(id: string) {
    setCancelling(id);
    try {
      await client.cancelJob(id);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отменить задачу.");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <main className="export-tasks-page theme-dark" aria-label="Очередь экспорта">
      <header className="export-tasks-header">
        <div><h1>Задачи экспорта</h1>
          <p>Очередь MP4/H.264 — можно продолжать монтаж в основном окне.</p></div>
        <button type="button" onClick={() => void reload()}>Обновить</button>
      </header>
      {error ? <p role="alert" className="export-tasks-error">{error}</p> : null}
      {tasks.length === 0 ? (
        <p className="export-tasks-empty">Задач пока нет. Выделите диапазон на таймлайне и нажмите «Экспорт MP4».</p>
      ) : (
        <div className="export-tasks-list" role="list">
          {tasks.map(({ job, output_path, range_start_us, range_end_us }) => {
            const percentage = Math.round(job.progress * 100);
            const active = job.state === "Running" || job.state === "Queued";
            return <article className="export-task" role="listitem" key={job.job_id}>
              <div className="export-task-top">
                <strong title={output_path}>{output_path.split(/[\\/]/).pop()}</strong>
                <span>{labels[job.state]}</span>
              </div>
              <p className="export-task-path" title={output_path}>{output_path}</p>
              <p className="export-task-range">
                {range_start_us === null || range_end_us === null
                  ? "Вся последовательность" : `Диапазон: ${(range_start_us / 1_000_000).toFixed(2)}–${(range_end_us / 1_000_000).toFixed(2)} сек.`}
                {" · "}Ревизия проекта: {job.source_revision}
              </p>
              <div className="export-task-progress">
                <progress max={100} value={percentage} aria-label={`Прогресс ${output_path.split(/[\\/]/).pop()}`} />
                <span>{job.state === "Queued" ? "В очереди" : `${percentage}%`}</span>
              </div>
              <div className="export-task-actions">
                {job.state === "Failed" ? <span role="alert">{job.failure?.safe_message ?? "Экспорт не удался"}</span> : null}
                {active ? <button type="button" disabled={cancelling === job.job_id}
                    onClick={() => void cancel(job.job_id)}>
                    {cancelling === job.job_id ? "Отмена…" : "Отменить задачу"}
                  </button> : null}
              </div>
            </article>;
          })}
        </div>
      )}
    </main>
  );
}

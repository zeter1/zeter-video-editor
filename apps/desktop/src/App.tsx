import { AppShell } from "./app/AppShell";
import { ExportTasksWindow } from "./components/ExportTasksWindow";

export function App() {
  return new URLSearchParams(window.location.search).has("export-queue")
    ? <ExportTasksWindow /> : <AppShell />;
}
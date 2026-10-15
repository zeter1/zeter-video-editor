import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { AppShell } from "./app/AppShell";
import { ExportTasksWindow } from "./components/ExportTasksWindow";

export function App() {
  // Tauri knows which native WebView this entry point is running in.
  // A separate window should not depend on URL query preservation by the
  // Windows custom-protocol asset resolver.
  const isExportWindow = isTauri()
    ? getCurrentWebview().label === "export-queue"
    : new URLSearchParams(window.location.search).has("export-queue");
  return isExportWindow ? <ExportTasksWindow /> : <AppShell />;
}
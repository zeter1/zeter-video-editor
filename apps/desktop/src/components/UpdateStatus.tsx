import { useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";

import type {
  ShutdownBlocker,
  UpdateInstallReadinessDto,
} from "../generated/ipc";
import {
  updateSafetyClient,
  type UpdateSafetyClient,
} from "../ipc/client";

export interface UpdateHandle {
  version: string;
  download(): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}

export type UpdateCheck = () => Promise<UpdateHandle | null>;

type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing";

const blockerMessages: Record<ShutdownBlocker, string> = {
  DirtyProject: "Save the project before installing.",
  SaveInProgress: "Wait for the current save to finish before installing.",
  SaveFailed: "Resolve the save error before installing.",
  ActiveExport: "Wait for the active export to finish before installing.",
  ActiveMediaJobs: "Wait for media processing to finish before installing.",
  ActiveAiJobs: "Wait for AI processing to finish before installing.",
};

async function checkWithTauri(): Promise<UpdateHandle | null> {
  return await check();
}

export function UpdateStatus({
  checkForUpdate = checkWithTauri,
  safetyClient = updateSafetyClient,
}: {
  checkForUpdate?: UpdateCheck;
  safetyClient?: UpdateSafetyClient;
}) {
  const updateRef = useRef<UpdateHandle | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function releaseCurrentUpdate(): Promise<void> {
    const current = updateRef.current;
    updateRef.current = null;
    if (current) {
      await current.close();
    }
  }

  async function handleCheck(): Promise<void> {
    setPhase("checking");
    setMessage(null);
    try {
      await releaseCurrentUpdate();
      const update = await checkForUpdate();
      if (!update) {
        setVersion(null);
        setPhase("idle");
        setMessage("Zeter Video Editor is up to date.");
        return;
      }
      updateRef.current = update;
      setVersion(update.version);
      setPhase("available");
    } catch {
      setPhase("idle");
      setMessage("Update check failed. Try again later.");
    }
  }

  async function handleDownload(): Promise<void> {
    const update = updateRef.current;
    if (!update) {
      return;
    }
    setPhase("downloading");
    setMessage(null);
    try {
      await update.download();
      setPhase("ready");
    } catch {
      setPhase("available");
      setMessage("Update download failed. You can retry or defer it.");
    }
  }

  async function handleInstall(): Promise<void> {
    const update = updateRef.current;
    if (!update) {
      return;
    }

    setMessage(null);
    try {
      const readiness = await safetyClient.getUpdateInstallReadiness();
      if (!readiness.ready) {
        setMessage(
          readiness.blockers.map((blocker) => blockerMessages[blocker]).join(" "),
        );
        return;
      }

      setPhase("installing");
      setMessage("Installing update...");
      await update.install();
    } catch {
      setPhase("ready");
      setMessage("Update installation could not start safely.");
    }
  }

  async function handleDefer(): Promise<void> {
    try {
      await releaseCurrentUpdate();
    } finally {
      setVersion(null);
      setPhase("idle");
      setMessage("Update deferred.");
    }
  }

  const statusText =
    phase === "available" && version
      ? `Update ${version} available`
      : phase === "downloading" && version
        ? `Downloading update ${version}...`
        : phase === "ready" && version
          ? `Update ${version} ready to install`
          : phase === "installing" && version
            ? `Installing update ${version}...`
            : null;

  return (
    <section className="update-status" aria-label="Application updates">
      <div>
        <strong>Updates</strong>
        {statusText ? <span>{statusText}</span> : null}
        {message ? <span role="status">{message}</span> : null}
      </div>
      <div className="update-actions">
        {phase === "idle" ? (
          <button type="button" onClick={() => void handleCheck()}>
            Check for updates
          </button>
        ) : null}
        {phase === "checking" ? (
          <button type="button" disabled>
            Checking...
          </button>
        ) : null}
        {phase === "available" ? (
          <>
            <button
              type="button"
              aria-label="Download update"
              onClick={() => void handleDownload()}
            >
              Download
            </button>
            <button type="button" onClick={() => void handleDefer()}>
              Later
            </button>
          </>
        ) : null}
        {phase === "downloading" ? (
          <button type="button" disabled>
            Downloading...
          </button>
        ) : null}
        {phase === "ready" ? (
          <>
            <button
              type="button"
              aria-label="Install update"
              onClick={() => void handleInstall()}
            >
              Install
            </button>
            <button type="button" onClick={() => void handleDefer()}>
              Later
            </button>
          </>
        ) : null}
        {phase === "installing" ? (
          <button type="button" disabled>
            Installing...
          </button>
        ) : null}
      </div>
    </section>
  );
}

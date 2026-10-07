import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { connectTauri, invokeTauri } from "./tauri";

test("Playwright attaches to the real Tauri WebView2 shell", async () => {
  const { page, state } = await connectTauri();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByText("Zeter Video Editor", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeVisible();

  const cleanReadiness = await invokeTauri<{
    ready: boolean;
    blockers: string[];
  }>(page, "get_update_install_readiness");
  expect(cleanReadiness).toEqual({ ready: true, blockers: [] });

  const snapshot = await invokeTauri<{
    revision: number;
    project: {
      sequences: Array<{
        id: string;
        tracks: Array<{ id: string; muted: boolean }>;
      }>;
    };
  }>(page, "project_open", { path: state.importProjectPath });
  const sequence = snapshot.project.sequences[0];
  const track = sequence?.tracks[0];
  expect(sequence).toBeTruthy();
  expect(track).toBeTruthy();
  if (!sequence || !track) {
    throw new Error("Updater E2E fixture needs one track");
  }

  await invokeTauri(page, "execute_edit_command", {
    request: {
      request_id: randomUUID(),
      expected_revision: snapshot.revision,
      command: {
        SetTrackMute: {
          sequence_id: sequence.id,
          track_id: track.id,
          muted: !track.muted,
        },
      },
    },
  });

  const dirtyReadiness = await invokeTauri<{
    ready: boolean;
    blockers: string[];
  }>(page, "get_update_install_readiness");
  expect(dirtyReadiness.ready).toBe(false);
  expect(dirtyReadiness.blockers).toContain("DirtyProject");

  await invokeTauri(page, "project_save", { path: state.importProjectPath });
  await expect(
    invokeTauri(page, "get_update_install_readiness"),
  ).resolves.toEqual({ ready: true, blockers: [] });
});

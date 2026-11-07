import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

// Exercise the genuine Windows Tauri/WebView2 fullscreen API. Merely asserting
// that a button exists would not prove a browser fullscreen transition.
test("native Preview fullscreen enters and exits without editing the project", async () => {
  const { page, state } = await connectTauri();
  // Do not rely on another test leaving a project open in the shared WebView2.
  await invokeTauri(page, "project_open", { path: state.importProjectPath });
  await page.reload();
  const before = await invokeTauri<unknown>(page, "project_snapshot");
  const entry = page.getByRole("button", { name: "На весь экран" });
  await expect(entry).toBeVisible();
  await entry.click();

  await expect.poll(() => page.evaluate(() =>
    document.fullscreenElement?.classList.contains("preview-stage") ?? false,
  ), { timeout: 10_000 }).toBe(true);
  const exit = page.getByRole("button", { name: "Выйти из полноэкранного режима" });
  await expect(exit).toBeVisible();
  await exit.click();
  await expect.poll(() => page.evaluate(() =>
    document.fullscreenElement === null,
  ), { timeout: 10_000 }).toBe(true);
  await expect(entry).toBeVisible();
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});

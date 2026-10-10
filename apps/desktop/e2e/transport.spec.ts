import { expect, test } from "@playwright/test";

import { connectTauri } from "./tauri";

test("Playwright attaches to the real Tauri WebView2 shell", async () => {
  const { page } = await connectTauri();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByText("Zeter Видеоредактор", { exact: true })).toBeVisible();
});

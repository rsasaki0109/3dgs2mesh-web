import { expect, test } from "@playwright/test";

test("the reproducible GPU benchmark succeeds or exposes a usable fallback", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: /Run reproducible WebGPU benchmark/ })
    .click();
  const ready = page.getByTestId("ready-state");
  const unavailable = page.getByText(/WebGPU benchmark unavailable/);
  await expect(ready.or(unavailable)).toBeVisible({ timeout: 120_000 });
  if (await unavailable.isVisible()) {
    await page.getByText("Advanced settings").click();
    await page
      .getByRole("combobox", { name: "Density backend" })
      .selectOption("wasm");
    await page.getByRole("button", { name: /Convert to mesh/ }).click();
    await expect(ready).toBeVisible({ timeout: 90_000 });
  } else {
    await expect(
      page.locator(".stat", { hasText: "Density backend" }).locator("strong"),
    ).toHaveText("WebGPU");
  }
  await expect(
    page.getByRole("button", { name: /Benchmark JSON/ }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

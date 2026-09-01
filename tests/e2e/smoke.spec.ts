import { expect, test } from "@playwright/test";

test("synthetic sample converts to an editable mesh", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Load deterministic sample/ }).click();
  await expect(page.getByText(/synthetic-sphere\.ply/)).toBeVisible();
  await page.getByRole("button", { name: /Fast/ }).click();
  await page.getByRole("button", { name: /Convert to mesh/ }).click();
  await expect(page.getByTestId("ready-state")).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.getByRole("tab", { name: "Generated Mesh" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator(".stat", { hasText: "Mesh vertices" }).locator("strong"),
  ).not.toHaveText("—");
  await expect(
    page.locator(".stat", { hasText: "Triangles" }).locator("strong"),
  ).not.toHaveText("—");
  await expect(
    page.getByRole("button", { name: /Download GLB/ }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: /Binary PLY/ })).toBeEnabled();
  await page.getByRole("button", { name: "Toggle wireframe" }).click();
  expect(errors).toEqual([]);
});

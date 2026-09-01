import { expect, test } from "@playwright/test";

test("low-memory slabs convert without a resident full density field", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Load deterministic sample/ }).click();
  await page.getByText("Advanced settings").click();
  await page.getByRole("slider", { name: "Grid resolution" }).fill("32");
  await page.getByText("Low-memory slab conversion").click();
  await page.getByRole("slider", { name: "Slab depth" }).fill("8");
  await page.getByLabel("Surface field").selectOption("signed-distance");
  await page.getByRole("button", { name: /Convert to mesh/ }).click();
  await expect(page.getByTestId("ready-state")).toBeVisible({
    timeout: 180_000,
  });
  await expect(
    page.locator(".stat", { hasText: "Density backend" }).locator("strong"),
  ).toHaveText("CPU streaming slabs");
  await expect(page.getByText("Low-memory slabs")).toBeVisible();
  await expect(
    page.locator(".stat", { hasText: "Boundary edges" }).locator("strong"),
  ).toHaveText("0");
  await expect(
    page.locator(".stat", { hasText: "Non-manifold edges" }).locator("strong"),
  ).toHaveText("0");
  await expect(
    page.getByRole("button", { name: /Download GLB/ }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

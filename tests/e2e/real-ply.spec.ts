import { expect, test } from "@playwright/test";

const realPly = process.env.REAL_PLY;

test("an opt-in real PLY converts through the browser worker", async ({
  page,
}) => {
  test.skip(!realPly, "Set REAL_PLY to a local standard 3DGS PLY fixture");
  test.setTimeout(240_000);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Choose a PLY file").setInputFiles(realPly as string);
  await expect(page.getByText(/source Gaussians/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Input inspection warning")).toBeVisible();
  await expect(page.getByRole("button", { name: /Fast/ })).toHaveClass(
    /selected/,
  );
  await page.getByRole("button", { name: /Convert to mesh/ }).click();
  await expect(page.getByTestId("ready-state")).toBeVisible({
    timeout: 180_000,
  });

  const vertices = Number(
    (
      await page
        .locator(".stat", { hasText: "Mesh vertices" })
        .locator("strong")
        .textContent()
    )?.replaceAll(",", ""),
  );
  const triangles = Number(
    (
      await page
        .locator(".stat", { hasText: "Triangles" })
        .locator("strong")
        .textContent()
    )?.replaceAll(",", ""),
  );
  expect(vertices).toBeGreaterThan(0);
  expect(triangles).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: /Download GLB/ }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: /Binary PLY/ })).toBeEnabled();
  expect(errors).toEqual([]);
});

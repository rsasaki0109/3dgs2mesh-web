import { expect, test } from "@playwright/test";

const input = process.env.QUALITY_INPUT;

test("compares density and signed-distance topology on a local asset", async ({
  page,
}) => {
  test.skip(!input, "Set QUALITY_INPUT to a local supported splat asset");
  await page.goto("/");
  await page.getByLabel("Choose a 3DGS file").setInputFiles(input as string);
  await expect(page.locator(".file-chip")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Fast/ }).click();
  await page.getByText("Advanced settings").click();

  const stat = async (label: string) =>
    Number(
      (
        await page
          .locator(".stat", { hasText: label })
          .locator("strong")
          .innerText()
      ).replaceAll(",", ""),
    );
  const convert = async () => {
    await page.getByRole("button", { name: /Convert to mesh/ }).click();
    await expect(page.getByTestId("progress-state")).toBeVisible();
    await expect(page.getByTestId("ready-state")).toBeVisible({
      timeout: 180_000,
    });
    return {
      vertices: await stat("Mesh vertices"),
      triangles: await stat("Triangles"),
      boundaryEdges: await stat("Boundary edges"),
      nonManifoldEdges: await stat("Non-manifold edges"),
      degenerateFaces: await stat("Degenerate faces"),
    };
  };

  const density = await convert();
  await page.getByLabel("Surface field").selectOption("signed-distance");
  const signedDistance = await convert();
  const report = { input, density, signedDistance };
  console.log(`QUALITY_COMPARISON ${JSON.stringify(report)}`);
  expect(density.triangles).toBeGreaterThan(0);
  expect(signedDistance.triangles).toBeGreaterThan(0);
  expect(signedDistance.nonManifoldEdges).toBe(0);
});

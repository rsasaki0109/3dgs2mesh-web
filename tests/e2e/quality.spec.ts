import { expect, test } from "@playwright/test";

const input = process.env.QUALITY_INPUT;
const minimumTriangles = Number(process.env.QUALITY_MIN_TRIANGLES ?? 1);

test("an opt-in real asset produces a quality report", async ({ page }) => {
  test.skip(
    !input,
    "Set QUALITY_INPUT to a local PLY/SPZ/SOG/SPLAT/KSPLAT file",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Choose a 3DGS file").setInputFiles(input as string);
  await expect(page.locator(".file-chip")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Fast/ }).click();
  await page.getByText("Advanced settings").click();
  await page.getByText("Fill enclosed density voids").click();
  await page.getByRole("slider", { name: /Fill mesh holes up to/ }).fill("16");
  await page.getByRole("button", { name: /Convert to mesh/ }).click();
  await expect(page.getByTestId("ready-state")).toBeVisible({
    timeout: 180_000,
  });
  const value = async (label: string) =>
    page.locator(".stat", { hasText: label }).locator("strong").innerText();
  const triangles = Number((await value("Triangles")).replaceAll(",", ""));
  const report = {
    input,
    vertices: Number((await value("Mesh vertices")).replaceAll(",", "")),
    triangles,
    boundaryEdges: Number((await value("Boundary edges")).replaceAll(",", "")),
    nonManifoldEdges: Number(
      (await value("Non-manifold edges")).replaceAll(",", ""),
    ),
  };
  console.log(`QUALITY_REPORT ${JSON.stringify(report)}`);
  expect(triangles).toBeGreaterThanOrEqual(minimumTriangles);
  expect(errors).toEqual([]);
  if (process.env.QUALITY_SCREENSHOT)
    await page.screenshot({
      path: process.env.QUALITY_SCREENSHOT,
      fullPage: true,
    });
});

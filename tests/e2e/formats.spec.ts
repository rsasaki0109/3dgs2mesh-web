import { expect, test } from "@playwright/test";

function syntheticSplat() {
  const count = 96;
  const bytes = new Uint8Array(count * 32);
  const view = new DataView(bytes.buffer);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = golden * i;
    const offset = i * 32;
    view.setFloat32(offset, radius * Math.cos(angle), true);
    view.setFloat32(offset + 4, y, true);
    view.setFloat32(offset + 8, radius * Math.sin(angle), true);
    view.setFloat32(offset + 12, 0.24, true);
    view.setFloat32(offset + 16, 0.16, true);
    view.setFloat32(offset + 20, 0.2, true);
    bytes.set(
      [
        Math.round(120 + 100 * (i / count)),
        Math.round(190 - 80 * (i / count)),
        240,
        245,
      ],
      offset + 24,
    );
    bytes.set([255, 128, 128, 128], offset + 28);
  }
  return bytes;
}

test("SPLAT input decodes and converts through the shared pipeline", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Choose a 3DGS file").setInputFiles({
    name: "synthetic.splat",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(syntheticSplat()),
  });
  await expect(page.getByText(/96 source Gaussians/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".file-type")).toHaveText("SPLAT");
  await page.getByRole("button", { name: /Fast/ }).click();
  await page.getByRole("button", { name: /Convert to mesh/ }).click();
  await expect(page.getByTestId("ready-state")).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.getByRole("button", { name: /Download GLB/ }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

const realPackedInput = process.env.REAL_SPLAT_INPUT;
test("an opt-in real packed asset decodes locally", async ({ page }) => {
  test.skip(
    !realPackedInput,
    "Set REAL_SPLAT_INPUT to a local SPZ/KSPLAT/SOG file",
  );
  if (!realPackedInput) return;
  await page.goto("/");
  await page.getByLabel("Choose a 3DGS file").setInputFiles(realPackedInput);
  await expect(page.getByText(/source Gaussians/)).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator(".file-type")).not.toHaveText("3DGS");
  await expect(
    page.getByRole("button", { name: /Convert to mesh/ }),
  ).toBeEnabled();
});

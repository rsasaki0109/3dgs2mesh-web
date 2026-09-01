# Real-data quality validation

The opt-in Playwright harness measures a maintainer-owned local asset without committing or uploading it:

```powershell
$env:QUALITY_INPUT = "C:\data\object.ply"
$env:QUALITY_MIN_TRIANGLES = "100"
$env:QUALITY_SCREENSHOT = "C:\temp\object-quality.png" # optional
npm run test:quality
npm run test:quality:compare # raw density versus narrow-band signed distance
```

The harness loads the file through the same browser input, worker decoder, density pipeline, repair stages, and viewer used by the public app. It enables a conservative repair configuration, waits for Ready, asserts a configurable minimum triangle count, and prints one `QUALITY_REPORT` JSON line containing vertex, triangle, boundary-edge, and non-manifold-edge counts.

The comparison command converts the same local asset twice and emits a `QUALITY_COMPARISON` JSON record with density and signed-distance topology counts. It is diagnostic evidence, not a promise that signed-distance stabilization improves every scene.

Recommended validation set:

- three object-centric captures with different scale distributions;
- three cropped indoor scenes;
- three outdoor or unbounded scenes;
- at least one PLY, SPZ v3, SOG, SPLAT, and KSPLAT input where legally shareable fixtures are available.

Record the source license and provenance separately. Do not commit private or restricted assets. Compare repair off/on and resident/slab modes at the same resolution and iso. A lower boundary-edge count is useful evidence, but it does not prove geometric accuracy, manifoldness, or watertightness.

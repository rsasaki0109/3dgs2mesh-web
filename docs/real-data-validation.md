# Real-data validation

The automated test suite uses deterministic generated PLY and SPLAT samples. Maintainers can also run opt-in checks against local real assets; no fixture is copied into this repository.

```bash
cargo run --release -p mesh-core --example inspect_real -- point_cloud.ply 48 crop
cargo run --release -p mesh-core --example inspect_real -- point_cloud.ply 48 anisotropic
cargo run --release -p mesh-core --example inspect_real -- point_cloud.ply 32 all
```

The full browser/Worker/export state path is also available as an opt-in Playwright test:

```bash
REAL_PLY=/absolute/path/to/point_cloud.ply npm run test:e2e
```

On PowerShell, use `$env:REAL_PLY = 'C:\\absolute\\path\\point_cloud.ply'` before running `npm run test:e2e`.

For a real packed asset, set `REAL_SPLAT_INPUT` to an `.spz`, `.ksplat`, or packaged `.sog`/`.zip` file. This opt-in browser check verifies local decoding and leaves the fixture outside the repository:

```bash
REAL_SPLAT_INPUT=/absolute/path/to/asset.spz npm run test:e2e -- formats.spec.ts
```

The final argument selects all retained Gaussians, a center-quantile crop, or the most anisotropic five percent. The command emits one JSON line containing counts, scale-ratio quantiles, grid and density statistics, selected iso value, mesh counts, and measured stage times. Timings are diagnostics for the current machine, not project benchmarks.

## September 2026 validation

Two unmodified `binary_little_endian` Graphdeco-style PLY files were exercised locally and were not committed:

- NVIDIA's Flowers sample archive (`flowers_1.zip`, SHA-256 `14f6d35db3ef024de68b01aabb71006004f5175468e70c9cc44092777d8461ec`) from the [NVIDIA Vulkan Gaussian Splatting sample documentation](https://github.com/nvpro-samples/vk_gaussian_splatting/blob/main/docs/splat_data.md). Its included license page identifies the sample as CC BY 4.0.
- The public Camenduru training point cloud (`point_cloud.ply`, SHA-256 `f03e4979ac27345da1422d960d604b98db9541bdb3586d135d64bb4d9bde8eb3`) from [Hugging Face](https://huggingface.co/camenduru/gaussian-splatting/blob/main/train/point_cloud/iteration_30000/point_cloud.ply). This file was used only as a local large-input interoperability check; users must verify upstream terms before downloading or redistributing it.

| Case | File size | Source Gaussians | Resolution | Selected iso | Output vertices | Output triangles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Flowers center crop | 139,619,083 B | 562,974 | 48 | 0.025640935 | 9,454 | 19,212 |
| Flowers anisotropic subset | 139,619,083 B | 562,974 | 48 | 0.007507149 | 14 | 24 |
| Large point cloud, all retained | 265,724,108 B | 1,071,462 | 32 | 0.058914445 | 204 | 404 |

The first case exposed a sparse-histogram edge case where automatic iso selection returned the lower edge of the first bin (`0`). The algorithm now uses the selected bin midpoint, with matching Rust and TypeScript regression tests. These results establish parser and pipeline interoperability only; they do not measure reconstruction accuracy.

The complete Flowers scene also converted at resolution 64 to 46,872 vertices and 95,164 triangles. Its mesh extraction and cleanup took substantially longer than the cropped diagnostics on the validation machine. Consequently, inputs of at least 100 MiB or 500,000 source Gaussians now select Fast automatically; smaller inputs retain Balanced as the default. This is a conservative UX guard, not a performance guarantee.

# Changelog

## [0.3.0] - 2026-09-02

- Make the six-tetrahedra cases explicit, preserve valid micro-triangles, orient faces from density gradients, and treat the global volume boundary as strictly outside the selected iso. Closed synthetic density and signed-distance fixtures now regress to zero boundary, non-manifold, and degenerate elements.
- Add optional narrow-band signed-distance stabilization derived from repaired occupancy, with matching TypeScript, Rust/WASM, and halo-aware low-memory slab paths.
- Cull empty spatial tiles before CPU density evaluation and return immediately for empty tiles in the WebGPU shader.
- Add an in-app mesh-health summary and an opt-in raw-density versus signed-distance browser comparison report.

## [0.2.0] - 2026-09-01

- Add conservative density denoise, outside flood fill, small boundary-loop caps, and quadric-error-guided mesh reduction.
- Add bounded-memory Z-slab density statistics and extraction with deterministic seam welding.
- Add reproducible local WebGPU benchmark JSON, adapter reporting, a community GPU issue template, and reviewed-result summarization.
- Add an opt-in real-asset quality harness and expose repair, topology, and peak-density statistics in the UI.

## [0.1.1] - 2026-09-01

- Decode each source once in the conversion worker and return only a bounded preview sample to the UI.
- Chunk WebGPU density dispatches, report compute/readback timings, detect device loss, and validate deterministic GPU samples against CPU density values.
- Add a normalized visual crop box, deterministic vertex-clustering decimation, cleanup/decimation before-and-after counts, and mesh topology diagnostics.
- Add generated SPZ v3/SOG and real KSPLAT compatibility fixtures plus Chromium, Firefox, and WebKit smoke coverage.

## [0.1.0] - 2026-09-01

- Initial Apache-2.0 browser-local 3DGS to approximate density-field mesh converter.
- Added PLY, SPZ, SPLAT, KSPLAT, and packaged SOG input. PLY parsing is independently implemented; packed formats are decoded locally through Spark.
- Added an optional tiled WebGPU density backend with automatic CPU/WASM fallback.
- Added Gaussian activation, spatial bins, Marching Tetrahedra, cleanup, static DC colors, GLB/binary PLY/OBJ export, and Three.js viewer.
- Added Rust core/WASM binding, worker cancellation, deterministic synthetic sample, Vitest/Rust coverage, Playwright smoke test, CI, and GitHub Pages deployment.

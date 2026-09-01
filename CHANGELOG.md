# Changelog

## [0.1.0] - 2026-09-01

- Initial Apache-2.0 browser-local 3DGS to approximate density-field mesh converter.
- Added PLY, SPZ, SPLAT, KSPLAT, and packaged SOG input. PLY parsing is independently implemented; packed formats are decoded locally through Spark.
- Added an optional tiled WebGPU density backend with automatic CPU/WASM fallback.
- Added Gaussian activation, spatial bins, Marching Tetrahedra, cleanup, static DC colors, GLB/binary PLY/OBJ export, and Three.js viewer.
- Added Rust core/WASM binding, worker cancellation, deterministic synthetic sample, Vitest/Rust coverage, Playwright smoke test, CI, and GitHub Pages deployment.

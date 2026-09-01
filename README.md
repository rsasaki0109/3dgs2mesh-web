# 3DGS2Mesh Web

**Convert 3D Gaussian Splatting PLY files into editable meshes entirely in your browser. No upload, no CUDA.**

[Live Demo](https://rsasaki0109.github.io/3dgs2mesh-web/) · [Repository](https://github.com/rsasaki0109/3dgs2mesh-web)

![3DGS2Mesh Web conversion workspace](docs/screenshot.png)

3DGS2Mesh Web is a static, local-first OSS tool for small and medium object-centric 3D Gaussian Splatting assets. Drop a standard INRIA/Graphdeco PLY into the page, extract an approximate anisotropic density field, inspect the splat and mesh side by side, and download an editable GLB or binary PLY. Demo users need no installation; everything runs from GitHub Pages in the browser.

> This is an **approximate density-field reconstruction**, not an exact implementation of GS2Mesh, SuGaR, GOF, or FGGS-LiDAR. It does not promise research-grade geometric accuracy, manifoldness, or watertight output.

![3DGS2Mesh Web application](docs/screenshot.png)

## Why this exists

Research pipelines such as GS2Mesh render new stereo views and fuse learned depth, while GOF and related methods use training-time information. A single PLY in a static site cannot reproduce those methods faithfully. This project makes the practical, honest subset useful: deterministic anisotropic Gaussian density evaluation, spatial binning, Marching Tetrahedra, cleanup, and local export—with a polished viewer and no server.

## Features

- ASCII and binary little-endian standard 3DGS PLY parsing with arbitrary scalar property order.
- Independent Rust geometry core compiled to WebAssembly and executed in a dedicated module worker.
- CPU density field with oriented Gaussian support AABBs and deterministic 8×8×8 voxel tiles.
- Fast, Balanced, and Detailed presets, memory estimates, progress, cancellation, and actionable validation errors.
- Marching Tetrahedra extraction, finite-difference normals, static SH-DC vertex colors, component cleanup, and conservative Taubin smoothing.
- Three.js viewer with Original Splat, Generated Mesh, and Split comparison modes; grid, axes, wireframe, shading, colors, background, fit, and camera reset controls.
- Local GLB, binary PLY, and OBJ downloads. No analytics, account, backend, or network upload.

## Privacy

The selected file is read by the browser and passed to a dedicated worker. It is never uploaded. Download URLs are created locally and revoked after use. The optional Spark preview receives the same local object URL; if it cannot initialize, a lightweight point preview is used and conversion continues.

## Supported input

Required scalar properties are `x y z opacity scale_0 scale_1 scale_2 rot_0 rot_1 rot_2 rot_3`. Optional `f_dc_0`, `f_dc_1`, and `f_dc_2` provide approximate static color. Unknown normals, higher-order `f_rest_*`, and metadata are ignored. ASCII and `binary_little_endian` are supported; `binary_big_endian` and list properties inside `vertex` are rejected clearly.

Raw Graphdeco-style values are activated as `exp(scale)`, `sigmoid(opacity)`, and normalized `(w,x,y,z)` quaternion. Color uses `clamp(0.5 + 0.28209479177387814 * f_dc, 0, 1)`. Higher-order spherical harmonics and view-dependent appearance are intentionally not preserved.

## Quick start

Prerequisites: current stable Node.js, current stable Rust, the `wasm32-unknown-unknown` target, and `wasm-pack`. Python is not required.

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run build       # wasm-pack (when available), typecheck, and Vite build
npm run test        # Vitest unit tests
npm run test:e2e    # Playwright smoke test
npm run lint        # Biome formatting/lint checks
npm run typecheck
npm run check       # frontend checks plus Rust checks
```

The development and production builds both compile and use the Rust/WASM core. Install the target with `rustup target add wasm32-unknown-unknown` and install `wasm-pack` before running the root commands.

## How the algorithm works

See [docs/algorithm.md](docs/algorithm.md) for equations. In short, the worker activates each Gaussian, rejects non-finite or weak splats, computes robust support bounds, bins support AABBs in a uniform grid, samples an anisotropic density field, selects a deterministic iso threshold, extracts a shared indexed surface with Marching Tetrahedra, then cleans and colors it.

## Parameter guide

Fast uses a longest grid dimension near 64, Balanced near 96, and Detailed near 160. Higher resolution increases memory roughly with the number of voxels, not linearly with the displayed number. Sigma radius controls support (default 3); opacity threshold removes weak splats; bounds quantile trims center outliers from automatic bounds; iso can be automatic or manual; component filtering and conservative smoothing are optional. Expert resolutions up to 256 can be expensive and may be rejected before allocation.

## Exports

GLB is indexed and includes normals, RGB vertex colors, and a vertex-color-aware material. Binary PLY includes positions, normals, RGB colors, and indexed faces. OBJ is included as a simple interoperability option and writes the common `v xyz rgb` convention.

## Known limitations

- This is a density-field approximation. It is not GS2Mesh, SuGaR, GOF, or FGGS-LiDAR and has no learned stereo/depth fusion.
- No camera/COLMAP loading, textures, texture baking, higher-order SH rendering, TSDF, denoising, outside flood fill, decimation, or guaranteed watertight/manifold topology.
- Thin geometry, transparent/reflective surfaces, weakly observed regions, extreme scales, and very large scenes may reconstruct poorly or require cropping.
- Only SH DC color is used, so view-dependent appearance is lost.
- The preview adapter uses [Spark](https://github.com/sparkjsdev/spark) when available and falls back to colored points if initialization fails.

## Browser support and performance

Use a recent Chromium, Firefox, or Safari with WebAssembly and WebGL2. Conversion runs in a dedicated single-threaded worker and does not require SharedArrayBuffer, COOP/COEP, CUDA, or GPU compute. Actual time and memory depend on Gaussian count, bounds, and device; the app reports measured stage timings and estimates grid memory without invented benchmarks.

## Architecture

React/TypeScript owns controls and state. A module Web Worker owns parsing, activation, indexing, voxelization, extraction, cleanup, and transferable mesh buffers. `crates/mesh-core` contains browser-independent Rust math and exporters; `crates/mesh-wasm` exposes a staged binding. Three.js owns the disposable viewer lifecycle, while exporter modules produce local Blob downloads. See [docs/architecture.md](docs/architecture.md).

## Roadmap

- **v0.2:** WebGPU density backend, faster/chunked conversion, SPZ/SOG/SPLAT/KSPLAT inputs.
- **v0.3:** occupancy denoising, outside flood fill, narrow-band TSDF, more consistently closed meshes, decimation.
- **v0.4:** camera-aware mode, COLMAP import, rendered depth fusion, optional texture baking, comparisons with GS2Mesh/GOF-style approaches.

## Related work and references

This independent project uses the standard 3DGS PLY convention described by [3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting). Conceptual references include [GS2Mesh](https://arxiv.org/abs/2404.01810), [Gaussian Opacity Fields](https://arxiv.org/abs/2404.10772), and [FGGS-LiDAR](https://arxiv.org/abs/2509.17390). The optional preview uses [Spark](https://github.com/sparkjsdev/spark); an adjacent browser prototype is [Web-3DGS-to-PC](https://github.com/tatsuya-ogawa/Web-3DGS-to-PC). These references informed interoperability and high-level ideas only. No incompatible Graphdeco or academic implementation source code is copied. 3DGS2Mesh Web is not affiliated with the authors or maintainers of any of these projects.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), keep changes deterministic, add Rust or Vitest coverage for algorithm changes, and run `npm run check` before opening a pull request. Please include a small reproducible PLY or synthetic test where relevant; never commit private assets.

Recommended GitHub topics: `3d-gaussian-splatting`, `gaussian-splatting`, `mesh-reconstruction`, `webassembly`, `rust`, `threejs`, `computer-vision`, `github-pages`.

## License

Code and original project documentation are Apache-2.0. Runtime dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This project is independent and is not affiliated with 3DGS, GS2Mesh, SuGaR, GOF, FGGS-LiDAR, Spark, or related projects.

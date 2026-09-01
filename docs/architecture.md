# Architecture

```text
React UI ── worker client ── module Worker
  │                             │
  ├─ Three.js/Spark viewer      ├─ PLY parser or Spark packed decoder
  └─ local exporters            ├─ tiled WebGPU density → TS meshing
                                └─ Rust/WASM density + meshing
```

The React application keeps the source `ArrayBuffer` locally for preview and retry, while a persistent `conversion.worker.ts` decodes one transferable copy exactly once. The worker returns only metadata and a deterministic preview sample capped at 50,000 points, retains activated Gaussians for parameter changes, and retains the density field so manual iso changes rerun only extraction. Cancellation terminates the worker; a later conversion reloads the preserved UI copy.

## Input normalization

Graphdeco-style PLY is validated and activated by the project's independent parser. SPZ, SPLAT, KSPLAT, and packaged SOG are decoded locally by the MIT-licensed Spark `PackedSplats` API. Both routes produce the same compact activated Gaussian representation: center, positive scale, rotation matrix, opacity, and static base color. The Rust binding accepts either original PLY bytes or a packed activated buffer, so packed inputs do not need to be converted to an intermediate PLY.

## Density backends

The default `auto` backend first requests a WebGPU adapter. TypeScript builds deterministic 8×8×8 tile candidate lists and uploads flattened candidates and activated Gaussians. Density is dispatched and read back in chunks of at most 1,048,576 voxels, while the final Float32 field remains available for iso re-extraction. Thirty-two deterministic grid samples are recomputed with the CPU equation; excessive absolute and relative error rejects the GPU result. Marching Tetrahedra, coloring, cleanup, decimation, diagnostics, and export remain on the CPU.

If WebGPU is missing, no adapter can be acquired, a buffer/dispatch limit is exceeded, the device is lost, validation fails, or setup fails, `auto` reports a warning and uses the single-threaded Rust/WASM session. The `webgpu` setting makes those failures actionable instead of falling back. Neither route needs WebAssembly threads, SharedArrayBuffer, COOP/COEP, CUDA, or a server.

`src/conversion` contains input normalization, activation math, the deterministic spatial index, the WebGPU backend, TypeScript field/meshing support, and state helpers. `crates/mesh-core` contains browser-independent Rust math and exporters; `crates/mesh-wasm` provides a staged `ConversionSession` with PLY and activated-Gaussian constructors.

## Viewer, export, and deployment

`SceneViewer` owns a single Three.js renderer, camera, controls, lights, grid, axes, crop `Box3Helper`, and object groups. New geometries and materials are disposed before replacement; controls, helpers, resize observers, animation frames, renderer, and Spark resources are disposed on replacement or unmount. Spark preview failure falls back to the bounded colored point sample without blocking conversion.

The GLB exporter uses Three.js's bundled `GLTFExporter`; PLY and OBJ are small independent local serializers. Downloads use short-lived Blob URLs. Vite uses `/` locally and derives `/3dgs2mesh-web/` from `GITHUB_REPOSITORY` in GitHub Actions. The Pages workflow builds release WASM and Vite, uploads `dist`, and deploys through the official Pages actions.

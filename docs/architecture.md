# Architecture

```text
React UI ── worker client ── module Worker
  │                             │
  ├─ Three.js/Spark adapter      ├─ PLY validation and progress bridge
  └─ exporters                   └─ Rust core → optional mesh-wasm package
```

The React application keeps the source `ArrayBuffer` locally, displays staged progress, and sends a transferable copy to `conversion.worker.ts`. The worker retains a session after voxelization, so changing a manual iso threshold can rerun extraction and cleanup without reparsing or resampling the field. Cancellation terminates and recreates the worker.

`src/conversion` contains the parser, activation math, deterministic spatial index, field, Marching Tetrahedra, cleanup, and state helpers. The worker boundary is intentionally message-based and never assumes SharedArrayBuffer. `crates/mesh-core` mirrors the documented math without browser dependencies; `crates/mesh-wasm` provides a staged `ConversionSession` for release builds. The checked-in TypeScript implementation keeps local development and static hosting usable when wasm-pack is not installed.

`SceneViewer` owns a single Three.js renderer, camera, controls, lights, grid, axes, and object groups. New geometries/materials are disposed before replacement; controls, resize observers, animation frames, renderer, and Spark object URLs are disposed when the viewer is unmounted or replaced. `sparkAdapter.ts` is optional and failures fall back to colored Gaussian points.

The GLB exporter uses Three.js's bundled `GLTFExporter`; PLY and OBJ are small independent local serializers. All downloads use Blob URLs and revoke them after the click. Vite uses `/` locally and `/3dgs2mesh-web/` in GitHub Actions. The Pages workflow builds release WASM, builds Vite, uploads `dist`, and deploys through the official Pages actions.

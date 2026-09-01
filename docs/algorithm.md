# Density-field reconstruction

The v0.2 pipeline is deliberately an approximation designed for one local 3DGS asset. It accepts PLY, SPZ v3, SPLAT, KSPLAT, and packaged SOG; it does not use training cameras or source images.

## Input and activation

For Graphdeco-style PLY, position is `m = (x,y,z)`, activated scale is `s = exp(scale_0, scale_1, scale_2)`, opacity is `alpha = sigmoid(opacity)`, and `(w,x,y,z)` is normalized before conversion to a local-to-world rotation matrix `R`. DC color is `clamp(0.5 + C0 f_dc, 0, 1)` with `C0 = 0.28209479177387814`.

Spark decodes the quantized/packed formats directly to activated center, scale, quaternion, opacity, and base color. The quaternion is converted to the same matrix representation, after which every format shares the reconstruction pipeline. Higher-order spherical harmonics are not carried into the mesh.

## Anisotropic density

For sample `p`, transform into Gaussian-local coordinates:

```text
u = Rᵀ (p - m)
d² = (u₀/s₀)² + (u₁/s₁)² + (u₂/s₂)²
cᵢ(p) = alphaᵢ exp(-0.5 d²), if d² ≤ sigmaRadius², otherwise 0
density(p) = Σᵢ cᵢ(p)
```

Only activated splats above the opacity threshold are retained. Tiny activated scales are clamped to a positive epsilon.

## Bounds, grid, and spatial bins

Lower and upper center quantiles make automatic bounds robust to isolated outliers. Every retained Gaussian whose center is inside those quantiles expands the bounds by its conservative oriented support AABB:

```text
halfExtent = sigmaRadius * abs(R) * s
```

The result receives padding of at least one voxel. The grid preserves isotropic spacing by assigning the longest dimension the selected resolution and deriving the other dimensions. Gaussian support boxes are inserted into deterministic 8×8×8 voxel tiles. Each voxel only evaluates the sorted candidate list in its tile.

## WebGPU and CPU/WASM execution

Both density backends evaluate the same truncated anisotropic sum and store one Float32 value per voxel. The WebGPU route flattens tile offsets and candidate indices, uploads each Gaussian as aligned vectors, and dispatches chunks of at most 1,048,576 invocations. It checks storage-buffer and dispatch limits, watches device loss, and separates indexing, compute/copy, and mapping timings. After readback, 32 deterministic samples are evaluated through the CPU candidate lists and Gaussian equation. A result fails when both absolute and relative tolerances are exceeded. The CPU/WASM route performs the same tiled loop in Rust. Floating-point accumulation may still produce small backend differences.

## Iso threshold and surface

The field reports min, max, non-zero count, and a 32-bin histogram. Automatic iso is a deterministic non-zero density distribution threshold; manual mode uses the slider value. The surface stage splits every voxel cube into six consistently ordered tetrahedra. Each sign-changing tetrahedral edge is linearly interpolated and globally deduplicated by its pair of lattice vertex indices. Indexed triangles with zero area are skipped.

## Bounded-memory slab mode

The global bounds and 8³ candidate bins remain deterministic, but density is evaluated in Z slabs. A first pass finds the exact scalar range and non-zero count; a second pass builds the exact 32-bin histogram; after automatic iso selection, a final pass evaluates overlapping slab boundary layers and extracts each unique cube range. Boundary vertices are merged by a spacing-relative position key and normals are recomputed. Only one density slab is intended to be live at a time. Iso changes repeat these passes. Activated Gaussians and the final mesh still remain resident, so this is bounded-density processing rather than fully streamed input decoding.

## Occupancy and mesh repair

Optional denoise classifies samples at the selected iso and applies a conservative six-neighbour rule: isolated occupied samples with at most one occupied neighbour are removed, while empty samples with at least five occupied neighbours are filled. Outside flood fill starts from every empty boundary voxel; empty samples unreachable from the boundary are classified as enclosed and raised just above iso. This volume-wide operation is disabled in slab mode. Small, simple, unbranched mesh boundary loops can be capped by a color-averaged center fan. These operations improve common defects but do not prove watertightness or manifoldness.

## Normals and colors

Central finite differences estimate the density gradient. Since density grows toward the interior, the nominal outward direction is `-∇density`; the mesh falls back to accumulated face normals when the gradient is too small. At an extracted vertex, nearby binned Gaussians weight their static colors by the same local density contribution. Neutral gray is used when no meaningful contributor exists.

## Cleanup and limits

Triangle connectivity is computed through shared vertices. By default only the largest component remains; a minimum component face count is also available. Taubin's alternating positive/negative neighborhood passes provide conservative smoothing. Optional deterministic vertex clustering remains available. The default reducer accumulates face-plane quadrics, ranks mesh edges by quadric error, deterministically merges edge-connected clusters, removes duplicate/degenerate triangles and unreferenced vertices, then recomputes normals. It is a browser-oriented quadric-error-guided reducer, not a claim of topology-preserving remeshing. The UI reports before/after cleanup and decimation counts plus boundary edges, non-manifold edges, degenerate faces, and connected components.

This does not guarantee manifold or watertight geometry. Packed formats may introduce quantization error. Learned stereo depth, opacity fields from training views, TSDF fusion, textures, higher-order SH, and view-dependent appearance remain out of scope for v0.2.

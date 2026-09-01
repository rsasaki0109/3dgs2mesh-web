import type {
  ConversionParams,
  DensityStats,
  Gaussian,
  GridField,
  MeshData,
  SpatialIndex,
  Vec3,
} from "../types/model";
import {
  buildSpatialIndex,
  estimateGrid,
  extractMarchingTetrahedra,
  gaussianDensity,
  recomputeNormals,
  tileCandidates,
} from "./engine";
import { automaticIso } from "./iso";
import { processDensityField } from "./quality";

export interface StreamingContext {
  gaussians: Gaussian[];
  dims: [number, number, number];
  min: Vec3;
  max: Vec3;
  spacing: number;
  index: SpatialIndex;
  stats: DensityStats;
  automaticIso: number;
  slabDepth: number;
  peakDensityBytes: number;
}

type Progress = (percent: number, detail: string) => void;

function densitySlab(context: DensityContext, zStart: number, layers: number) {
  const [nx, ny] = context.dims;
  const density = new Float32Array(nx * ny * layers);
  for (let localZ = 0; localZ < layers; localZ += 1) {
    const z = zStart + localZ;
    for (let y = 0; y < ny; y += 1)
      for (let x = 0; x < nx; x += 1) {
        const p: Vec3 = [
          context.min[0] + x * context.spacing,
          context.min[1] + y * context.spacing,
          context.min[2] + z * context.spacing,
        ];
        let value = 0;
        for (const candidate of tileCandidates(context.index, x, y, z))
          value += gaussianDensity(
            context.gaussians[candidate],
            p,
            context.paramsSigmaRadius,
          );
        density[(localZ * ny + y) * nx + x] = value;
      }
  }
  return density;
}

type DensityContext = Omit<
  StreamingContext,
  "stats" | "automaticIso" | "peakDensityBytes"
> & { paramsSigmaRadius: number };

function createDensitySlab(
  context: DensityContext,
  zStart: number,
  layers: number,
) {
  return densitySlab(context, zStart, layers);
}

export function prepareStreamingContext(
  gaussians: Gaussian[],
  params: ConversionParams,
  onProgress?: Progress,
): StreamingContext {
  const estimate = estimateGrid(gaussians, params);
  onProgress?.(0.02, "Building global spatial bins");
  const index = buildSpatialIndex(
    gaussians,
    estimate.bounds,
    estimate.spacing,
    estimate.dims,
    params.sigmaRadius,
  );
  const slabDepth = Math.max(8, Math.min(64, Math.round(params.slabDepth)));
  const base: DensityContext = {
    gaussians,
    dims: estimate.dims,
    min: estimate.bounds.min,
    max: estimate.bounds.max,
    spacing: estimate.spacing,
    index,
    slabDepth,
    paramsSigmaRadius: params.sigmaRadius,
  };
  let min = Infinity;
  let max = 0;
  let nonZero = 0;
  const [, , nz] = estimate.dims;
  const slabs = Math.ceil(nz / slabDepth);
  let peakDensityBytes = 0;
  for (let slab = 0; slab < slabs; slab += 1) {
    const zStart = slab * slabDepth;
    const layers = Math.min(slabDepth, nz - zStart);
    const density = createDensitySlab(base, zStart, layers);
    peakDensityBytes = Math.max(peakDensityBytes, density.byteLength);
    for (const value of density) {
      min = Math.min(min, value);
      max = Math.max(max, value);
      if (value > 0) nonZero += 1;
    }
    onProgress?.(
      0.05 + ((slab + 1) / slabs) * 0.42,
      `Low-memory stats pass ${slab + 1}/${slabs}`,
    );
  }
  if (!Number.isFinite(min)) min = 0;
  const histogram = Array.from({ length: 32 }, () => 0);
  const range = Math.max(1e-6, max - min);
  for (let slab = 0; slab < slabs; slab += 1) {
    const zStart = slab * slabDepth;
    const layers = Math.min(slabDepth, nz - zStart);
    const density = createDensitySlab(base, zStart, layers);
    for (const value of density)
      if (value > 0) {
        const bin = Math.max(
          0,
          Math.min(31, Math.floor(((value - min) / range) * 31)),
        );
        histogram[bin] += 1;
      }
    onProgress?.(
      0.47 + ((slab + 1) / slabs) * 0.48,
      `Low-memory histogram pass ${slab + 1}/${slabs}`,
    );
  }
  const stats = { min, max, nonZero, histogram };
  onProgress?.(1, "Low-memory density statistics ready");
  return {
    gaussians,
    dims: estimate.dims,
    min: estimate.bounds.min,
    max: estimate.bounds.max,
    spacing: estimate.spacing,
    index,
    stats,
    automaticIso: automaticIso(stats),
    slabDepth,
    peakDensityBytes,
  };
}

function mergeSlabMeshes(meshes: MeshData[], tolerance: number): MeshData {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const vertices = new Map<string, number>();
  const faces = new Set<string>();
  for (const mesh of meshes) {
    const remap = new Uint32Array(mesh.positions.length / 3);
    for (let vertex = 0; vertex < remap.length; vertex += 1) {
      const offset = vertex * 3;
      const key = [0, 1, 2]
        .map((axis) => Math.round(mesh.positions[offset + axis] / tolerance))
        .join(":");
      let mapped = vertices.get(key);
      if (mapped === undefined) {
        mapped = positions.length / 3;
        vertices.set(key, mapped);
        positions.push(
          mesh.positions[offset],
          mesh.positions[offset + 1],
          mesh.positions[offset + 2],
        );
        colors.push(
          mesh.colors[offset],
          mesh.colors[offset + 1],
          mesh.colors[offset + 2],
        );
      }
      remap[vertex] = mapped;
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = remap[mesh.indices[i]];
      const b = remap[mesh.indices[i + 1]];
      const c = remap[mesh.indices[i + 2]];
      if (a === b || b === c || c === a) continue;
      const key = [a, b, c].sort((left, right) => left - right).join(":");
      if (faces.has(key)) continue;
      faces.add(key);
      indices.push(a, b, c);
    }
  }
  const mesh: MeshData = {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
  };
  recomputeNormals(mesh);
  return mesh;
}

export function extractStreamingMesh(
  context: StreamingContext,
  params: ConversionParams,
  iso: number,
  onProgress?: Progress,
) {
  const [nx, ny, nz] = context.dims;
  const cubeLayers = nz - 1;
  const slabs = Math.ceil(cubeLayers / context.slabDepth);
  const meshes: MeshData[] = [];
  let denoisedVoxels = 0;
  let peakDensityBytes = context.peakDensityBytes;
  const densityContext: DensityContext = {
    ...context,
    paramsSigmaRadius: params.sigmaRadius,
  };
  for (let slab = 0; slab < slabs; slab += 1) {
    const zStart = slab * context.slabDepth;
    const cubes = Math.min(context.slabDepth, cubeLayers - zStart);
    const haloStart = Math.max(0, zStart - 1);
    const haloEnd = Math.min(nz - 1, zStart + cubes + 1);
    const layers = haloEnd - haloStart + 1;
    const density = createDensitySlab(densityContext, haloStart, layers);
    peakDensityBytes = Math.max(peakDensityBytes, density.byteLength);
    const field: GridField = {
      dims: [nx, ny, layers],
      min: [
        context.min[0],
        context.min[1],
        context.min[2] + haloStart * context.spacing,
      ],
      max: [
        context.max[0],
        context.max[1],
        context.min[2] + haloEnd * context.spacing,
      ],
      spacing: context.spacing,
      density,
      stats: context.stats,
      index: context.index,
      gridOffset: [0, 0, haloStart],
    };
    const processed = processDensityField(
      field,
      iso,
      params.densityDenoiseIterations,
      false,
    );
    denoisedVoxels += processed.denoisedVoxels;
    meshes.push(
      extractMarchingTetrahedra(
        processed.field,
        context.gaussians,
        iso,
        params.sigmaRadius,
        {},
        {
          start: zStart - haloStart,
          end: zStart + cubes - haloStart,
        },
      ),
    );
    onProgress?.(
      (slab + 1) / slabs,
      `Extracting low-memory slab ${slab + 1}/${slabs}`,
    );
  }
  return {
    mesh: mergeSlabMeshes(meshes, Math.max(1e-7, context.spacing * 1e-5)),
    denoisedVoxels,
    enclosedVoxelsFilled: 0,
    peakDensityBytes,
  };
}

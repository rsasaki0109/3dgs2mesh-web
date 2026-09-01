import type {
  ConversionParams,
  DensityStats,
  Gaussian,
  GridField,
  MeshData,
  ParsedPly,
  SpatialIndex,
  Vec3,
} from "../types/model";
import { automaticIso } from "./iso";
import { parsePly } from "./ply";

const EPSILON = 1e-6;
const TILE_EDGE = 8;

export class ConversionCancelled extends Error {
  constructor() {
    super("Conversion cancelled");
    this.name = "ConversionCancelled";
  }
}

export interface EngineCallbacks {
  onStage?: (stage: string, percent: number, detail?: string) => void;
  shouldCancel?: () => boolean;
}

function checkCancelled(callbacks: EngineCallbacks) {
  if (callbacks.shouldCancel?.()) throw new ConversionCancelled();
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function mul(a: Vec3, scalar: number): Vec3 {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}
function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function normalize(a: Vec3): Vec3 {
  const n = Math.sqrt(dot(a, a));
  return Number.isFinite(n) && n > EPSILON ? mul(a, 1 / n) : [0, 0, 1];
}
export function supportHalfExtent(g: Gaussian, sigmaRadius: number): Vec3 {
  const r = g.rotation;
  return [
    sigmaRadius *
      (Math.abs(r[0]) * g.scale[0] +
        Math.abs(r[1]) * g.scale[1] +
        Math.abs(r[2]) * g.scale[2]),
    sigmaRadius *
      (Math.abs(r[3]) * g.scale[0] +
        Math.abs(r[4]) * g.scale[1] +
        Math.abs(r[5]) * g.scale[2]),
    sigmaRadius *
      (Math.abs(r[6]) * g.scale[0] +
        Math.abs(r[7]) * g.scale[1] +
        Math.abs(r[8]) * g.scale[2]),
  ];
}

function quantile(values: number[], q: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return (
    sorted[Math.round((sorted.length - 1) * Math.max(0, Math.min(1, q)))] ?? 0
  );
}

export function robustBounds(
  gaussians: Gaussian[],
  sigmaRadius: number,
  q: number,
): { min: Vec3; max: Vec3 } {
  const minCenter: Vec3 = [
    quantile(
      gaussians.map((g) => g.mean[0]),
      q,
    ),
    quantile(
      gaussians.map((g) => g.mean[1]),
      q,
    ),
    quantile(
      gaussians.map((g) => g.mean[2]),
      q,
    ),
  ];
  const maxCenter: Vec3 = [
    quantile(
      gaussians.map((g) => g.mean[0]),
      1 - q,
    ),
    quantile(
      gaussians.map((g) => g.mean[1]),
      1 - q,
    ),
    quantile(
      gaussians.map((g) => g.mean[2]),
      1 - q,
    ),
  ];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const include = (p: Vec3) => {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  };
  for (const g of gaussians) {
    if (
      g.mean.every((value, i) => value >= minCenter[i] && value <= maxCenter[i])
    ) {
      const h = supportHalfExtent(g, sigmaRadius);
      include(sub(g.mean, h));
      include(add(g.mean, h));
    }
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite))
    for (const g of gaussians) {
      const h = supportHalfExtent(g, sigmaRadius);
      include(sub(g.mean, h));
      include(add(g.mean, h));
    }
  const extent = sub(max, min);
  const pad = extent.map((value) => Math.max(EPSILON, value * 0.01)) as Vec3;
  return { min: sub(min, pad), max: add(max, pad) };
}

export function estimateGrid(gaussians: Gaussian[], params: ConversionParams) {
  const bounds = robustBounds(
    gaussians,
    params.sigmaRadius,
    params.boundsQuantile,
  );
  const extent = sub(bounds.max, bounds.min);
  const longest = Math.max(...extent, EPSILON);
  const spacing = longest / Math.max(8, Math.min(256, params.resolution));
  const dims: [number, number, number] = extent.map((value) =>
    Math.min(512, Math.ceil(value / spacing) + 1),
  ) as [number, number, number];
  const voxels = dims[0] * dims[1] * dims[2];
  return {
    bounds,
    spacing,
    dims,
    voxels,
    bytes: voxels * Float32Array.BYTES_PER_ELEMENT,
  };
}

export function gaussianDensity(g: Gaussian, p: Vec3, sigmaRadius: number) {
  const d = sub(p, g.mean);
  const r = g.rotation;
  const u: Vec3 = [
    r[0] * d[0] + r[3] * d[1] + r[6] * d[2],
    r[1] * d[0] + r[4] * d[1] + r[7] * d[2],
    r[2] * d[0] + r[5] * d[1] + r[8] * d[2],
  ];
  const d2 =
    (u[0] / g.scale[0]) ** 2 +
    (u[1] / g.scale[1]) ** 2 +
    (u[2] / g.scale[2]) ** 2;
  return d2 <= sigmaRadius ** 2 ? g.opacity * Math.exp(-0.5 * d2) : 0;
}

export function buildSpatialIndex(
  gaussians: Gaussian[],
  bounds: { min: Vec3; max: Vec3 },
  spacing: number,
  dims: [number, number, number],
  sigmaRadius: number,
): SpatialIndex {
  const tileDims: [number, number, number] = [
    Math.ceil(dims[0] / TILE_EDGE),
    Math.ceil(dims[1] / TILE_EDGE),
    Math.ceil(dims[2] / TILE_EDGE),
  ];
  const buckets = Array.from(
    { length: tileDims[0] * tileDims[1] * tileDims[2] },
    () => [] as number[],
  );
  const tileId = (x: number, y: number, z: number) =>
    (z * tileDims[1] + y) * tileDims[0] + x;
  for (let index = 0; index < gaussians.length; index += 1) {
    const g = gaussians[index];
    const half = supportHalfExtent(g, sigmaRadius);
    const lo = sub(g.mean, half);
    const hi = add(g.mean, half);
    const toTile = (value: number, axis: number, ceil = false) =>
      Math.max(
        0,
        Math.min(
          tileDims[axis] - 1,
          Math.floor(
            ((value - bounds.min[axis]) / spacing + (ceil ? 0.999999 : 0)) /
              TILE_EDGE,
          ),
        ),
      );
    const low = [toTile(lo[0], 0), toTile(lo[1], 1), toTile(lo[2], 2)];
    const high = [
      toTile(hi[0], 0, true),
      toTile(hi[1], 1, true),
      toTile(hi[2], 2, true),
    ];
    for (let z = low[2]; z <= high[2]; z += 1)
      for (let y = low[1]; y <= high[1]; y += 1)
        for (let x = low[0]; x <= high[0]; x += 1)
          buckets[tileId(x, y, z)].push(index);
  }
  for (const bucket of buckets) {
    bucket.sort((a, b) => a - b);
    for (let i = bucket.length - 1; i > 0; i -= 1)
      if (bucket[i] === bucket[i - 1]) bucket.splice(i, 1);
  }
  return { tileEdge: TILE_EDGE, tileDims, buckets };
}

export function tileCandidates(
  index: SpatialIndex,
  x: number,
  y: number,
  z: number,
) {
  const tx = Math.min(index.tileDims[0] - 1, Math.floor(x / index.tileEdge));
  const ty = Math.min(index.tileDims[1] - 1, Math.floor(y / index.tileEdge));
  const tz = Math.min(index.tileDims[2] - 1, Math.floor(z / index.tileEdge));
  return (
    index.buckets[(tz * index.tileDims[1] + ty) * index.tileDims[0] + tx] ?? []
  );
}

export function densityStats(density: Float32Array): DensityStats {
  let min = Infinity;
  let max = 0;
  let nonZero = 0;
  for (const value of density) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (value > 0) nonZero += 1;
  }
  if (!Number.isFinite(min)) min = 0;
  const histogram = Array.from({ length: 32 }, () => 0);
  const range = Math.max(EPSILON, max - min);
  for (const value of density)
    if (value > 0)
      histogram[
        Math.max(0, Math.min(31, Math.floor(((value - min) / range) * 31)))
      ] += 1;
  return { min, max, nonZero, histogram };
}

export function voxelize(
  gaussians: Gaussian[],
  params: ConversionParams,
  callbacks: EngineCallbacks = {},
): GridField {
  const estimate = estimateGrid(gaussians, params);
  if (estimate.bytes > 640 * 1024 * 1024)
    throw new Error(
      `This grid would allocate ${formatMemory(estimate.bytes)}. Lower the resolution or crop the scene before converting.`,
    );
  callbacks.onStage?.("indexing", 0, "Building deterministic spatial bins");
  const index = buildSpatialIndex(
    gaussians,
    estimate.bounds,
    estimate.spacing,
    estimate.dims,
    params.sigmaRadius,
  );
  callbacks.onStage?.(
    "indexing",
    1,
    `${index.buckets.length.toLocaleString()} tiles`,
  );
  const density = new Float32Array(estimate.voxels);
  const [nx, ny, nz] = estimate.dims;
  for (let z = 0; z < nz; z += 1) {
    checkCancelled(callbacks);
    for (let y = 0; y < ny; y += 1)
      for (let x = 0; x < nx; x += 1) {
        const candidates = tileCandidates(index, x, y, z);
        if (!candidates.length) continue;
        const p: Vec3 = [
          estimate.bounds.min[0] + x * estimate.spacing,
          estimate.bounds.min[1] + y * estimate.spacing,
          estimate.bounds.min[2] + z * estimate.spacing,
        ];
        let value = 0;
        for (const candidate of candidates)
          value += gaussianDensity(gaussians[candidate], p, params.sigmaRadius);
        density[(z * ny + y) * nx + x] = value;
      }
    callbacks.onStage?.("voxelizing", (z + 1) / nz, `slice ${z + 1}/${nz}`);
  }
  return {
    dims: estimate.dims,
    min: estimate.bounds.min,
    max: estimate.bounds.max,
    spacing: estimate.spacing,
    density,
    stats: densityStats(density),
    index,
  };
}

function gridIndex(
  dims: [number, number, number],
  x: number,
  y: number,
  z: number,
) {
  return (z * dims[1] + y) * dims[0] + x;
}
function gridPosition(field: GridField, x: number, y: number, z: number): Vec3 {
  return [
    field.min[0] + x * field.spacing,
    field.min[1] + y * field.spacing,
    field.min[2] + z * field.spacing,
  ];
}
function fieldGradient(
  field: GridField,
  x: number,
  y: number,
  z: number,
): Vec3 {
  const [nx, ny, nz] = field.dims;
  const xm = Math.max(0, x - 1);
  const xp = Math.min(nx - 1, x + 1);
  const ym = Math.max(0, y - 1);
  const yp = Math.min(ny - 1, y + 1);
  const zm = Math.max(0, z - 1);
  const zp = Math.min(nz - 1, z + 1);
  return [
    (field.density[gridIndex(field.dims, xp, y, z)] -
      field.density[gridIndex(field.dims, xm, y, z)]) /
      (Math.max(1, xp - xm) * field.spacing),
    (field.density[gridIndex(field.dims, x, yp, z)] -
      field.density[gridIndex(field.dims, x, ym, z)]) /
      (Math.max(1, yp - ym) * field.spacing),
    (field.density[gridIndex(field.dims, x, y, zp)] -
      field.density[gridIndex(field.dims, x, y, zm)]) /
      (Math.max(1, zp - zm) * field.spacing),
  ];
}

function colorAt(
  field: GridField,
  gaussians: Gaussian[],
  p: Vec3,
  sigmaRadius: number,
) {
  const coord = [0, 1, 2].map(
    (axis) =>
      Math.max(0, Math.floor((p[axis] - field.min[axis]) / field.spacing)) +
      (field.gridOffset?.[axis] ?? 0),
  );
  const candidates = tileCandidates(field.index, coord[0], coord[1], coord[2]);
  let weight = 0;
  const color = [0, 0, 0];
  for (const i of candidates) {
    const contribution = gaussianDensity(gaussians[i], p, sigmaRadius);
    weight += contribution;
    color[0] += contribution * gaussians[i].color[0];
    color[1] += contribution * gaussians[i].color[1];
    color[2] += contribution * gaussians[i].color[2];
  }
  return weight > EPSILON
    ? (color.map((value) => value / weight) as [number, number, number])
    : [0.55, 0.58, 0.62];
}

export function extractMarchingTetrahedra(
  field: GridField,
  gaussians: Gaussian[],
  iso: number,
  sigmaRadius: number,
  callbacks: EngineCallbacks = {},
  zRange?: { start: number; end: number },
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const edgeVertices = new Map<string, number>();
  const offsets: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const tetrahedra = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ];
  const [nx, ny, nz] = field.dims;
  const zStart = Math.max(0, Math.min(nz - 1, zRange?.start ?? 0));
  const zEnd = Math.max(zStart, Math.min(nz - 1, zRange?.end ?? nz - 1));
  const emitTriangle = (a: number, b: number, c: number) => {
    if (a === b || b === c || c === a) return;
    const point = (vertex: number): Vec3 => [
      positions[vertex * 3],
      positions[vertex * 3 + 1],
      positions[vertex * 3 + 2],
    ];
    const normal = (vertex: number): Vec3 => [
      normals[vertex * 3],
      normals[vertex * 3 + 1],
      normals[vertex * 3 + 2],
    ];
    const faceNormal = cross(sub(point(b), point(a)), sub(point(c), point(a)));
    const expected = add(add(normal(a), normal(b)), normal(c));
    if (dot(faceNormal, expected) < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };
  const getEdgeVertex = (
    a: [number, number, number],
    b: [number, number, number],
    pa: Vec3,
    pb: Vec3,
    va: number,
    vb: number,
    ga: Vec3,
    gb: Vec3,
  ) => {
    const ia = gridIndex(field.dims, ...a);
    const ib = gridIndex(field.dims, ...b);
    const key = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
    const existing = edgeVertices.get(key);
    if (existing !== undefined) return existing;
    const t =
      Math.abs(vb - va) > EPSILON
        ? Math.max(0, Math.min(1, (iso - va) / (vb - va)))
        : 0.5;
    const p = add(pa, mul(sub(pb, pa), t));
    const normal = normalize(mul(add(ga, mul(sub(gb, ga), t)), -1));
    const color = colorAt(field, gaussians, p, sigmaRadius);
    const vertex = positions.length / 3;
    positions.push(...p);
    normals.push(...normal);
    colors.push(...color);
    edgeVertices.set(key, vertex);
    return vertex;
  };
  for (let z = zStart; z < zEnd; z += 1) {
    checkCancelled(callbacks);
    for (let y = 0; y < ny - 1; y += 1)
      for (let x = 0; x < nx - 1; x += 1) {
        const points = offsets.map(([dx, dy, dz]) =>
          gridPosition(field, x + dx, y + dy, z + dz),
        );
        const values = offsets.map(([dx, dy, dz]) => {
          const local = [x + dx, y + dy, z + dz] as Vec3;
          const global = local.map(
            (value, axis) => value + (field.gridOffset?.[axis] ?? 0),
          ) as Vec3;
          const globalDims = field.globalDims ?? field.dims;
          if (
            global.some(
              (value, axis) => value === 0 || value === globalDims[axis] - 1,
            )
          )
            return iso - Math.max(EPSILON, Math.abs(iso) * 1e-6);
          return field.density[gridIndex(field.dims, ...local)];
        });
        const gradients = offsets.map(([dx, dy, dz]) =>
          fieldGradient(field, x + dx, y + dy, z + dz),
        );
        for (const tetra of tetrahedra) {
          const inside = tetra.map((i) => values[i] >= iso);
          const count = inside.filter(Boolean).length;
          if (count === 0 || count === 4) continue;
          const insideVertices = tetra.filter((_, i) => inside[i]);
          const outsideVertices = tetra.filter((_, i) => !inside[i]);
          const crossingVertex = (a: number, b: number) =>
            getEdgeVertex(
              [x + offsets[a][0], y + offsets[a][1], z + offsets[a][2]],
              [x + offsets[b][0], y + offsets[b][1], z + offsets[b][2]],
              points[a],
              points[b],
              values[a],
              values[b],
              gradients[a],
              gradients[b],
            );
          if (count === 1 || count === 3) {
            const pivot = count === 1 ? insideVertices[0] : outsideVertices[0];
            const opposite = count === 1 ? outsideVertices : insideVertices;
            emitTriangle(
              crossingVertex(pivot, opposite[0]),
              crossingVertex(pivot, opposite[1]),
              crossingVertex(pivot, opposite[2]),
            );
          } else {
            const [i0, i1] = insideVertices;
            const [o0, o1] = outsideVertices;
            const v00 = crossingVertex(i0, o0);
            const v01 = crossingVertex(i0, o1);
            const v11 = crossingVertex(i1, o1);
            const v10 = crossingVertex(i1, o0);
            emitTriangle(v00, v01, v11);
            emitTriangle(v00, v11, v10);
          }
        }
      }
    callbacks.onStage?.(
      "extracting",
      (z - zStart + 1) / Math.max(1, zEnd - zStart),
    );
  }
  const mesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
  recomputeNormals(mesh);
  return mesh;
}

export function cleanupMesh(
  mesh: MeshData,
  keepLargest: boolean,
  minComponentFaces: number,
  smoothingIterations: number,
): MeshData {
  const faceCount = Math.floor(mesh.indices.length / 3);
  if (!faceCount) return mesh;
  const byVertex = Array.from(
    { length: mesh.positions.length / 3 },
    () => [] as number[],
  );
  for (let f = 0; f < faceCount; f += 1)
    for (let j = 0; j < 3; j += 1) byVertex[mesh.indices[f * 3 + j]].push(f);
  const adjacency = Array.from({ length: faceCount }, () => new Set<number>());
  for (const faces of byVertex)
    for (const a of faces)
      for (const b of faces) if (a !== b) adjacency[a].add(b);
  const component = Array.from({ length: faceCount }, () => -1);
  const sizes: number[] = [];
  for (let start = 0; start < faceCount; start += 1) {
    if (component[start] >= 0) continue;
    const stack = [start];
    component[start] = sizes.length;
    let size = 0;
    while (stack.length) {
      const face = stack.pop();
      if (face === undefined) continue;
      size += 1;
      for (const next of adjacency[face])
        if (component[next] < 0) {
          component[next] = component[start];
          stack.push(next);
        }
    }
    sizes.push(size);
  }
  const largest = sizes.reduce(
    (best, value, i) => (value > sizes[best] ? i : best),
    0,
  );
  const keepFace = Array.from(
    { length: faceCount },
    (_, face) =>
      sizes[component[face]] >= Math.max(1, minComponentFaces) &&
      (!keepLargest || component[face] === largest),
  );
  const used = new Set<number>();
  const keptIndices: number[] = [];
  for (let face = 0; face < faceCount; face += 1)
    if (keepFace[face])
      for (let j = 0; j < 3; j += 1) {
        const vertex = mesh.indices[face * 3 + j];
        used.add(vertex);
        keptIndices.push(vertex);
      }
  const ordered = [...used].sort((a, b) => a - b);
  const remap = new Map(ordered.map((old, i) => [old, i]));
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (const old of ordered) {
    positions.push(...mesh.positions.slice(old * 3, old * 3 + 3));
    normals.push(...mesh.normals.slice(old * 3, old * 3 + 3));
    colors.push(...mesh.colors.slice(old * 3, old * 3 + 3));
  }
  const indices: number[] = [];
  for (const old of keptIndices) {
    const mapped = remap.get(old);
    if (mapped !== undefined) indices.push(mapped);
  }
  const clean = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
  if (smoothingIterations > 0) {
    taubinSmooth(clean, Math.min(10, smoothingIterations));
    recomputeNormals(clean);
  }
  return clean;
}

export function taubinSmooth(mesh: MeshData, iterations: number) {
  const n = mesh.positions.length / 3;
  const neighbours = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < mesh.indices.length; i += 3)
    for (const a of [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]])
      for (const b of [
        mesh.indices[i],
        mesh.indices[i + 1],
        mesh.indices[i + 2],
      ])
        if (a !== b) neighbours[a].add(b);
  for (let iteration = 0; iteration < iterations; iteration += 1)
    for (const [factor, sign] of [
      [0.33, 1],
      [-0.34, -1],
    ] as const) {
      const next = mesh.positions.slice();
      for (let i = 0; i < n; i += 1) {
        if (!neighbours[i].size) continue;
        const average: Vec3 = [0, 0, 0];
        for (const neighbour of neighbours[i]) {
          average[0] += mesh.positions[neighbour * 3];
          average[1] += mesh.positions[neighbour * 3 + 1];
          average[2] += mesh.positions[neighbour * 3 + 2];
        }
        average[0] /= neighbours[i].size;
        average[1] /= neighbours[i].size;
        average[2] /= neighbours[i].size;
        const current: Vec3 = [
          mesh.positions[i * 3],
          mesh.positions[i * 3 + 1],
          mesh.positions[i * 3 + 2],
        ];
        const moved = add(current, mul(sub(average, current), factor * sign));
        next.set(moved, i * 3);
      }
      mesh.positions.set(next);
    }
}

export function recomputeNormals(mesh: MeshData) {
  mesh.normals.fill(0);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i] * 3;
    const ib = mesh.indices[i + 1] * 3;
    const ic = mesh.indices[i + 2] * 3;
    const a: Vec3 = [
      mesh.positions[ia],
      mesh.positions[ia + 1],
      mesh.positions[ia + 2],
    ];
    const b: Vec3 = [
      mesh.positions[ib],
      mesh.positions[ib + 1],
      mesh.positions[ib + 2],
    ];
    const c: Vec3 = [
      mesh.positions[ic],
      mesh.positions[ic + 1],
      mesh.positions[ic + 2],
    ];
    const normal = cross(sub(b, a), sub(c, a));
    for (const index of [ia, ib, ic]) {
      mesh.normals[index] += normal[0];
      mesh.normals[index + 1] += normal[1];
      mesh.normals[index + 2] += normal[2];
    }
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const normal = normalize([
      mesh.normals[i],
      mesh.normals[i + 1],
      mesh.normals[i + 2],
    ]);
    mesh.normals.set(normal, i);
  }
}

/** Deterministic vertex-clustering decimation for interactive export sizing. */
export function clusterDecimateMesh(mesh: MeshData, ratio: number): MeshData {
  const vertexCount = mesh.positions.length / 3;
  const target = Math.max(
    4,
    Math.floor(vertexCount * Math.max(0.05, Math.min(1, ratio))),
  );
  if (target >= vertexCount || mesh.indices.length < 6) return mesh;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.positions[i + axis]);
      max[axis] = Math.max(max[axis], mesh.positions[i + axis]);
    }
  const cells = Math.max(2, Math.ceil(Math.cbrt(target * 2)));
  const extent = sub(max, min).map((value) => Math.max(value, EPSILON)) as Vec3;
  const clusters = new Map<string, number>();
  const sums: number[][] = [];
  const remap = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const base = vertex * 3;
    const cell = [0, 1, 2].map((axis) =>
      Math.min(
        cells - 1,
        Math.floor(
          ((mesh.positions[base + axis] - min[axis]) / extent[axis]) * cells,
        ),
      ),
    );
    const key = cell.join(":");
    let cluster = clusters.get(key);
    if (cluster === undefined) {
      cluster = sums.length;
      clusters.set(key, cluster);
      sums.push([0, 0, 0, 0, 0, 0, 0]);
    }
    remap[vertex] = cluster;
    const sum = sums[cluster];
    sum[0] += mesh.positions[base];
    sum[1] += mesh.positions[base + 1];
    sum[2] += mesh.positions[base + 2];
    sum[3] += mesh.colors[base];
    sum[4] += mesh.colors[base + 1];
    sum[5] += mesh.colors[base + 2];
    sum[6] += 1;
  }
  const positions = new Float32Array(sums.length * 3);
  const colors = new Float32Array(sums.length * 3);
  for (let i = 0; i < sums.length; i += 1) {
    const count = sums[i][6];
    positions.set(
      sums[i].slice(0, 3).map((value) => value / count),
      i * 3,
    );
    colors.set(
      sums[i].slice(3, 6).map((value) => value / count),
      i * 3,
    );
  }
  const indices: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = remap[mesh.indices[i]];
    const b = remap[mesh.indices[i + 1]];
    const c = remap[mesh.indices[i + 2]];
    if (a === b || b === c || c === a) continue;
    const key = [a, b, c].sort((left, right) => left - right).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    indices.push(a, b, c);
  }
  const result: MeshData = {
    positions,
    colors,
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
  };
  recomputeNormals(result);
  const compact = cleanupMesh(result, false, 1, 0);
  recomputeNormals(compact);
  return compact;
}

type Quadric = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function quadricPosition(q: Quadric, a: Vec3, b: Vec3): Vec3 {
  const a00 = q[0];
  const a01 = q[1];
  const a02 = q[2];
  const a11 = q[4];
  const a12 = q[5];
  const a22 = q[7];
  const bx = -q[3];
  const by = -q[6];
  const bz = -q[8];
  const det =
    a00 * (a11 * a22 - a12 * a12) -
    a01 * (a01 * a22 - a12 * a02) +
    a02 * (a01 * a12 - a11 * a02);
  if (Math.abs(det) < 1e-12) return mul(add(a, b), 0.5);
  const x =
    (bx * (a11 * a22 - a12 * a12) -
      a01 * (by * a22 - a12 * bz) +
      a02 * (by * a12 - a11 * bz)) /
    det;
  const y =
    (a00 * (by * a22 - a12 * bz) -
      bx * (a01 * a22 - a12 * a02) +
      a02 * (a01 * bz - by * a02)) /
    det;
  const z =
    (a00 * (a11 * bz - by * a12) -
      a01 * (a01 * bz - by * a02) +
      bx * (a01 * a12 - a11 * a02)) /
    det;
  return [x, y, z].every(Number.isFinite) ? [x, y, z] : mul(add(a, b), 0.5);
}

function quadricCost(q: Quadric, p: Vec3) {
  const [x, y, z] = p;
  return (
    q[0] * x * x +
    2 * q[1] * x * y +
    2 * q[2] * x * z +
    2 * q[3] * x +
    q[4] * y * y +
    2 * q[5] * y * z +
    2 * q[6] * y +
    q[7] * z * z +
    2 * q[8] * z +
    q[9]
  );
}

/** Deterministic quadric-error-guided edge clustering. */
export function quadricDecimateMesh(mesh: MeshData, ratio: number): MeshData {
  const vertexCount = mesh.positions.length / 3;
  const target = Math.max(
    4,
    Math.floor(vertexCount * Math.max(0.05, Math.min(1, ratio))),
  );
  if (target >= vertexCount || mesh.indices.length < 6) return mesh;
  const quadrics = Array.from(
    { length: vertexCount },
    () => Array.from({ length: 10 }, () => 0) as Quadric,
  );
  const edges = new Map<string, [number, number]>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const vertices = [
      mesh.indices[i],
      mesh.indices[i + 1],
      mesh.indices[i + 2],
    ];
    const points = vertices.map((vertex): Vec3 => {
      const offset = vertex * 3;
      return [
        mesh.positions[offset],
        mesh.positions[offset + 1],
        mesh.positions[offset + 2],
      ];
    });
    const normal = normalize(
      cross(sub(points[1], points[0]), sub(points[2], points[0])),
    );
    if (dot(normal, normal) < EPSILON) continue;
    const d = -dot(normal, points[0]);
    const [x, y, z] = normal;
    const plane: Quadric = [
      x * x,
      x * y,
      x * z,
      x * d,
      y * y,
      y * z,
      y * d,
      z * z,
      z * d,
      d * d,
    ];
    for (const vertex of vertices)
      for (let q = 0; q < 10; q += 1) quadrics[vertex][q] += plane[q];
    for (const [a, b] of [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ] as [number, number][]) {
      const edge: [number, number] = a < b ? [a, b] : [b, a];
      edges.set(`${edge[0]}:${edge[1]}`, edge);
    }
  }
  const position = Array.from({ length: vertexCount }, (_, vertex): Vec3 => {
    const offset = vertex * 3;
    return [
      mesh.positions[offset],
      mesh.positions[offset + 1],
      mesh.positions[offset + 2],
    ];
  });
  const colors = Array.from({ length: vertexCount }, (_, vertex): Vec3 => {
    const offset = vertex * 3;
    return [
      mesh.colors[offset],
      mesh.colors[offset + 1],
      mesh.colors[offset + 2],
    ];
  });
  const candidates = [...edges.values()].map(([a, b]) => {
    const q = quadrics[a].map(
      (value, index) => value + quadrics[b][index],
    ) as Quadric;
    const p = quadricPosition(q, position[a], position[b]);
    return { a, b, cost: quadricCost(q, p) };
  });
  candidates.sort(
    (left, right) =>
      left.cost - right.cost || left.a - right.a || left.b - right.b,
  );
  const parent = Array.from({ length: vertexCount }, (_, index) => index);
  const weights = Array.from({ length: vertexCount }, () => 1);
  const find = (value: number): number => {
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]];
      value = parent[value];
    }
    return value;
  };
  let clusters = vertexCount;
  for (const candidate of candidates) {
    if (clusters <= target) break;
    let a = find(candidate.a);
    let b = find(candidate.b);
    if (a === b) continue;
    if (b < a) [a, b] = [b, a];
    const q = quadrics[a].map(
      (value, index) => value + quadrics[b][index],
    ) as Quadric;
    const p = quadricPosition(q, position[a], position[b]);
    const total = weights[a] + weights[b];
    colors[a] = [0, 1, 2].map(
      (axis) =>
        (colors[a][axis] * weights[a] + colors[b][axis] * weights[b]) / total,
    ) as Vec3;
    quadrics[a] = q;
    position[a] = p;
    weights[a] = total;
    parent[b] = a;
    clusters -= 1;
  }
  const rootToVertex = new Map<number, number>();
  const outPositions: number[] = [];
  const outColors: number[] = [];
  const remap = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const root = find(vertex);
    let mapped = rootToVertex.get(root);
    if (mapped === undefined) {
      mapped = rootToVertex.size;
      rootToVertex.set(root, mapped);
      outPositions.push(...position[root]);
      outColors.push(...colors[root]);
    }
    remap[vertex] = mapped;
  }
  const outIndices: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = remap[mesh.indices[i]];
    const b = remap[mesh.indices[i + 1]];
    const c = remap[mesh.indices[i + 2]];
    if (a === b || b === c || c === a) continue;
    const key = [a, b, c].sort((left, right) => left - right).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    outIndices.push(a, b, c);
  }
  const result: MeshData = {
    positions: new Float32Array(outPositions),
    colors: new Float32Array(outColors),
    normals: new Float32Array(outPositions.length),
    indices: new Uint32Array(outIndices),
  };
  recomputeNormals(result);
  return cleanupMesh(result, false, 1, 0);
}

export function decimateMesh(
  mesh: MeshData,
  ratio: number,
  method: "quadric" | "cluster" = "quadric",
) {
  return method === "quadric"
    ? quadricDecimateMesh(mesh, ratio)
    : clusterDecimateMesh(mesh, ratio);
}

export function analyzeMesh(mesh: MeshData) {
  const faceCount = mesh.indices.length / 3;
  const edgeFaces = new Map<string, number[]>();
  let degenerateFaces = 0;
  for (let face = 0; face < faceCount; face += 1) {
    const vertices = [
      mesh.indices[face * 3],
      mesh.indices[face * 3 + 1],
      mesh.indices[face * 3 + 2],
    ];
    const points = vertices.map((vertex): Vec3 => {
      const offset = vertex * 3;
      return [
        mesh.positions[offset],
        mesh.positions[offset + 1],
        mesh.positions[offset + 2],
      ];
    });
    const areaNormal = cross(
      sub(points[1], points[0]),
      sub(points[2], points[0]),
    );
    if (
      new Set(vertices).size < 3 ||
      dot(areaNormal, areaNormal) <= Number.EPSILON
    )
      degenerateFaces += 1;
    for (const [a, b] of [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const faces = edgeFaces.get(key) ?? [];
      faces.push(face);
      edgeFaces.set(key, faces);
    }
  }
  const parent = Array.from({ length: faceCount }, (_, index) => index);
  const find = (value: number): number => {
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]];
      value = parent[value];
    }
    return value;
  };
  for (const faces of edgeFaces.values())
    for (let i = 1; i < faces.length; i += 1)
      parent[find(faces[i])] = find(faces[0]);
  return {
    boundaryEdges: [...edgeFaces.values()].filter((faces) => faces.length === 1)
      .length,
    nonManifoldEdges: [...edgeFaces.values()].filter(
      (faces) => faces.length > 2,
    ).length,
    degenerateFaces,
    components: new Set(parent.map((_, index) => find(index))).size,
  };
}

export function formatMemory(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

export function convertPly(
  bytes: ArrayBuffer,
  params: ConversionParams,
  callbacks: EngineCallbacks = {},
) {
  const elapsed: Record<string, number> = {};
  const stage = (name: string, fn: () => void) => {
    const start = performance.now();
    fn();
    elapsed[name] = performance.now() - start;
  };
  let parsed: ParsedPly | undefined;
  callbacks.onStage?.("parsing", 0);
  stage("parsing", () => {
    parsed = parsePly(bytes, params.opacityThreshold);
  });
  if (!parsed) throw new Error("PLY parsing did not produce a result");
  const parsedResult = parsed;
  callbacks.onStage?.(
    "parsing",
    1,
    `${parsedResult.report.retainedCount.toLocaleString()} retained`,
  );
  callbacks.onStage?.("activating", 1);
  let field!: GridField;
  stage("voxelizing", () => {
    field = voxelize(parsedResult.gaussians, params, callbacks);
  });
  const iso =
    params.isoMode === "manual"
      ? params.isoThreshold
      : automaticIso(field.stats);
  let mesh!: MeshData;
  stage("extracting", () => {
    mesh = extractMarchingTetrahedra(
      field,
      parsedResult.gaussians,
      iso,
      params.sigmaRadius,
      callbacks,
    );
  });
  callbacks.onStage?.("cleaning", 0);
  stage("cleaning", () => {
    mesh = cleanupMesh(
      mesh,
      params.keepLargestComponent,
      params.minComponentFaces,
      params.smoothingIterations,
    );
  });
  callbacks.onStage?.("normals", 1);
  callbacks.onStage?.("ready", 1);
  return {
    mesh,
    field,
    report: parsedResult.report,
    isoThreshold: iso,
    elapsed,
  };
}
